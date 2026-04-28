-- Create the storage bucket for closet item photos.
-- public = true means image URLs are readable without auth (no signed-URL overhead).
insert into storage.buckets (id, name, public)
values ('closet-images', 'closet-images', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload into their own folder (userId/filename).
create policy "closet_images_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'closet-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to update/replace their own files.
create policy "closet_images_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'closet-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to delete their own files.
create policy "closet_images_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'closet-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow anyone to read (bucket is public, but explicit policy is cleaner).
create policy "closet_images_select"
  on storage.objects for select
  to public
  using (bucket_id = 'closet-images');
