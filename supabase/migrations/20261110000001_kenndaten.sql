-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Cache des Kenndatenblatts
--
-- project_norm_summaries hat project_id als Primärschlüssel und gehört dem
-- Normenblatt: Ein zweiter Eintrag pro Projekt ist dort nicht möglich, und die
-- Kennwerte-Route gibt `items` ungeprüft weiter. Deshalb eine eigene Tabelle
-- gleicher Form. norms_hash deckt Normtexte und Zone ab, die Auswertung wird
-- also nur bei einer Änderung neu bezahlt. cost_usd fliesst in die Admin-Kosten.
--
-- Rein additiv, mehrfach ausführbar (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_kenndaten (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  norms_hash text NOT NULL,
  items      jsonb NOT NULL,
  model      text NOT NULL,
  cost_usd   numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS aktiv, ohne Policies: Zugriff nur über den Service-Role-Client der API-Routen,
-- gleiche Konvention wie project_norm_summaries (20261103000001).
ALTER TABLE project_kenndaten ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE project_kenndaten IS
  'Cache der geprüften Werte des Kenndatenblatts pro Projekt. norms_hash ist ein sha256 aus Version, Modell, Zone und den Text-Hashes der Normen.';
