-- Plansatz statt Einzelplan: Ein Baugesuch besteht aus rund zehn Dateien
-- (Situation, Grundrisse, Schnitte, Fassaden, Reglemente …), die nur zusammen
-- vollständig sind. Ein Dokument (= eine Prüfung) hält deshalb beliebig viele
-- Dateien; die Analyse prüft sie in einem Durchgang gemeinsam.
--
-- documents.file_url bleibt bestehen (erste Datei) — ältere Analysen ohne
-- document_files lesen weiterhin dort.

create table if not exists public.document_files (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  -- Pfad im Bucket "documents", immer "{project_id}/…" (Speicherverbrauch je Org hängt daran).
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists document_files_document_id_idx on public.document_files(document_id, position);

alter table public.document_files enable row level security;

create policy "document_files_via_project" on public.document_files
  for all using (
    document_id in (
      select d.id from public.documents d
      where d.project_id in (
        select p.id from public.projects p
        where p.org_id in (select u.org_id from public.users u where u.id = auth.uid())
      )
    )
  );

-- Bei mehreren Dateien braucht ein Prüfpunkt neben der Seite auch die Datei.
alter table public.analysis_items add column if not exists source_file text;
