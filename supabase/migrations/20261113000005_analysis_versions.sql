ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS version_no integer,
  ADD COLUMN IF NOT EXISTS based_on_analysis_id uuid REFERENCES analyses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS plan_sha256 text;

ALTER TABLE document_files
  ADD COLUMN IF NOT EXISTS sha256 text;

UPDATE analyses a
SET version_no = numbered.n
FROM (
  SELECT a2.id,
         row_number() OVER (PARTITION BY d.project_id, lower(btrim(d.doc_type)) ORDER BY a2.created_at, a2.id) AS n
  FROM analyses a2
  JOIN documents d ON d.id = a2.document_id
) numbered
WHERE a.id = numbered.id AND a.version_no IS NULL;

CREATE INDEX IF NOT EXISTS analyses_plan_sha256_idx ON analyses (plan_sha256) WHERE plan_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS analyses_based_on_idx ON analyses (based_on_analysis_id) WHERE based_on_analysis_id IS NOT NULL;

COMMENT ON COLUMN analyses.version_no IS 'Feste Versionsnummer innerhalb von Projekt und Prüfung (doc_type). Verschiebt sich beim Löschen einer Version nicht.';
COMMENT ON COLUMN analyses.based_on_analysis_id IS 'Letzte fertige Analyse derselben Prüfung zum Zeitpunkt des Starts (Vorversion).';
COMMENT ON COLUMN analyses.plan_sha256 IS 'Prüfsumme des Plansatzes aus den Prüfsummen der Dateien. Gleiche Prüfsumme heisst gleicher Plan.';
COMMENT ON COLUMN document_files.sha256 IS 'SHA-256 der Datei.';
