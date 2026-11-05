-- Geoportal-Anbindung. Mehrfach ausführbar. NICHT automatisch ausführen.

-- ── Projekte ─────────────────────────────────────────────────────────────────
ALTER TABLE projects ADD COLUMN IF NOT EXISTS egrid text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lv95_e numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lv95_n numeric;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS bfs_number integer;
CREATE INDEX IF NOT EXISTS projects_bfs_number_idx ON projects (bfs_number) WHERE bfs_number IS NOT NULL;

-- ── Auszug: letzter Versuch getrennt vom letzten Erfolg ──────────────────────
ALTER TABLE oereb_extracts ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE oereb_extracts ADD COLUMN IF NOT EXISTS last_error text;
-- Herkunftsnachweis: nur der Server setzt ihn. Der Import verarbeitet ausschliesslich Auszüge mit
-- diesem Stempel. Altbestände bleiben NULL, bis sie neu abgerufen wurden (nächster Auslöser).
ALTER TABLE oereb_extracts ADD COLUMN IF NOT EXISTS server_fetched_at timestamptz;

-- ── Normen: Herkunft automatischer Importe ───────────────────────────────────
-- source_kind NULL = manuell gepflegt, wird NIE automatisch überschrieben.
ALTER TABLE norms ADD COLUMN IF NOT EXISTS source_kind text;          -- 'oereb_auto' | NULL
ALTER TABLE norms ADD COLUMN IF NOT EXISTS auto_scope text;           -- 'municipal' | 'parcel' | NULL
ALTER TABLE norms ADD COLUMN IF NOT EXISTS jurisdiction_canton text;
ALTER TABLE norms ADD COLUMN IF NOT EXISTS jurisdiction_bfs integer;
ALTER TABLE norms ADD COLUMN IF NOT EXISTS text_sha256 text;
ALTER TABLE norms ADD COLUMN IF NOT EXISTS source_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS norms_auto_bfs_idx ON norms (jurisdiction_bfs) WHERE source_kind = 'oereb_auto';

-- Alter Stand bei jeder automatischen Überschreibung (Nachvollzug, Rücksprung).
CREATE TABLE IF NOT EXISTS norm_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  norm_id     uuid NOT NULL REFERENCES norms(id) ON DELETE CASCADE,
  title       text NOT NULL,
  text        text NOT NULL,
  text_sha256 text NOT NULL,
  source_url  text,
  replaced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS norm_versions_norm_id_idx ON norm_versions (norm_id, replaced_at DESC);

-- ── Dokumente aus ÖREB-Auszügen (global, nicht pro Org) ──────────────────────
CREATE TABLE IF NOT EXISTS oereb_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canton             text NOT NULL,
  bfs_number         integer NOT NULL,
  municipality       text NOT NULL,
  url                text NOT NULL,
  url_normalized     text NOT NULL,
  title              text NOT NULL,
  title_key          text NOT NULL,
  doc_type           text,               -- 'LegalProvision' | 'Law' | 'Hint'
  theme_codes        text[] NOT NULL DEFAULT '{}',
  authority          text,
  status             text NOT NULL DEFAULT 'pending',
  -- pending | imported | rejected | failed | duplicate_manual | removed
  reject_reason      text,
  reject_detail      text,
  filter_snapshot    jsonb,
  scope              text,               -- 'municipal' | 'parcel'
  norm_id            uuid REFERENCES norms(id) ON DELETE SET NULL,
  bytes              bigint,
  chars              integer,
  pdf_sha256         text,
  text_sha256        text,
  etag               text,
  last_modified      text,
  attempts           integer NOT NULL DEFAULT 0,
  last_update_status text,
  last_update_detail text,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_checked_at    timestamptz,
  next_check_at      timestamptz NOT NULL DEFAULT now(),
  lock_until         timestamptz,
  UNIQUE (canton, bfs_number, url_normalized)
);
CREATE INDEX IF NOT EXISTS oereb_documents_bfs_idx ON oereb_documents (bfs_number, status);
CREATE INDEX IF NOT EXISTS oereb_documents_reject_idx ON oereb_documents (reject_reason) WHERE status = 'rejected';

