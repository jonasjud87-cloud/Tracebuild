DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'norms' AND column_name = 'priority'
  ) THEN
    ALTER TABLE norms ADD COLUMN priority text NOT NULL DEFAULT 'advisory';
    UPDATE norms SET priority = 'binding' WHERE jurisdiction_type = 'org';
  END IF;
END $$;

ALTER TABLE norms
  ADD COLUMN IF NOT EXISTS scope_mode text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS scope_cantons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scope_project_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'advisory',
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS version_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS supersedes_norm_id uuid REFERENCES norms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by_email text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'norms_scope_mode_check') THEN
    ALTER TABLE norms ADD CONSTRAINT norms_scope_mode_check CHECK (scope_mode IN ('all', 'cantons', 'projects'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'norms_priority_check') THEN
    ALTER TABLE norms ADD CONSTRAINT norms_priority_check CHECK (priority IN ('binding', 'advisory'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'norms_approval_status_check') THEN
    ALTER TABLE norms ADD CONSTRAINT norms_approval_status_check CHECK (approval_status IN ('draft', 'approved'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS norms_company_idx ON norms (org_id, created_at DESC) WHERE jurisdiction_type = 'org';
CREATE UNIQUE INDEX IF NOT EXISTS norms_company_open_draft_idx ON norms (supersedes_norm_id)
  WHERE approval_status = 'draft' AND supersedes_norm_id IS NOT NULL;

COMMENT ON COLUMN norms.scope_mode IS 'Unternehmensnormen: all = alle Projekte der Organisation, cantons = nur Projekte in scope_cantons, projects = nur scope_project_ids.';
COMMENT ON COLUMN norms.priority IS 'Unternehmensnormen: binding = intern verbindlich, advisory = Empfehlung. Gesetzliche Normen gehen immer vor.';
COMMENT ON COLUMN norms.approval_status IS 'Unternehmensnormen: draft wird nicht geprüft, erst nach Freigabe durch org_admin oder super_admin. Alle anderen Normen bleiben approved.';
COMMENT ON COLUMN norms.supersedes_norm_id IS 'Vorherige Version derselben Unternehmensnorm. Sie wird bei der Freigabe archiviert (archived_at).';

CREATE OR REPLACE FUNCTION approve_company_norm(p_norm_id uuid, p_org_id uuid, p_user_id uuid, p_user_email text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_norm norms%ROWTYPE;
  v_archived integer := 0;
BEGIN
  SELECT * INTO v_norm FROM norms
  WHERE id = p_norm_id AND org_id = p_org_id AND jurisdiction_type = 'org'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_norm.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'archived');
  END IF;

  IF v_norm.approval_status = 'draft' THEN
    UPDATE norms
    SET approval_status = 'approved', approved_by = p_user_id, approved_by_email = p_user_email, approved_at = now()
    WHERE id = p_norm_id;
  END IF;

  IF v_norm.supersedes_norm_id IS NOT NULL THEN
    UPDATE norms SET archived_at = now()
    WHERE id = v_norm.supersedes_norm_id AND org_id = p_org_id AND jurisdiction_type = 'org' AND archived_at IS NULL;
    GET DIAGNOSTICS v_archived = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'title', v_norm.title,
    'version', v_norm.version_no,
    'archived_previous', v_archived > 0
  );
END;
$$;
