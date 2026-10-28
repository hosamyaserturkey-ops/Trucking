-- Migration 21: the driving licence scan (صورة رخصة القيادة) kept with the driver.
--
-- The driver's licence number and expiry were already on the driver; the
-- scan (PDF or photo) lives in the private R2 bucket under
-- driver-documents/, and only its path is stored here. A truck's licence
-- (رخصة المركبة) is a truck document of type 'registration', which already
-- carries its file and expiry alerts.

alter table public.drivers
  add column license_file_path text
    constraint drivers_license_file_path_format
    check (license_file_path is null or license_file_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|pdf)$');

comment on column public.drivers.license_file_path is 'Driving licence scan in R2 (driver-documents/<path>).';