-- ── Importfilter als Daten: über die Standardregeln im Code gelegt ───────────
-- scope = 'default' oder Kantonskürzel. Änderbar per SQL, ohne Deploy.
CREATE TABLE IF NOT EXISTS oereb_import_filters (
  scope      text PRIMARY KEY,
  rules      jsonb NOT NULL DEFAULT '{}',
  active     boolean NOT NULL DEFAULT true,
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO oereb_import_filters (scope, rules, note) VALUES
  ('GE', '{"title_reject_exact_add":["loi","plan"]}',
   'GE führt das Kantonsrecht und Pläne je Zone als Rechtsvorschrift mit Titel Loi oder Plan.')
ON CONFLICT (scope) DO NOTHING;

-- ── Dienstkonfiguration: Override und Cache je Kanton ────────────────────────
CREATE TABLE IF NOT EXISTS oereb_services (
  canton            text PRIMARY KEY,
  base_url_override text,                -- von Hand gesetzt, hat Vorrang
  base_url          text,                -- zuletzt geprüft
  language          text,
  format            text,                -- 'json' | 'xml'
  verified_at       timestamptz,
  note              text
);

-- ── Geodaten je Projekt ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_geodata (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  egrid      text,
  status     text NOT NULL,              -- 'ok' | 'partial' | 'unavailable'
  data       jsonb NOT NULL DEFAULT '{}',
  links      jsonb NOT NULL DEFAULT '{}',
  errors     jsonb NOT NULL DEFAULT '[]',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz
);

-- ── Auszug atomar ersetzen: Fehler beim Schreiben dürfen keine Themen verlieren ──
CREATE OR REPLACE FUNCTION public.replace_oereb_extract(
  p_project_id uuid, p_extract jsonb, p_themes jsonb
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.oereb_extracts AS e
    (project_id, canton, egrid, identdn, parcel_number, status, status_detail, raw,
     fetched_at, last_attempt_at, last_error, server_fetched_at)
  VALUES
    (p_project_id, p_extract->>'canton', p_extract->>'egrid', p_extract->>'identdn',
     p_extract->>'parcel_number', 'ok', NULL, p_extract->'raw', now(), now(), NULL, now())
  ON CONFLICT (project_id) DO UPDATE SET
    canton = EXCLUDED.canton, egrid = EXCLUDED.egrid, identdn = EXCLUDED.identdn,
    parcel_number = EXCLUDED.parcel_number, status = 'ok', status_detail = NULL,
    raw = EXCLUDED.raw, fetched_at = now(), last_attempt_at = now(), last_error = NULL,
    server_fetched_at = now()
  RETURNING e.id INTO v_id;

  DELETE FROM public.oereb_themes WHERE extract_id = v_id;

  INSERT INTO public.oereb_themes
    (extract_id, theme_code, theme_name, sub_theme, concern, legal_status, area_pct, area_m2,
     type_code, legend_text, law_links, authority, raw)
  SELECT v_id, t.theme_code, t.theme_name, t.sub_theme, t.concern, t.legal_status, t.area_pct,
         t.area_m2, t.type_code, t.legend_text, COALESCE(t.law_links, '[]'::jsonb), t.authority, t.raw
  FROM jsonb_to_recordset(p_themes) AS t(
    theme_code text, theme_name text, sub_theme text, concern text, legal_status text,
    area_pct numeric, area_m2 numeric, type_code text, legend_text text,
    law_links jsonb, authority jsonb, raw jsonb);

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.replace_oereb_extract(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_oereb_extract(uuid, jsonb, jsonb) TO service_role;

-- ── RLS: aktiv, ohne Policies. Zugriff nur über Service-Role aus den API-Routen,
-- gleiche Konvention wie project_norm_summaries (20261103000001).
ALTER TABLE norm_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE oereb_documents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE oereb_import_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE oereb_services       ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_geodata      ENABLE ROW LEVEL SECURITY;

-- ── Ereignisse je Abruf: Ein dauerhafter Kantonsausfall bleibt sonst unsichtbar ──
-- Prüfabfragen: supabase/ops/geoportal-checks.sql. Einträge nach 90 Tagen löschen (dort).
CREATE TABLE IF NOT EXISTS oereb_fetch_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL,               -- 'oereb' | 'geodata'
  canton      text,
  project_id  uuid,                        -- bewusst ohne FK: Ereignisse überleben das Projekt
  status      text NOT NULL,
  detail      text,
  duration_ms integer
);
CREATE INDEX IF NOT EXISTS oereb_fetch_events_canton_idx ON oereb_fetch_events (canton, at DESC);
ALTER TABLE oereb_fetch_events ENABLE ROW LEVEL SECURITY;

-- ── Sicherheit: Auszug und Grundstücks-Identität schreibt nur der Server ─────────
-- Grund: Aus Auszügen entstehen globale Normen für alle Organisationen. Mit Anon-Key und JWT liessen
-- sich bisher Auszug, law_links und bfs_number setzen und so beliebige PDF einschleusen.
-- Kein Client-Code schreibt direkt in diese Tabellen (geprüft 5.11.2026), alles läuft über die
-- API-Routen mit Service-Role.
DROP POLICY IF EXISTS "oereb_extracts_access" ON oereb_extracts;
CREATE POLICY "oereb_extracts_access" ON oereb_extracts
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "oereb_themes_access" ON oereb_themes;
CREATE POLICY "oereb_themes_access" ON oereb_themes
  FOR SELECT USING (
    extract_id IN (
      SELECT e.id FROM oereb_extracts e
      JOIN projects p ON p.id = e.project_id
      WHERE p.org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON oereb_extracts, oereb_themes FROM anon, authenticated;

-- projects bleibt für Clients schreibbar (Policy projects_own_org), die Identitätsspalten nicht. Ein
-- Trigger statt Spaltenrechten: Supabase vergibt UPDATE auf die ganze Tabelle, ein Spalten-REVOKE
-- wirkte dagegen nicht. Prüft die Rolle der Anfrage (current_user), deshalb SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.protect_project_identity() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.egrid := NULL; NEW.bfs_number := NULL; NEW.lv95_e := NULL; NEW.lv95_n := NULL;
  ELSE
    NEW.egrid := OLD.egrid; NEW.bfs_number := OLD.bfs_number; NEW.lv95_e := OLD.lv95_e; NEW.lv95_n := OLD.lv95_n;
  END IF;
  IF COALESCE(NEW.location->>'canton', '') <> '' AND NEW.location->>'canton' NOT IN (
    'AG','AI','AR','BE','BL','BS','FR','GE','GL','GR','JU','LU','NE',
    'NW','OW','SG','SH','SO','SZ','TG','TI','UR','VD','VS','ZG','ZH'
  ) THEN
    RAISE EXCEPTION 'Ungültiger Kanton' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS projects_protect_identity ON projects;
CREATE TRIGGER projects_protect_identity
  BEFORE INSERT OR UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION public.protect_project_identity();

-- ── Bestand: Altprojekte mit Bauzone ohne Herkunft ───────────────────────────────
-- Vor der ÖREB-Anbindung gab es zone_source nicht; diese Zonen wurden von Hand erfasst. Geschützt ist
-- nur 'manual', sonst überschriebe sie der erste Abruf. Live waren es 4 Projekte (Stand 5.11.2026).
-- BITTE PRÜFEN: Falls eine dieser Zonen aus einem alten Abruf stammt, bleibt sie nun fest stehen.
-- Die Liste hält fest, welche Projekte betroffen sind: Eine echte manuelle Zone sieht danach gleich aus.
CREATE TABLE IF NOT EXISTS geoportal_zone_backfill (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  bauzone    text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE geoportal_zone_backfill ENABLE ROW LEVEL SECURITY;
INSERT INTO geoportal_zone_backfill (project_id, bauzone)
SELECT id, bauzone FROM projects
WHERE zone_source IS NULL AND bauzone IS NOT NULL AND btrim(bauzone) <> ''
ON CONFLICT (project_id) DO NOTHING;
UPDATE projects SET zone_source = 'manual'
WHERE zone_source IS NULL AND bauzone IS NOT NULL AND btrim(bauzone) <> '';
