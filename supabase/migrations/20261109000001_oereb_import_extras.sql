-- Erweiterungen des Reglement-Imports: Scans durch Claude lesen, Herkunft des Umfangs, Admin-Entscheide.
-- Additiv und mehrfach ausführbar. NICHT automatisch ausführen. Nach 20261107000001 einspielen, deren Trigger und RPC hier erweitert werden.
-- Wird 20261107000001 erneut ausgeführt, danach auch diese Datei: Sonst gelten dort wieder die engeren Fassungen.

SET lock_timeout = '3s';

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

-- ── Rechte: Auch die Herkunft «per KI gelesen» setzt nur der Server ──────────
-- Dieselbe Funktion wie in 20261107000001, ergänzt um text_read_by_ai. Der Trigger bleibt bestehen.
CREATE OR REPLACE FUNCTION public.protect_norm_system_fields() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.source_kind := NULL;
    NEW.auto_scope := NULL;
    NEW.superseded_by_norm_id := NULL;
    NEW.superseded_similarity := NULL;
    NEW.superseded_at := NULL;
    NEW.org_authoritative := false;
    NEW.org_authoritative_at := NULL;
    NEW.org_authoritative_by := NULL;
    NEW.text_read_by_ai := false;
  ELSE
    NEW.source_kind := OLD.source_kind;
    NEW.auto_scope := OLD.auto_scope;
    NEW.superseded_by_norm_id := OLD.superseded_by_norm_id;
    NEW.superseded_similarity := OLD.superseded_similarity;
    NEW.superseded_at := OLD.superseded_at;
    NEW.org_authoritative := OLD.org_authoritative;
    NEW.org_authoritative_at := OLD.org_authoritative_at;
    NEW.org_authoritative_by := OLD.org_authoritative_by;
    NEW.text_read_by_ai := OLD.text_read_by_ai;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Entscheide atomar, über dieselbe Sperre wie der Fassungsvergleich ────────
