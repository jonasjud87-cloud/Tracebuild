-- Erweiterungen des Reglement-Imports: Scans durch Claude lesen, Herkunft des Umfangs, Admin-Entscheide.
-- Additiv und mehrfach ausführbar. NICHT automatisch ausführen. Vor dem Einschalten von `ocr_enabled` einspielen.

-- ── Scans durch Claude lesen (Regel `ocr_enabled`, standardmässig aus) ───────
-- `ai_read`: Der Text stammt nicht aus dem PDF-Textlayer. Die Anzeige sagt «per KI gelesen».
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS text_source text NOT NULL DEFAULT 'pdf';
ALTER TABLE norms ADD COLUMN IF NOT EXISTS text_read_by_ai boolean NOT NULL DEFAULT false;
-- Ein Versuch je PDF-Stand. `started` wird VOR dem Modellaufruf gesetzt: Bleibt es stehen, ist der
-- Lauf abgestürzt und wird nicht erneut bezahlt.
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_status text;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_pdf_sha256 text;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_model text;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_pages integer;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_input_tokens integer;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_output_tokens integer;
-- Summe aller Läufe zu diesem Dokument, in USD. Die Kosten trägt der Betrieb, nicht eine Organisation.
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_cost_usd numeric(10, 4);
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_detail text;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS ocr_read_at timestamptz;
CREATE INDEX IF NOT EXISTS oereb_documents_ocr_pdf_idx
  ON oereb_documents (ocr_pdf_sha256) WHERE ocr_status = 'read';

-- ── Neutrale Titel ───────────────────────────────────────────────────────────
-- Warum ein Dokument mit neutralem Titel gemeindeweit gilt.
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS scope_reason text;

-- ── Admin-Entscheide ─────────────────────────────────────────────────────────
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS manual_decision text;
ALTER TABLE oereb_documents ADD COLUMN IF NOT EXISTS manual_decision_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oereb_documents_text_source_check') THEN
    ALTER TABLE oereb_documents ADD CONSTRAINT oereb_documents_text_source_check
      CHECK (text_source IN ('pdf', 'ai_read')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oereb_documents_ocr_status_check') THEN
    ALTER TABLE oereb_documents ADD CONSTRAINT oereb_documents_ocr_status_check
      CHECK (ocr_status IS NULL OR ocr_status IN ('started', 'read', 'failed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oereb_documents_manual_decision_check') THEN
    ALTER TABLE oereb_documents ADD CONSTRAINT oereb_documents_manual_decision_check
      CHECK (manual_decision IS NULL OR manual_decision IN ('force_import', 'exclude')) NOT VALID;
  END IF;
END $$;
