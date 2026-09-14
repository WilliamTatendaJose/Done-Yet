-- Done Yet account deletion.
-- App Store and Play Store review both require that a user who can create an
-- account in-app can also delete it in-app, without emailing support. Supabase
-- has no client-safe endpoint for that: deleting a row from auth.users needs a
-- privilege ordinary `authenticated` sessions do not have (and must not have,
-- or any signed-in user could delete any other user). The only way to expose
-- this to the app without shipping a service-role key is a SECURITY DEFINER
-- function that runs with elevated privilege internally but exposes no way to
-- direct that privilege at anyone but the caller.
--
-- That is why this function takes zero parameters. It never accepts a user id
-- from the client — the only identity it ever acts on is auth.uid(), which
-- Postgres derives from the caller's own verified JWT and which the caller
-- cannot spoof or pass in. A SECURITY DEFINER function with an id parameter
-- would be a privilege-escalation bug; one with no parameters and only
-- auth.uid() in its body cannot be, by construction.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  -- No authenticated session: nothing to do. A SECURITY DEFINER function
  -- silently no-oping here (rather than raising) means an accidental or
  -- retried call from a signed-out state cannot be mistaken for a partial
  -- failure — there is simply no account to delete.
  if caller_id is null then
    return;
  end if;

  -- storage.objects does not reference auth.users with a foreign key, so it
  -- never cascades — unlike public.app_states, whose owner_id column is
  -- declared `references auth.users(id) on delete cascade` (see
  -- 202609130001_app_states.sql). Without this, deleting the auth.users row
  -- NOTE: deleting these rows removes only Storage's metadata, not the stored bytes,
  -- which the storage service holds outside Postgres. The app deletes the real objects
  -- through the Storage API before calling this function; this delete is the backstop
  -- that keeps storage.objects from retaining rows for a user who no longer exists.
  -- Without it the cascade below would leave every attachment this user uploaded as orphaned
  -- bytes in the private `attachments` bucket, unreachable by any policy
  -- (202609130002_attachment_objects.sql) but never freed. Delete them first,
  -- keyed by the same (storage.foldername(name))[1] = uid convention the
  -- attachments RLS policies use, so this stays the single definition of
  -- "which objects belong to this user".
  delete from storage.objects
  where bucket_id = 'attachments'
    and (storage.foldername(name))[1] = caller_id::text;

  -- Deleting the auth.users row cascades to public.app_states automatically
  -- (its owner_id foreign key is `on delete cascade`), and to any future
  -- table that references auth.users(id) the same way. This is the only
  -- line that needs elevated privilege: the `authenticated` role has no
  -- grants on the auth schema at all.
  delete from auth.users where id = caller_id;
end;
$$;

-- Deliberately no argument-taking overload of this function may ever be
-- added. Every grant below is scoped to the zero-argument form.
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;