-- Wie in 20261107000001, zusätzlich mit den Feldern der Admin-Entscheide im Patch.
CREATE OR REPLACE FUNCTION public.oereb_apply_version_actions(p_canton text, p_bfs integer, p_actions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_action jsonb;
  v_patch jsonb;
  v_ids uuid[];
  v_doc public.oereb_documents%ROWTYPE;
  v_rows integer;
  v_changed uuid[] := '{}';
  v_applied uuid[] := '{}';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('oereb_version:' || p_canton || ':' || p_bfs::text));

  SELECT array_agg(DISTINCT x.id) INTO v_ids FROM (
    SELECT (a->>'doc_id')::uuid AS id FROM jsonb_array_elements(p_actions) a
    UNION
    SELECT (a->>'winner_id')::uuid FROM jsonb_array_elements(p_actions) a WHERE a ? 'winner_id'
  ) x;

  PERFORM 1 FROM public.oereb_documents d WHERE d.id = ANY(v_ids) ORDER BY d.id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM public.oereb_documents d WHERE d.id = ANY(v_ids) AND d.lock_until > now()) THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'locked');
  END IF;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    SELECT * INTO v_doc FROM public.oereb_documents d
      WHERE d.id = (v_action->>'doc_id')::uuid AND d.canton = p_canton AND d.bfs_number = p_bfs;
    IF NOT FOUND
      OR v_doc.status IS DISTINCT FROM v_action->>'expect_status'
      OR v_doc.reject_reason IS DISTINCT FROM v_action->>'expect_reason' THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'conflict');
    END IF;
    IF v_action ? 'winner_id' AND NOT EXISTS (
      SELECT 1 FROM public.oereb_documents d
      WHERE d.id = (v_action->>'winner_id')::uuid AND d.status = v_action->>'expect_winner_status'
    ) THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'conflict');
    END IF;
  END LOOP;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions) LOOP
    SELECT * INTO v_doc FROM public.oereb_documents d WHERE d.id = (v_action->>'doc_id')::uuid;
    v_patch := COALESCE(v_action->'patch', '{}'::jsonb);

    IF v_action->>'norm' = 'withdraw' AND v_doc.norm_id IS NOT NULL THEN
      UPDATE public.norms SET auto_scope = 'superseded'
        WHERE id = v_doc.norm_id AND source_kind = 'oereb_auto';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      -- Inzwischen manuell gepflegt: Norm und Dokument bleiben, wie sie sind.
      CONTINUE WHEN v_rows = 0;
      DELETE FROM public.project_norms WHERE norm_id = v_doc.norm_id AND added_by IN ('system', 'oereb');
    ELSIF v_action->>'norm' = 'reinstate' AND v_doc.norm_id IS NOT NULL THEN
      UPDATE public.norms SET auto_scope = COALESCE(v_doc.scope, 'parcel')
        WHERE id = v_doc.norm_id AND source_kind = 'oereb_auto' AND auto_scope = 'superseded';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN v_changed := v_changed || v_doc.norm_id; END IF;
    END IF;

    UPDATE public.oereb_documents d SET
      status            = CASE WHEN v_patch ? 'status' THEN v_patch->>'status' ELSE d.status END,
      reject_reason     = CASE WHEN v_patch ? 'reject_reason' THEN v_patch->>'reject_reason' ELSE d.reject_reason END,
      reject_detail     = CASE WHEN v_patch ? 'reject_detail' THEN v_patch->>'reject_detail' ELSE d.reject_detail END,
      version_winner_id = CASE WHEN v_patch ? 'version_winner_id' THEN (v_patch->>'version_winner_id')::uuid ELSE d.version_winner_id END,
      version_note      = CASE WHEN v_patch ? 'version_note' THEN v_patch->>'version_note' ELSE d.version_note END,
      next_check_at     = CASE WHEN v_patch ? 'next_check_at' THEN (v_patch->>'next_check_at')::timestamptz ELSE d.next_check_at END,
      last_checked_at   = CASE WHEN v_patch ? 'last_checked_at' THEN (v_patch->>'last_checked_at')::timestamptz ELSE d.last_checked_at END,
      pdf_sha256        = CASE WHEN v_patch ? 'pdf_sha256' THEN v_patch->>'pdf_sha256' ELSE d.pdf_sha256 END,
      etag              = CASE WHEN v_patch ? 'etag' THEN v_patch->>'etag' ELSE d.etag END,
      last_modified     = CASE WHEN v_patch ? 'last_modified' THEN v_patch->>'last_modified' ELSE d.last_modified END,
      article_run       = CASE WHEN v_patch ? 'article_run' THEN (v_patch->>'article_run')::integer ELSE d.article_run END,
      article_first     = CASE WHEN v_patch ? 'article_first' THEN (v_patch->>'article_first')::integer ELSE d.article_first END,
      article_hits      = CASE WHEN v_patch ? 'article_hits' THEN (v_patch->>'article_hits')::integer ELSE d.article_hits END,
      stand_date        = CASE WHEN v_patch ? 'stand_date' THEN (v_patch->>'stand_date')::date ELSE d.stand_date END,
      text_sketch       = CASE WHEN v_patch ? 'text_sketch' THEN NULLIF(v_patch->'text_sketch', 'null'::jsonb) ELSE d.text_sketch END,
      content_reason    = CASE WHEN v_patch ? 'content_reason' THEN v_patch->>'content_reason' ELSE d.content_reason END,
      filter_snapshot   = CASE WHEN v_patch ? 'filter_snapshot' THEN NULLIF(v_patch->'filter_snapshot', 'null'::jsonb) ELSE d.filter_snapshot END,
      attempts          = CASE WHEN v_patch ? 'attempts' THEN (v_patch->>'attempts')::integer ELSE d.attempts END,
      last_update_status = CASE WHEN v_patch ? 'last_update_status' THEN v_patch->>'last_update_status' ELSE d.last_update_status END,
      last_update_detail = CASE WHEN v_patch ? 'last_update_detail' THEN v_patch->>'last_update_detail' ELSE d.last_update_detail END,
      manual_decision   = CASE WHEN v_patch ? 'manual_decision' THEN v_patch->>'manual_decision' ELSE d.manual_decision END,
      manual_decision_at = CASE WHEN v_patch ? 'manual_decision_at' THEN (v_patch->>'manual_decision_at')::timestamptz ELSE d.manual_decision_at END,
      ocr_status        = CASE WHEN v_patch ? 'ocr_status' THEN v_patch->>'ocr_status' ELSE d.ocr_status END,
      ocr_pdf_sha256    = CASE WHEN v_patch ? 'ocr_pdf_sha256' THEN v_patch->>'ocr_pdf_sha256' ELSE d.ocr_pdf_sha256 END,
      ocr_detail        = CASE WHEN v_patch ? 'ocr_detail' THEN v_patch->>'ocr_detail' ELSE d.ocr_detail END
    WHERE d.id = v_doc.id;
    v_applied := v_applied || v_doc.id;
  END LOOP;

  RETURN jsonb_build_object('applied', true, 'doc_ids', to_jsonb(v_applied), 'changed_norm_ids', to_jsonb(v_changed));
END;
$$;
REVOKE ALL ON FUNCTION public.oereb_apply_version_actions(text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oereb_apply_version_actions(text, integer, jsonb) TO service_role;

RESET lock_timeout;
