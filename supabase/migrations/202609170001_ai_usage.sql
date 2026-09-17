-- Done Yet AI request quota.
-- Every ai-assist request costs real provider tokens, and Pro alone is not a cost ceiling: one
-- account (or a script holding its token) could otherwise call the function without limit. The
-- ai-assist Edge Function calls consume_ai_request() with the caller's own JWT after validating the
-- request and before contacting the provider, and refuses with 429 unless it returns allowed.
--
-- Two limits, both per account:
--   * a burst limit of 10 requests per minute, which stops runaway loops and double-taps from
--     draining the day's allowance;
--   * a daily limit of 100 requests per 24 hours, generous for a person, bounded for a bill.
-- Both are fixed windows that open with the first request after the previous window ended, so the
-- daily allowance never resets at some arbitrary hour in the user's timezone (midnight UTC is 2am
-- in Harare) — it comes back 24 hours after the window began, and the 429 says when.
-- The limits live in the function body, not in parameters, so a caller cannot raise them.
--
-- Like delete_own_account(), consume_ai_request() takes zero parameters and only ever acts on
-- auth.uid(): calling it directly through PostgREST can do nothing but spend the caller's own
-- allowance.

create table if not exists public.ai_usage (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  day_start timestamptz not null,
  day_count integer not null default 0 check (day_count >= 0),
  window_start timestamptz not null,
  window_count integer not null default 0 check (window_count >= 0)
);

-- RLS on with no policies and no grants: anon and authenticated can neither read nor write counters
-- directly. Deliberately not FORCE: the SECURITY DEFINER functions below run as the table owner and
-- must be able to update the row.
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;

create or replace function public.consume_ai_request()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  now_ts timestamptz := now();
  per_minute constant integer := 10;
  per_day constant integer := 100;
  usage public.ai_usage%rowtype;
begin
  if caller_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'unauthenticated', 'retry_after', 0);
  end if;

  insert into public.ai_usage (owner_id, day_start, day_count, window_start, window_count)
  values (caller_id, now_ts, 0, now_ts, 0)
  on conflict (owner_id) do nothing;

  -- Row lock: concurrent requests from the same account are counted one after another, never both
  -- reading the same count and both slipping under the limit.
  select * into usage from public.ai_usage where owner_id = caller_id for update;

  if usage.day_start <= now_ts - interval '24 hours' then
    usage.day_start := now_ts;
    usage.day_count := 0;
  end if;
  if usage.window_start <= now_ts - interval '1 minute' then
    usage.window_start := now_ts;
    usage.window_count := 0;
  end if;

  if usage.day_count >= per_day then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily',
      'retry_after', greatest(1, ceil(extract(epoch from (usage.day_start + interval '24 hours' - now_ts)))::integer)
    );
  end if;
  if usage.window_count >= per_minute then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'burst',
      'retry_after', greatest(1, ceil(extract(epoch from (usage.window_start + interval '1 minute' - now_ts)))::integer)
    );
  end if;

  update public.ai_usage
  set day_start = usage.day_start,
      day_count = usage.day_count + 1,
      window_start = usage.window_start,
      window_count = usage.window_count + 1
  where owner_id = caller_id;

  -- owner_id and the window starts identify exactly which counts this request was added to, so a
  -- later refund can give back only those — never a count in a window opened since.
  return jsonb_build_object(
    'allowed', true,
    'remaining_today', per_day - usage.day_count - 1,
    'owner_id', caller_id,
    'day_start', usage.day_start,
    'window_start', usage.window_start
  );
end;
$$;

-- Zero-argument form only; no overload taking a user id or a limit may ever be added.
revoke all on function public.consume_ai_request() from public, anon;
grant execute on function public.consume_ai_request() to authenticated;

-- Gives back one request when the provider call failed after the quota was spent, so a provider
-- outage doesn't cost the user their allowance. Service role only: if users could call this they
-- could refund every request they made and the quota would mean nothing. It only decrements a
-- counter still in the same window the request was counted in, and never below zero.
create or replace function public.refund_ai_request(p_owner uuid, p_day_start timestamptz, p_window_start timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.ai_usage
  set day_count = case when day_start = p_day_start then greatest(0, day_count - 1) else day_count end,
      window_count = case when window_start = p_window_start then greatest(0, window_count - 1) else window_count end
  where owner_id = p_owner
    and (day_start = p_day_start or window_start = p_window_start);
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.refund_ai_request(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.refund_ai_request(uuid, timestamptz, timestamptz) to service_role;
