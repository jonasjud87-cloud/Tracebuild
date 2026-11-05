-- Korrektur des Reglement-Imports: Fassungen vergleichen, Uploads ablösen. Additiv und mehrfach
-- ausführbar. NICHT automatisch ausführen. Vor dem Deploy einspielen, im SQL-Editor: Der läuft in einer
-- Transaktion, deshalb keine CONCURRENTLY-Indizes. Die lock_timeout bricht ab, statt Schreiber zu blockieren;
-- dann in einem ruhigen Moment erneut ausführen.
SET lock_timeout = '3s';

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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'norms_superseded_only_org') THEN
    ALTER TABLE norms ADD CONSTRAINT norms_superseded_only_org
      CHECK (superseded_by_norm_id IS NULL OR org_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
ALTER TABLE norms VALIDATE CONSTRAINT norms_superseded_only_org;

-- ── Indizes: ON DELETE SET NULL und die Suche nach Uploads einer Gemeinde ────
CREATE INDEX IF NOT EXISTS norms_superseded_by_idx ON norms (superseded_by_norm_id) WHERE superseded_by_norm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS norms_municipal_name_idx ON norms (jurisdiction_name) WHERE jurisdiction_type = 'municipal';
CREATE INDEX IF NOT EXISTS analysis_items_norm_id_idx ON analysis_items (norm_id);
CREATE INDEX IF NOT EXISTS oereb_documents_norm_id_idx ON oereb_documents (norm_id);
CREATE INDEX IF NOT EXISTS oereb_documents_version_winner_idx ON oereb_documents (version_winner_id);

-- Trigger und RPC stehen nur in 20261109000001: So setzt ein erneutes Ausführen dieser Datei nichts zurück.

RESET lock_timeout;
