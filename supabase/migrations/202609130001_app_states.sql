-- Done Yet cloud snapshot storage.
-- The client writes only through the authenticated PostgREST role. The
-- version-filtered PATCH in src/cloud/runtime.ts is the compare-and-swap
-- boundary; a zero-row response is treated as a conflict.
create table if not exists public.app_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  snapshot text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint app_states_version_positive check (version > 0),
  constraint app_states_snapshot_size check (octet_length(snapshot) <= 2097152)
);

create index if not exists app_states_updated_at_idx on public.app_states (updated_at);

create or replace function public.touch_app_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id <> old.owner_id then
    raise exception 'owner_id is immutable';
  end if;
  new.version := old.version + 1;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists app_states_touch on public.app_states;
create trigger app_states_touch
before update on public.app_states
for each row execute function public.touch_app_state();

alter table public.app_states enable row level security;
alter table public.app_states force row level security;

drop policy if exists app_states_select_own on public.app_states;
create policy app_states_select_own on public.app_states
for select to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists app_states_insert_own on public.app_states;
create policy app_states_insert_own on public.app_states
for insert to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists app_states_update_own on public.app_states;
create policy app_states_update_own on public.app_states
for update to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists app_states_delete_own on public.app_states;
create policy app_states_delete_own on public.app_states
for delete to authenticated
using ((select auth.uid()) = owner_id);

revoke all on table public.app_states from anon;
grant select, insert, update, delete on table public.app_states to authenticated;

