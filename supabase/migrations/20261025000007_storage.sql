-- Private storage buckets.
--   receipts         receipt photos for fill-ups and expenses.
--                    Path: <user_id>/<anything>. Drivers only touch their own folder.
--   truck-documents  scans of licenses, insurance, inspection, permits.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts', 'receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('truck-documents', 'truck-documents', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy receipts_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (select app.has_role('manager', 'accountant', 'dispatcher')));
create policy receipts_staff_write on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (select app.has_role('manager', 'accountant', 'dispatcher')));
create policy receipts_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (select app.has_role('manager', 'accountant')));

create policy receipts_driver_read on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (select app.has_role('driver'))
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy receipts_driver_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (select app.has_role('driver'))
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy truck_documents_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'truck-documents' and (select app.has_role('manager', 'accountant', 'dispatcher')));
create policy truck_documents_staff_write on storage.objects for insert to authenticated
  with check (bucket_id = 'truck-documents' and (select app.has_role('manager', 'dispatcher')));
create policy truck_documents_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'truck-documents' and (select app.has_role('manager', 'dispatcher')))
  with check (bucket_id = 'truck-documents' and (select app.has_role('manager', 'dispatcher')));
create policy truck_documents_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'truck-documents' and (select app.has_role('manager', 'dispatcher')));
