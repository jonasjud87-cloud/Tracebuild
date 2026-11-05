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

-- ── Rechte: Herkunft und Ablösung setzt nur der Server ───────────────────────
-- norms_org_insert erlaubt Inserts mit Anon-Key. Ohne diesen Trigger liesse sich damit ein Upload als
-- massgebend setzen, eine Herkunft fälschen und über den Fremdschlüssel prüfen, ob eine fremde Norm existiert.
-- Der Trigger läuft vor der FK-Prüfung, das Orakel entfällt. Prüft die Rolle der Anfrage, also SECURITY INVOKER.
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
  ELSE
    NEW.source_kind := OLD.source_kind;
    NEW.auto_scope := OLD.auto_scope;
    NEW.superseded_by_norm_id := OLD.superseded_by_norm_id;
    NEW.superseded_similarity := OLD.superseded_similarity;
    NEW.superseded_at := OLD.superseded_at;
    NEW.org_authoritative := OLD.org_authoritative;
    NEW.org_authoritative_at := OLD.org_authoritative_at;
    NEW.org_authoritative_by := OLD.org_authoritative_by;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS norms_protect_system_fields ON norms;
CREATE TRIGGER norms_protect_system_fields
  BEFORE INSERT OR UPDATE ON norms
  FOR EACH ROW EXECUTE FUNCTION public.protect_norm_system_fields();

-- ── Fassungsvergleich atomar anwenden ────────────────────────────────────────
-- Lauf A (Import) und Lauf B (Vergleich, auch aus einem GET) dürfen sich nicht überschreiben: Sonst steht
-- ein Dokument auf `imported`, seine Norm aber auf `superseded`, und der Gemeinde fehlt das Reglement.
-- Sperre je Gemeinde, weil sich Versionsgruppen je nach Auszug unterscheiden. Bricht ganz ab, wenn ein
-- beteiligtes Dokument gerade verarbeitet wird oder sich sein Stand seit dem Lesen geändert hat; der
-- nächste Abgleich entscheidet neu.
-- Aktion: { doc_id, expect_status, expect_reason, winner_id?, expect_winner_status?, norm?: 'withdraw'|'reinstate', patch: {...} }
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
      filter_snapshot   = CASE WHEN v_patch ? 'filter_snapshot' THEN NULLIF(v_patch->'filter_snapshot', 'null'::jsonb) ELSE d.filter_snapshot END
    WHERE d.id = v_doc.id;
    v_applied := v_applied || v_doc.id;
  END LOOP;

  RETURN jsonb_build_object('applied', true, 'doc_ids', to_jsonb(v_applied), 'changed_norm_ids', to_jsonb(v_changed));
END;
$$;
REVOKE ALL ON FUNCTION public.oereb_apply_version_actions(text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oereb_apply_version_actions(text, integer, jsonb) TO service_role;

RESET lock_timeout;
