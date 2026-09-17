# Cloud sync setup

Cloud sync uses Supabase Auth and one owner-scoped `app_states` row. Apply the migration with `supabase db push`, then provide the mobile build with:

```text
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
```

Only the public URL and anon key may be embedded in the app. Never ship a service-role key. The app stores access and refresh tokens in the device keychain/keystore through Expo SecureStore; task snapshots stay in SQLite and are sent only after the user signs in.

The REST adapter uses `owner_id` as the authenticated user ID and updates with `version=eq.<expected>`. The database trigger increments `version`; an update that matches zero rows is surfaced as a conflict. The generated application version is not an HTTP ETag and must not be treated as one.

Before enabling a production build, verify two test accounts can only read and update their own row, a stale version returns no updated row, a 2 MB-plus snapshot is rejected, and deleting an account cascades its snapshot. Enable email confirmation and configure password policy in Supabase Auth.

## Attachment storage

Task attachments upload to a private Storage bucket, `attachments`, created by `202609130002_attachment_objects.sql`. Apply it the same way (`supabase db push`); it is idempotent and safe to re-run. Nothing else to configure — the bucket is created private, with no public URL, and every request goes through the same authenticated-user access token as the rest of cloud sync.

Path convention: every object is stored at `{ownerId}/{attachmentId}{ext}`, where `ownerId` is the uploading user's `auth.uid()` and `ext` is a short, sanitised extension (see `remoteKeyFor` in `mobile/src/cloud/attachments.ts`, and the matching sanitisation in `pickAttachment` in `mobile/src/features/attachments/storage.ts`). The RLS policies on `storage.objects` key entirely off that first path segment via `(storage.foldername(name))[1] = (select auth.uid())::text`, so a user can select/insert/update/delete only objects filed under their own uid — this is enforced by Postgres, not by the client's care in building the path.

The bucket enforces a 10 MB per-file limit (`file_size_limit = 10485760`) at the Storage API level; the app additionally rejects an over-cap file before it ever leaves the device (see `MAX_ATTACHMENT_SIZE` in `mobile/src/features/attachments/storage.ts`), so a 413 from Supabase is a defense-in-depth backstop, not the primary check.

Uploads and deletes go through a durable on-device outbox (`mobile/src/cloud/attachmentQueue.ts` + `attachmentSync.ts`) so a local change survives being offline or the app being killed before the network catches up; local SQLite is authoritative and a failed or pending cloud sync never loses or corrupts the local file.

Before enabling a production build, also verify: two test accounts cannot list or read each other's objects under the `attachments` bucket (a `select`/`list` against another uid's prefix returns nothing, not an error that leaks existence); and an upload past the 10 MB limit is rejected by Storage with a 413, not silently truncated or accepted.

## Account deletion

In-app account deletion is required by both the App Store and Google Play for any app that lets a
user create an account — it is not optional polish. Supabase has no client-safe endpoint that
deletes a user (that requires the service-role key, which must never ship in the app), so this is a
`SECURITY DEFINER` Postgres function, `public.delete_own_account()`, created by
`202609130003_delete_own_account.sql`. Apply it the same way (`supabase db push`); it is idempotent
and safe to re-run.

The function takes **no parameters** — it deletes only `auth.uid()`, the caller's own row, derived
from their verified session, and is a no-op (not an error) when there is no authenticated caller.
This is what makes running it with elevated privilege safe: there is no argument through which a
caller could name a different user's id. Deleting the `auth.users` row cascades to
`public.app_states` automatically (its `owner_id` column is `on delete cascade`, see
`202609130001_app_states.sql`), but **not** to `storage.objects` — Storage rows carry no foreign key
to `auth.users`, so the function also deletes that user's objects from the `attachments` bucket
directly, keyed by the same `(storage.foldername(name))[1]` uid-prefix convention as the RLS
policies in `202609130002_attachment_objects.sql`. Without that step, every attachment the user ever
uploaded would be left behind as unreachable, unbillable-for-nobody orphaned bytes.

Before enabling a production build, verify: a signed-in test account can call `delete_own_account()`
and afterwards its own `app_states` row and its own objects under the `attachments` bucket are both
gone; a second test account's `app_states` row and `attachments` objects are untouched by the first
account's deletion; and an `anon` (unauthenticated) request to
`rpc/delete_own_account` is refused (no `execute` grant exists for `anon` or `public`).

