-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Projektnummer
--
-- Optionale, vom Unternehmen vergebene Nummer je Projekt (z.B. «2024-017»).
-- Eindeutig je Organisation, Gross-/Kleinschreibung egal (Index auf lower()).
-- Der Check entspricht parseProjectNumber in frontend/lib/project-number.ts:
-- getrimmt, nicht leer, höchstens 40 Zeichen, keine Steuerzeichen.
--
-- Index- und Constraint-Namen dürfen egrid, lv95_, bfs_number, zone_, bauzone und
-- parcel_number nicht enthalten: Die API erkennt fehlende Spalten am Fehlertext.
--
-- Ohne diese Migration verwirft die API eine mitgeschickte Nummer still.
-- Rechte auf projects (anon/authenticated) bleiben unverändert.
--
-- Rein additiv, mehrfach ausführbar. NICHT automatisch ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '3s';

ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_number text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'projects_project_number_check'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_project_number_check CHECK (
      project_number IS NULL OR (
        project_number = btrim(project_number)
        AND project_number <> ''
        AND char_length(project_number) <= 40
        AND project_number !~ '[[:cntrl:]]'
      )
    );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS projects_org_project_number_uidx
  ON projects (org_id, lower(project_number))
  WHERE project_number IS NOT NULL;

COMMENT ON COLUMN projects.project_number IS
  'Optionale, vom Unternehmen vergebene Projektnummer. Eindeutig je Organisation (case-insensitiv), getrimmt, max. 40 Zeichen.';

NOTIFY pgrst, 'reload schema';

-- Rückbau:
-- DROP INDEX IF EXISTS projects_org_project_number_uidx;
-- ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_project_number_check;
-- ALTER TABLE projects DROP COLUMN IF EXISTS project_number;
-- NOTIFY pgrst, 'reload schema';
