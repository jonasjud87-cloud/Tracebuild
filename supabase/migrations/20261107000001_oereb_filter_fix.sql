-- Korrektur des Reglement-Imports: Fassungen vergleichen, Uploads ablösen. Additiv und mehrfach
-- ausführbar. NICHT automatisch ausführen. Vor dem Deploy einspielen.

-- ── Fassungen innerhalb eines Auszugs ────────────────────────────────────────
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS official_number text;
-- Messwerte bleiben auch bei Ablehnung: Der Vergleich darf nicht von der Reihenfolge abhängen.
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS article_run integer;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS article_first integer;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS article_hits integer;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS stand_date date;
-- Hash-Skizze des Texts: enthält keinen lesbaren Text.
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS text_sketch jsonb;
-- Ergebnis des Inhaltstests, unabhängig vom Grund `older_version`: NULL = bestanden.
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS content_reason text;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS version_winner_id uuid REFERENCES oereb_documents(id) ON DELETE SET NULL;
-- Im Zweifel bleiben beide Dokumente; hier steht der Hinweis.
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS version_note text;
CREATE INDEX IF NOT EXISTS oereb_documents_official_number_idx
  ON oereb_documents (canton, bfs_number, official_number) WHERE official_number IS NOT NULL;

-- ── Eigene Uploads, die der amtliche Text ablöst ─────────────────────────────
-- Der Upload bleibt bestehen. Die Spalten stehen auf der Zeile der Org, globale Tabellen erfahren
-- nichts über fremde Uploads.
ALTER TABLE norms ADD COLUMN IF NOT EXISTS superseded_by_norm_id uuid REFERENCES norms(id) ON DELETE SET NULL;
ALTER TABLE norms ADD COLUMN IF NOT EXISTS superseded_similarity real;
ALTER TABLE norms ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
-- Die Org legt fest: Ihre Fassung bleibt massgebend, auch gegen den amtlichen Text.
ALTER TABLE norms ADD COLUMN IF NOT EXISTS org_authoritative boolean NOT NULL DEFAULT false;
ALTER TABLE norms ADD COLUMN IF NOT EXISTS org_authoritative_at timestamptz;
ALTER TABLE norms ADD COLUMN IF NOT EXISTS org_authoritative_by uuid;
CREATE INDEX IF NOT EXISTS norms_superseded_by_idx ON norms (superseded_by_norm_id) WHERE superseded_by_norm_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'norms_superseded_only_org') THEN
    ALTER TABLE norms ADD CONSTRAINT norms_superseded_only_org
      CHECK (superseded_by_norm_id IS NULL OR org_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
