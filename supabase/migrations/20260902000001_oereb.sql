-- ÖREB-Kataster-Integration (Kanton St.Gallen zuerst).
--
-- Pro Projekt wird genau ein ÖREB-Auszug gespeichert (gilt bis Projektende, keine
-- Aktualisierung). Die einzelnen Themen des Auszugs liegen normalisiert in
-- oereb_themes; oereb_theme_mappings verknüpft Bundes-Pflichtthemen mit
-- norms.category (case-insensitive Teilstring-Match gegen den Freitext).
--
-- NICHT automatisch ausführen — der Nutzer spielt die Migration selbst ein.
-- Mehrfach ausführbar (IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING).

-- ── Auszüge ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oereb_extracts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  canton        text NOT NULL,
  egrid         text,
  identdn       text,
  parcel_number text,
  status        text NOT NULL,          -- ExtractStatus: 'ok' | 'no_egrid' | 'ambiguous' | 'unreachable' | 'parse_error'
  status_detail text,
  raw           jsonb,                  -- Auszug ohne Logos/Karten/Geometrien (Grösse!)
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)                   -- ein Auszug pro Projekt (gilt bis Projektende)
);

-- ── Themen eines Auszugs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oereb_themes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extract_id   uuid NOT NULL REFERENCES oereb_extracts(id) ON DELETE CASCADE,
  theme_code   text NOT NULL,           -- z.B. 'ch.Grundwasserschutzzonen'
  theme_name   text NOT NULL,           -- deutscher Anzeigename
  sub_theme    text,
  concern      text NOT NULL,           -- 'affects' | 'not_affects' | 'no_data'
  legal_status text NOT NULL,           -- 'inForce' | 'changeWithPreEffect' | 'changeWithoutPreEffect' | 'unknown'
  area_pct     numeric,
  area_m2      numeric,
  type_code    text,                    -- z.B. Zonencode '1104101' bei ch.Nutzungsplanung
  legend_text  text,                    -- z.B. 'BauG Wohnzone W2'
  law_links    jsonb NOT NULL DEFAULT '[]',   -- [{ title, url }]
  authority    jsonb,                   -- { name, url }
  raw          jsonb
);

CREATE INDEX IF NOT EXISTS oereb_themes_extract_id_idx ON oereb_themes (extract_id);
CREATE INDEX IF NOT EXISTS oereb_themes_theme_code_idx ON oereb_themes (theme_code);

-- ── Mapping Bundes-Pflichtthema → norms.category ─────────────────────────────

CREATE TABLE IF NOT EXISTS oereb_theme_mappings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_code       text NOT NULL,
  category_pattern text NOT NULL,       -- case-insensitive Teilstring gegen norms.category
  org_id           uuid REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = plattformweit
  active           boolean NOT NULL DEFAULT true,
  -- NULLS NOT DISTINCT (PG15+): auch plattformweite Mappings (org_id IS NULL) sind eindeutig —
  -- sonst wären Duplikate möglich und der Seed unten nicht wiederholbar.
  UNIQUE NULLS NOT DISTINCT (theme_code, category_pattern, org_id)
);

CREATE INDEX IF NOT EXISTS oereb_theme_mappings_theme_code_idx ON oereb_theme_mappings (theme_code) WHERE active;

-- ── Projekt: Herkunft und Genauigkeit der Bauzone ────────────────────────────

ALTER TABLE projects ADD COLUMN IF NOT EXISTS zone_source     text;   -- 'oereb' | 'manual' | NULL
ALTER TABLE projects ADD COLUMN IF NOT EXISTS zone_confidence text;   -- 'exact' | 'coarse' | NULL

-- ── project_norms: Auslöser einer ÖREB-Zuweisung ─────────────────────────────
-- added_by bekommt den neuen Wert 'oereb' (keine Constraint vorhanden — nur dokumentiert):
--   'system' | 'user' | 'oereb'
ALTER TABLE project_norms ADD COLUMN IF NOT EXISTS trigger text;      -- 'oereb:<theme_code>' bei added_by = 'oereb'

-- ── Seed: plattformweite Mappings, nur Bundesthemen ──────────────────────────

INSERT INTO oereb_theme_mappings (theme_code, category_pattern) VALUES
  ('ch.Grundwasserschutzzonen',     'gewässer'),
  ('ch.Grundwasserschutzareale',    'gewässer'),
  ('ch.Laermempfindlichkeitsstufen','lärm'),
  ('ch.Laermempfindlichkeitsstufen','laerm'),
  ('ch.StatischeWaldgrenzen',       'wald'),
  ('ch.Waldabstandslinien',         'wald'),
  ('ch.Waldreservate',              'wald'),
  ('ch.BelasteteStandorte',         'altlast'),
  ('ch.BelasteteStandorte',         'umwelt'),
  ('ch.Nutzungsplanung',            'raumplanung'),
  ('ch.Nutzungsplanung',            'baureglement')
ON CONFLICT (theme_code, category_pattern, org_id) DO NOTHING;

-- ── Row Level Security (analog project_norms / norms) ────────────────────────
-- Der Service-Role-Client der API-Routen umgeht RLS; die Zugriffskontrolle passiert
-- dort über projects.org_id. Die Policies schützen den direkten Client-Zugriff.

ALTER TABLE oereb_extracts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE oereb_themes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE oereb_theme_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oereb_extracts_access" ON oereb_extracts;
CREATE POLICY "oereb_extracts_access" ON oereb_extracts
  FOR ALL USING (
    project_id IN (
      SELECT id FROM projects
      WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "oereb_themes_access" ON oereb_themes;
CREATE POLICY "oereb_themes_access" ON oereb_themes
  FOR ALL USING (
    extract_id IN (
      SELECT e.id FROM oereb_extracts e
      JOIN projects p ON p.id = e.project_id
      WHERE p.org_id = (SELECT org_id FROM users WHERE id = auth.uid())
    )
  );

-- Plattformweite Mappings sind für alle lesbar, org-eigene nur für die eigene Org.
DROP POLICY IF EXISTS "oereb_theme_mappings_read" ON oereb_theme_mappings;
CREATE POLICY "oereb_theme_mappings_read" ON oereb_theme_mappings
  FOR SELECT USING (
    org_id IS NULL
    OR org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );
