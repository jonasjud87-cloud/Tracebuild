ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS analysis_mode text NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analyses_analysis_mode_check') THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_analysis_mode_check CHECK (analysis_mode IN ('full', 'delta'));
  END IF;
END $$;

ALTER TABLE analysis_items
  ADD COLUMN IF NOT EXISTS change_status text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analysis_items_change_status_check') THEN
    ALTER TABLE analysis_items ADD CONSTRAINT analysis_items_change_status_check
      CHECK (change_status IS NULL OR change_status IN ('unchanged', 'resolved', 'improved', 'worse', 'updated', 'not_checkable', 'new'));
  END IF;
END $$;

COMMENT ON COLUMN analyses.analysis_mode IS 'full = volle Prüfung, delta = Änderungsprüfung gegenüber der Vorversion (based_on_analysis_id).';
COMMENT ON COLUMN analysis_items.change_status IS 'Nur bei Änderungsprüfungen: Entwicklung gegenüber der Vorversion.';
