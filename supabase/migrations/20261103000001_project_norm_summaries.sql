-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Kennwerte-Cache für das Normenblatt
--
-- Hintergrund: Das Normenblatt zeigt neu einen pro Norm extrahierten Kennwert-
-- Satz ("Geltende Werte", z.B. Grenzabstand 3.50 m / 6.00 m). Die Extraktion
-- läuft über einen LLM-Call und soll Geld kosten — also höchstens einmal pro
-- Normensatz, nicht bei jedem Seitenaufruf.
--
-- Cache-Schlüssel ist `norms_hash`: ein stabiler Fingerprint (sha256) der
-- sortierten, zugewiesenen Norm-IDs. Solange sich die dem Projekt zugewiesenen
-- Normen nicht ändern, bleibt der Hash gleich — die API-Route vergleicht ihn
-- gegen die aktuell zugewiesenen Normen und liefert `items` ohne neuen
-- Anthropic-Call zurück. Ändert sich die Normenzuweisung (hinzufügen,
-- entfernen, Zonenwechsel), ändert sich der Hash, der Treffer verfehlt die
-- Zeile, und eine frische Extraktion wird berechnet und hier überschrieben
-- (ein Projekt hat immer höchstens eine Zeile — `project_id` ist Primärschlüssel,
-- Neuberechnung ist ein upsert).
--
-- Mehrfach ausführbar (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_norm_summaries (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  norms_hash text NOT NULL,
  items      jsonb NOT NULL,
  model      text NOT NULL,
  cost_usd   numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS aktiv, aber ohne Policies: Zugriff erfolgt ausschliesslich über den
-- Service-Role-Client aus den Server-API-Routen (gleiche Konvention wie bei
-- audit_log/organizations) — der Projekt-Scope wird dort serverseitig geprüft.
ALTER TABLE project_norm_summaries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE project_norm_summaries IS
  'Cache der extrahierten Kennwerte (Normenblatt "Geltende Werte") pro Projekt. norms_hash ist ein sha256-Fingerprint der aktuell zugewiesenen Norm-IDs (sortiert, mit Komma verbunden); weicht er vom Hash der aktuell zugewiesenen Normen ab, ist die Zeile veraltet und wird bei der nächsten Anfrage neu berechnet (upsert auf project_id).';
