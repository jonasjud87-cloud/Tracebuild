-- Nutzerübersicht (Super-Admin): letzte Aktivität je Nutzer aus dem Audit-Log in einer Abfrage.
-- NICHT automatisch ausführen. Ohne diese Migration liest die Route /api/v1/admin/all-users nur die
-- jüngsten 3000 Audit-Zeilen (Rückfall), ältere Aktivität fällt auf den letzten Login zurück.
--
-- Additiv, mehrfach ausführbar. Keine Tabellen, keine Erweiterungen.
-- Nur service_role darf aufrufen (Admin-API), nicht anon/authenticated.
--
-- Rückbau:
--   DROP FUNCTION IF EXISTS public.admin_last_activity();
--   DROP INDEX IF EXISTS public.audit_log_actor_created_idx;
--   NOTIFY pgrst, 'reload schema';

SET lock_timeout = '3s';

-- Für GROUP BY actor_id / max(created_at). Bei grossem audit_log ggf. vorab CONCURRENTLY anlegen
-- (ausserhalb einer Transaktion), dann greift hier IF NOT EXISTS.
CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx
  ON public.audit_log (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_last_activity()
RETURNS TABLE (actor_id uuid, last_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT a.actor_id, max(a.created_at) AS last_at
  FROM public.audit_log a
  WHERE a.actor_id IS NOT NULL
  GROUP BY a.actor_id
  ORDER BY last_at DESC
$$;

COMMENT ON FUNCTION public.admin_last_activity() IS
  'Jüngster Audit-Eintrag je Akteur für die Nutzerübersicht im Super-Admin-Bereich. Nur service_role.';

REVOKE ALL ON FUNCTION public.admin_last_activity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_last_activity() TO service_role;

-- PostgREST soll die neue Funktion sofort kennen.
NOTIFY pgrst, 'reload schema';