## Verified on 2026-09-13

The attachment bucket migration is applied to the live project. Isolation was checked with two
temporary accounts over HTTPS: the owner could upload and read under its own uid prefix, while a
second authenticated user was refused read, write and delete on those objects, a write to the
bucket root (no uid prefix) was refused, and an anonymous read was refused. Storage returns 400 for
these refusals rather than 403. Both accounts and the probe object were deleted afterwards.

Still unverified: an attachment uploaded by the app itself, and downloaded onto a second device.

## RevenueCat Pro subscriptions

The native app uses `react-native-purchases` and RevenueCat entitlement `pro`. Configure matching
Apple/Google subscription products in the RevenueCat dashboard, attach them to the current offering, and set
these public build variables (never put a secret here):

```text
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_...
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_...
```

### Development override

React Native development runtimes (`__DEV__`) unlock the client-side Pro experience automatically,
so the paywall, unlimited attachment count, and gated UI can be exercised before store accounts and
products exist. Set `EXPO_PUBLIC_DEV_PRO_OVERRIDE=false` to test the free experience. The environment
variable cannot enable the override in a production bundle because `__DEV__` must also be true.

This client override does not forge a server entitlement. After applying the Pro migration to a
development Supabase project, temporarily grant the signed-in test account from the SQL editor so
RLS and the AI function permit that account too:

```sql
insert into public.entitlements (owner_id, entitlement, active, expires_at, updated_at)
select id, 'pro', true, now() + interval '30 days', now()
from auth.users
where email = 'developer@example.com'
on conflict (owner_id) do update
set active = true,
    expires_at = excluded.expires_at,
    updated_at = now();
```

Use only a development/test account and replace the example address. The temporary row expires on
its own; remove it sooner when testing the free or cancellation experience.

The app binds RevenueCat to the signed-in Supabase UUID, so sign-in is required before purchase.
The `revenuecat-webhook` function receives RevenueCat events with `REVENUECAT_WEBHOOK_SECRET` and
`SUPABASE_SERVICE_ROLE_KEY`, then applies them transactionally to `public.entitlements`. A private
event ledger makes retries idempotent, and an older delivery cannot overwrite newer entitlement
state. Deploy with `supabase functions deploy revenuecat-webhook --no-verify-jwt` and configure the
dashboard webhook URL with the same secret as its Bearer authorization value. RevenueCat cannot send
a Supabase user JWT, so this function must bypass gateway JWT verification and authenticate the
request itself before it touches the service-role key. Apply the
`202609140001_revenuecat_entitlements.sql` migration first. Real purchases require an iOS/Android
development build and store sandbox testers; Expo Go cannot exercise native billing. Verify expiry,
restore, cancellation, refund, and webhook retry behavior with sandbox accounts. Free users keep
offline features; Pro gates cloud sync writes, attachment transfer, and AI. The 10 MB per-file
attachment cap remains for Pro.

Dashboard `TEST`, non-Pro, unknown, and `TRANSFER` events are acknowledged without changing access.
Transfer is deliberately fail-safe because its payload does not contain enough current entitlement
state to grant access safely; a subsequent identified SDK refresh or lifecycle webhook reconciles the
destination account. `CANCELLATION`, `BILLING_ISSUE`, and `SUBSCRIPTION_PAUSED` retain access only
through their current expiration. `EXPIRATION` revokes access.

## Cloud AI assistance

Cloud AI assistance is an Edge Function, `mobile/supabase/functions/ai-assist`, that proxies five
narrow requests (`breakdown`, `progress-parse`, `daily-plan`, `capture`, `first-step`) to the Muse provider
(`https://api.meta.ai/v1/chat/completions`, model `muse-spark-1.3-contributor`). **The provider key
lives only in this function** — it is read server-side via `Deno.env.get('MUSE_API_KEY')`, is never
embedded in the app, never has an `EXPO_PUBLIC_` counterpart, and never appears anywhere in this
repository. Deploy it with:

```text
supabase secrets set MUSE_API_KEY=your-provider-key
supabase functions deploy ai-assist
```

