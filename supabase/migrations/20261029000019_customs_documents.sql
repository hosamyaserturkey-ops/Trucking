-- Migration 19: customs declarations (البيان الجمركي) kept on file, and the
-- address of the customs inquiry system.
--
-- The customs broker's account on the customs inquiry system stays with the
-- broker: nobody's password is stored here. Staff open the inquiry system
-- from the app (in their own browser), print or save the declaration as PDF,
-- and attach it here, to a load or on its own, by its declaration number.

alter table public.company_settings
  add column customs_portal_url text check (customs_portal_url ~ '^https://[^\s]+$');

update public.company_settings set customs_portal_url = 'https://www.customs.gov.jo' where customs_portal_url is null;

comment on column public.company_settings.customs_portal_url is 'Link opened by the "customs inquiry system" button.';

create table public.customs_documents (
  id uuid primary key default gen_random_uuid(),
  declaration_no text not null
    check (declaration_no = btrim(declaration_no) and char_length(declaration_no) between 1 and 40),
  declaration_date date,
  trip_id uuid references public.trips (id) on delete set null,
  file_path text not null
    check (file_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{4}-(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|heic|pdf)$'),
  notes text check (char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

comment on table public.customs_documents is 'Customs declarations on file (PDF or photo in R2 under customs-documents/).';

create index customs_documents_declaration_idx on public.customs_documents (declaration_no);
create index customs_documents_trip_idx on public.customs_documents (trip_id);

select app.staff_policies('public.customs_documents', '{manager,accountant,dispatcher}', '{manager,accountant,dispatcher}');
select app.track('public.customs_documents');
