-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Speicherverbrauch je Organisation
--
-- Hintergrund: Das Admin-Dashboard zeigte das konfigurierte Speicherlimit als
-- "belegt" an. Der echte Verbrauch steht nur in storage.objects (metadata.size),
-- das PostgREST nicht exponiert — daher eine Funktion für den Admin-Client.
--
-- Zuordnung im Bucket "documents" (Pfade aus dem Upload-Code):
--   {project_id}/…      Pläne         → Organisation des Projekts
--   norms/{org_id}/…    eigene Normen → diese Organisation
--   norms/platform/…    Plattform-Normen → keine Organisation
-- Dateien gelöschter Projekte werden nicht mitgezählt.
--
-- Nur service_role darf aufrufen (Admin-API), nicht anon/authenticated.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.org_storage_bytes(p_org_id uuid DEFAULT NULL)
RETURNS TABLE (org_id uuid, bytes bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH files AS (
    SELECT
      split_part(o.name, '/', 1) AS first_segment,
      split_part(o.name, '/', 2) AS second_segment,
      COALESCE((o.metadata->>'size')::bigint, 0) AS size
    FROM storage.objects o
    WHERE o.bucket_id = 'documents'
  ),
  owned AS (
    SELECT p.org_id, f.size
    FROM files f
    JOIN public.projects p ON p.id::text = f.first_segment
    UNION ALL
    SELECT g.id, f.size
    FROM files f
    JOIN public.organizations g ON g.id::text = f.second_segment
    WHERE f.first_segment = 'norms'
  )
  SELECT owned.org_id, SUM(owned.size)::bigint
  FROM owned
  WHERE p_org_id IS NULL OR owned.org_id = p_org_id
  GROUP BY owned.org_id;
$$;

REVOKE ALL ON FUNCTION public.org_storage_bytes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_storage_bytes(uuid) TO service_role;
