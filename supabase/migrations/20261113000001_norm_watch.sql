CREATE TABLE IF NOT EXISTS norm_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label             text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  provider          text NOT NULL CHECK (provider IN ('fedlex', 'sg')),
  identifier        text NOT NULL CHECK (char_length(identifier) BETWEEN 1 AND 40),
  norm_id           uuid REFERENCES norms(id) ON DELETE SET NULL,
  jurisdiction_type text NOT NULL DEFAULT 'national' CHECK (jurisdiction_type IN ('national', 'cantonal')),
  jurisdiction_name text,
  category          text NOT NULL DEFAULT 'andere',
  enabled           boolean NOT NULL DEFAULT true,
  applied_version   text,
  applied_label     text,
  remote_version    text,
  remote_label      text,
  ignored_version   text,
  status            text NOT NULL DEFAULT 'unchecked' CHECK (status IN ('unchecked', 'current', 'update_available', 'error')),
  last_checked_at   timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT norm_sources_provider_identifier_key UNIQUE (provider, identifier)
);

CREATE INDEX IF NOT EXISTS norm_sources_norm_idx ON norm_sources (norm_id) WHERE norm_id IS NOT NULL;

DROP TRIGGER IF EXISTS norm_sources_set_updated_at ON norm_sources;
CREATE TRIGGER norm_sources_set_updated_at
  BEFORE UPDATE ON norm_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS norm_update_drafts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id          uuid NOT NULL REFERENCES norm_sources(id) ON DELETE CASCADE,
  norm_id            uuid REFERENCES norms(id) ON DELETE SET NULL,
  remote_version     text NOT NULL,
  remote_label       text NOT NULL,
  new_text           text NOT NULL,
  new_chars          integer NOT NULL,
  old_chars          integer NOT NULL DEFAULT 0,
  similarity         real,
  diff               jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'superseded')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  decided_at         timestamptz,
  decided_by         uuid,
  decided_by_email   text,
  announcement_id    uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS norm_update_drafts_open_idx ON norm_update_drafts (source_id) WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS norm_update_drafts_source_idx ON norm_update_drafts (source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS norm_text_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  norm_id           uuid NOT NULL REFERENCES norms(id) ON DELETE CASCADE,
  text              text NOT NULL,
  version_label     text,
  draft_id          uuid REFERENCES norm_update_drafts(id) ON DELETE SET NULL,
  archived_at       timestamptz NOT NULL DEFAULT now(),
  archived_by_email text
);

CREATE INDEX IF NOT EXISTS norm_text_versions_norm_idx ON norm_text_versions (norm_id, archived_at DESC);

ALTER TABLE norm_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE norm_update_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE norm_text_versions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE norm_sources IS
  'Beobachtete Rechtsquellen (Fedlex, Gesetzessammlung SG). Nur Server-Routen mit Service-Key lesen und schreiben.';
COMMENT ON TABLE norm_update_drafts IS
  'Entwürfe neuer Fassungen. Ersetzt wird erst nach Freigabe durch einen Super-Admin.';
COMMENT ON TABLE norm_text_versions IS
  'Archiv ersetzter Normtexte zum Nachvollzug.';

INSERT INTO norm_sources (label, provider, identifier, jurisdiction_type, jurisdiction_name, category, norm_id)
VALUES
  ('Umweltschutzgesetz (USG), SR 814.01', 'fedlex', '814.01', 'national', NULL, 'andere',
    (SELECT id FROM norms WHERE org_id IS NULL AND title ILIKE 'Umweltschutzgesetz (USG)%' ORDER BY created_at DESC LIMIT 1)),
  ('Lärmschutz-Verordnung (LSV), SR 814.41', 'fedlex', '814.41', 'national', NULL, 'andere',
    (SELECT id FROM norms WHERE org_id IS NULL AND title ILIKE 'Lärmschutz-Verordnung (LSV)%' ORDER BY created_at DESC LIMIT 1)),
  ('Planungs- und Baugesetz (PBG), sGS 731.1', 'sg', '731.1', 'cantonal', 'SG', 'andere',
    (SELECT id FROM norms WHERE org_id IS NULL AND title ILIKE 'SG_PlanungsundBaugesetz%' ORDER BY created_at DESC LIMIT 1)),
  ('Verordnung zum Planungs- und Baugesetz (PBV), sGS 731.11', 'sg', '731.11', 'cantonal', 'SG', 'andere',
    (SELECT id FROM norms WHERE org_id IS NULL AND title ILIKE 'SG_PBV%' ORDER BY created_at DESC LIMIT 1)),
  ('Verordnung zum EG zur eidgenössischen Umweltschutzgesetzgebung, sGS 672.11', 'sg', '672.11', 'cantonal', 'SG', 'andere',
    (SELECT id FROM norms WHERE org_id IS NULL AND title ILIKE 'Verordnung zum Einführungsgesetz zur eidgenössischen Umweltschutz%' ORDER BY created_at DESC LIMIT 1))
ON CONFLICT (provider, identifier) DO NOTHING;
