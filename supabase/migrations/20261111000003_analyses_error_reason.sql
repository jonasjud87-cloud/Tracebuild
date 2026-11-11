-- Fehlgeschlagene Analysen: immer mit Grund und Endzeit.
-- Sicherheitsnetz für jeden Schreibpfad (Route, Etappen, Admin, Cron, Altpfade): Wird status zu 'error'
-- ohne result_json.error, setzt der Trigger «Unbekannter Fehler» und markiert das mit error_missing,
-- damit sich der Pfad in der Admin-Ansicht finden lässt. finished_at fehlt sonst ebenfalls.
-- Additiv: nur Funktion und Trigger, keine Tabellen, keine Rechte für anon/authenticated.

SET lock_timeout = '3s';

ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE OR REPLACE FUNCTION public.analyses_error_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.status = 'error' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'error') THEN
    NEW.finished_at := coalesce(NEW.finished_at, now());
    IF coalesce(btrim(NEW.result_json ->> 'error'), '') = '' THEN
      NEW.result_json := coalesce(NEW.result_json, '{}'::jsonb)
        || jsonb_build_object('error', 'Unbekannter Fehler', 'error_missing', true);
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.analyses_error_reason() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS analyses_error_reason ON public.analyses;
CREATE TRIGGER analyses_error_reason
  BEFORE INSERT OR UPDATE OF status ON public.analyses
  FOR EACH ROW EXECUTE FUNCTION public.analyses_error_reason();

RESET lock_timeout;

-- Rückbau (Daten bleiben, error_missing markiert betroffene Zeilen):
-- DROP TRIGGER IF EXISTS analyses_error_reason ON public.analyses;
-- DROP FUNCTION IF EXISTS public.analyses_error_reason();
