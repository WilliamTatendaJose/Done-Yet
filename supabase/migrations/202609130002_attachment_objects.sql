-- Done Yet cloud attachment storage.
-- Task attachments live in the private `attachments` Storage bucket, one object per
-- attachment, at the path {owner_uid}/{attachmentId}{ext}. The first path segment is
-- the owning user's auth uid — see mobile/src/cloud/attachments.ts's remoteKeyFor(),
-- which derives that path the same way pickAttachment() sanitises a picked file's
-- extension: only a short alphanumeric suffix survives, so the client can never send a
-- path containing `..` or an extra `/`. This migration is what actually enforces the
-- boundary, though: the client's sanitising is a courtesy, not the security control.
--
-- The bucket is not public. Every request — upload, download, delete — is made as the
-- authenticated user via their access token (see mobile/src/cloud/runtime.ts's request
-- boundary); there is no service-role key anywhere in the app, and this migration must
-- never be modified to assume one. RLS on storage.objects is the only thing standing
-- between one user's files and another's: a client must not assume a path it did not
-- upload is unreachable, only that the server will reject it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

-- Deliberately no ALTER TABLE here. storage.objects already has RLS enabled in Supabase
-- and is owned by supabase_storage_admin, not by the role running this migration.
-- In particular, FORCE ROW LEVEL SECURITY would apply these policies to the owner too --
-- i.e. to the Storage service itself, which no policy below grants -- and would break
-- storage project-wide, for every bucket, not just this one.

-- (storage.foldername(name))[1] is the first "/"-separated path segment, i.e. the
-- owner uid prefix. A user may only see, create, replace, or remove objects filed
-- under their own uid — never another user's, and never a bucket-root object with no
-- owner prefix (foldername on such a path yields an empty array, so [1] is null and
-- the comparison fails closed).
drop policy if exists attachments_select_own on storage.objects;
create policy attachments_select_own on storage.objects
for select to authenticated
using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists attachments_insert_own on storage.objects;
create policy attachments_insert_own on storage.objects
for insert to authenticated
with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists attachments_update_own on storage.objects;
create policy attachments_update_own on storage.objects
for update to authenticated
using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists attachments_delete_own on storage.objects;
create policy attachments_delete_own on storage.objects
for delete to authenticated
using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- No table-wide revoke/grant either. storage.objects is shared by every bucket in the
-- project, so changing its grants to serve one bucket reaches far outside this
-- migration's scope: revoking from anon would break any public bucket added later.
-- The four policies above already fail closed for anon, because none of them grants
-- `to anon` and RLS denies anything no policy permits. That is the whole boundary.
