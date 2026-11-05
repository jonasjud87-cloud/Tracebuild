-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Kenndatenblatt (Cache, Sperre, Kosten)
--
-- project_norm_summaries hat project_id als Primärschlüssel und gehört dem
-- Normenblatt: Ein zweiter Eintrag pro Projekt ist dort nicht möglich, und die
-- Kennwerte-Route gibt `items` ungeprüft weiter. Deshalb eigene Tabellen.
--
-- project_kenndaten: Cache und Sperre. norms_hash deckt Normtexte, Titel, Ebene und
-- Zone ab. Die Zeile entsteht beim Sperren, also noch ohne Ergebnis.
-- project_kenndaten_kosten: eine Zeile je bezahltem Aufruf, auch bei Fehlern. Ein
-- Summenfeld am Cache verschöbe alte Kosten bei jeder Neuberechnung in den neuen Monat.
--
-- Rein additiv, mehrfach ausführbar. NICHT automatisch ausführen.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS project_kenndaten (
  project_id   uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  norms_hash   text,
  items        jsonb,
  model        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  lock_token   uuid,
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS project_kenndaten_kosten (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cost_usd   numeric NOT NULL,
  model      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_kenndaten_kosten_created_idx ON project_kenndaten_kosten (created_at);

-- RLS aktiv, ohne Policies: Zugriff nur über den Service-Role-Client der API-Routen,
-- gleiche Konvention wie project_norm_summaries (20261103000001).
ALTER TABLE project_kenndaten ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_kenndaten_kosten ENABLE ROW LEVEL SECURITY;

-- Atomar: Nur ein Lauf je Projekt, eine abgelaufene Sperre gilt als frei.
CREATE OR REPLACE FUNCTION public.kenndaten_sperren(p_project_id uuid, p_token uuid, p_ttl_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_got uuid;
BEGIN
  INSERT INTO public.project_kenndaten AS k (project_id, lock_token, locked_until)
  VALUES (p_project_id, p_token, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (project_id) DO UPDATE
    SET lock_token = EXCLUDED.lock_token, locked_until = EXCLUDED.locked_until
    WHERE k.locked_until IS NULL OR k.locked_until < now()
  RETURNING k.lock_token INTO v_got;
  RETURN v_got IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.kenndaten_sperren(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kenndaten_sperren(uuid, uuid, integer) TO service_role;

COMMENT ON TABLE project_kenndaten IS
  'Cache der geprüften Werte des Kenndatenblatts und Sperre pro Projekt. norms_hash ist ein sha256 aus Version, Modell, Zone, Normtiteln, Ebenen und Text-Hashes.';
COMMENT ON TABLE project_kenndaten_kosten IS
  'Eine Zeile je bezahltem Modellaufruf des Kenndatenblatts, auch wenn die Antwort danach unbrauchbar war.';