The function requires a signed-in caller (Supabase verifies the JWT before the function runs,
and the function itself independently rejects a request with no `Authorization: Bearer …` header)
and never reads a user id from the request body — only from the verified token. The client
(`mobile/src/cloud/aiAssist.ts`) sends only the minimised `{ task, fields }` shape produced by
`domain/aiPayload.ts`'s `buildPayload`; the function does not trust that minimisation and
independently re-validates an exact allow-list of fields per task, rejecting any request with an
extra, missing, or over-limit field with a 400: `breakdown` accepts only `title` (≤200 chars),
`description` (≤1000 chars) and `daysRemaining`; `progress-parse` accepts only `sentence` (≤500
chars); `daily-plan` accepts only `titles` (≤50 entries, each ≤200 chars) and a matching `times`
array; `capture` accepts only `text` (≤1500 chars) and `localNow` (`YYYY-MM-DD HH:mm Weekday`);
`first-step` accepts only `title` (≤200 chars), `notes` (≤1000 chars), `openSteps` (≤20 entries, each
≤120 chars) and `blocker` (one of `start`, `overwhelmed`, `waiting`, `time`). The actual prompt sent
to the provider is built entirely server-side from those validated
fields — the client never supplies, and the function never accepts, a ready-made prompt. `capture` and
`first-step` ask for a JSON object; the app parses and validates it (`domain/aiResponse.ts`) and only
ever proposes the result — nothing is written until the user accepts it.

The provider is a **reasoning model**: even a trivial prompt consumes real "thinking" tokens before
any visible output, and a too-small `max_tokens` produces an HTTP 200 with `content: null` and
`finish_reason: "length"` — a silent empty success. The function calls it with `max_tokens: 2000`
(4000 for `capture`, whose JSON answer is longer — not yet verified live)
and treats `content == null` or `finish_reason === "length"` as a specific, actionable error, never
as an empty success. It logs neither the request body, the prompt it builds, nor the key.

### Request quota

Each account is limited to **10 AI requests per minute and 100 per 24 hours** (a window that opens
with the first request, not a reset at a fixed hour in some timezone). The counters live in
`public.ai_usage`, created by `202609170001_ai_usage.sql` — apply it with `supabase db push` before
deploying the function, or every AI request will fail with 503. After a request passes validation and
before the provider is called, the function calls the zero-parameter `consume_ai_request()` with the
caller's own JWT; it row-locks that account's counter, so concurrent requests are counted one at a
time. The limits are constants in the SQL function (not parameters), and `ai_usage` has RLS on with
no grants, so a user calling the RPC directly can only spend their own allowance. Over the limit, the
function returns 429 with a `Retry-After` header and a message the app shows as-is ("They reset in
about 5 hours"). If the quota check itself fails, the function fails closed with 503 rather than
calling the provider unmetered. If the provider call fails after the request was counted, the
function gives it back through `refund_ai_request(owner, day_start, window_start)` using the
service-role key (available to Edge Functions by default). That function is executable by
`service_role` only — a user who could call it could refund every request — and only decrements a
counter still in the window the request was counted in, never below zero. To change the limits,
edit `per_minute` / `per_day` in a new migration.

Verified live (2026-09-17, in a rolled-back transaction with a throwaway user): ten requests allowed
and the eleventh refused as a burst with `retry_after` 60; a refund restores one request; 100 used
in the window is refused as daily with `retry_after` ≈ 24h, and allowed again once 24 hours have
passed; a signed-in user is denied both `select` on `ai_usage` and `refund_ai_request`; anonymous
callers are denied `consume_ai_request`, `refund_ai_request` and `ai_usage`, and the function returns
401 without a bearer token.

Before enabling a production build, still verify end to end with a real Pro account: a request with
an extra or missing field is refused with 400 and does not reach the provider; a request that would
exceed the reasoning model's token budget surfaces a clear error rather than an empty response; and
the app shows the 429 message when the limit is hit.

## Gateway API key

Every Supabase request needs the publishable/anon key in an `apikey` header, **including** requests that
already carry a signed-in user's bearer token. Without it the gateway replies 401
`{"message":"No API key found in request"}` before PostgREST or Storage ever sees the request, which
looks exactly like an auth/RLS failure. Both `runtime.ts` and `attachments.ts` send it, and each has a
regression test asserting the header — a mocked fetch cannot reproduce the gateway, so the tests must
check the header directly rather than rely on a happy-path response.
