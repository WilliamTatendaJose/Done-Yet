create table if not exists public.entitlements (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  entitlement text not null default 'pro',
  active boolean not null default false,
  expires_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  last_event_id text,
  last_event_at timestamptz,
  constraint entitlements_entitlement_check check (entitlement = 'pro')
);
alter table public.entitlements add column if not exists last_event_id text;
alter table public.entitlements add column if not exists last_event_at timestamptz;
create index if not exists entitlements_active_idx on public.entitlements (owner_id) where active = true;
alter table public.entitlements enable row level security;
alter table public.entitlements force row level security;
drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own on public.entitlements for select to authenticated using ((select auth.uid()) = owner_id);
revoke all on public.entitlements from anon;
grant select on public.entitlements to authenticated;
create table if not exists public.revenuecat_webhook_events (
  event_id text primary key,
  event_at timestamptz not null,
  processed_at timestamptz not null default now()
);
create index if not exists revenuecat_webhook_events_processed_at_idx on public.revenuecat_webhook_events (processed_at);
alter table public.revenuecat_webhook_events enable row level security;
alter table public.revenuecat_webhook_events force row level security;
revoke all on public.revenuecat_webhook_events from public, anon, authenticated;
revoke all on public.entitlements from service_role;
grant select, insert, update on public.entitlements to service_role;
grant select, insert on public.revenuecat_webhook_events to service_role;
create or replace function public.apply_revenuecat_event(
  p_owner uuid,
  p_event_id text,
  p_event_at timestamptz,
  p_active boolean,
  p_expires timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  applied_rows integer;
begin
  if p_owner is null or p_event_id is null or btrim(p_event_id) = '' or p_event_at is null then
    raise exception 'Invalid RevenueCat event';
  end if;

  insert into public.revenuecat_webhook_events (event_id, event_at)
  values (p_event_id, p_event_at)
  on conflict (event_id) do nothing;
  if not found then return false; end if;

  insert into public.entitlements (owner_id, active, expires_at, last_event_id, last_event_at)
  values (p_owner, p_active, p_expires, p_event_id, p_event_at)
  on conflict (owner_id) do update
    set active = excluded.active,
        expires_at = excluded.expires_at,
        last_event_id = excluded.last_event_id,
        last_event_at = excluded.last_event_at,
        updated_at = now()
  where public.entitlements.last_event_at is null
     or excluded.last_event_at > public.entitlements.last_event_at;
  get diagnostics applied_rows = row_count;
  return applied_rows > 0;
end;
$$;
revoke all on function public.apply_revenuecat_event(uuid,text,timestamptz,boolean,timestamptz) from public, anon, authenticated;
grant execute on function public.apply_revenuecat_event(uuid,text,timestamptz,boolean,timestamptz) to service_role;
create or replace function public.is_pro_user() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.entitlements e where e.owner_id = (select auth.uid()) and e.entitlement = 'pro' and e.active and (e.expires_at is null or e.expires_at > now()));
$$;
revoke all on function public.is_pro_user() from public;
grant execute on function public.is_pro_user() to authenticated;

drop policy if exists app_states_insert_own on public.app_states;
create policy app_states_insert_own on public.app_states for insert to authenticated with check ((select auth.uid()) = owner_id and public.is_pro_user());
drop policy if exists app_states_update_own on public.app_states;
create policy app_states_update_own on public.app_states for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id and public.is_pro_user());

drop policy if exists attachments_insert_own on storage.objects;
create policy attachments_insert_own on storage.objects for insert to authenticated
with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text and public.is_pro_user());
drop policy if exists attachments_update_own on storage.objects;
create policy attachments_update_own on storage.objects for update to authenticated
using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text and public.is_pro_user());
