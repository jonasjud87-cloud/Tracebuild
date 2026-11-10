-- Tool-Monitoring: Lesefunktionen für die Admin-Seite «Tools & Dienste». Additiv, mehrfach ausführbar.
-- NICHT automatisch ausführen. Ohne diese Migration zeigen die Karten Supabase, Claude und Geoportal
-- «Migration fehlt», der Rest läuft.
--
-- Keine Tabellen, keine Erweiterungen, keine Cron-Jobs. pg_cron und pg_net werden nur gelesen, wenn
-- vorhanden, und nur per EXECUTE (ohne Erweiterung gibt es die Schemata cron und net nicht).
-- Nur service_role darf aufrufen (Admin-API), nicht anon/authenticated.
--
-- Rückbau:
--   DROP FUNCTION IF EXISTS public.monitoring_db_stats();
--   DROP FUNCTION IF EXISTS public.monitoring_ai_costs(timestamptz);
--   DROP FUNCTION IF EXISTS public.monitoring_geoportal_health();

SET lock_timeout = '3s';

-- ── Datenbank, Storage, Konten, Cron, pg_net ────────────────────────────────
CREATE OR REPLACE FUNCTION public.monitoring_db_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_tables  jsonb;
  v_storage jsonb;
  v_users   bigint;
  v_active  bigint;
  v_cron    jsonb := NULL;
  v_net     jsonb := NULL;
BEGIN
  SELECT COALESCE(jsonb_agg(t ORDER BY t.bytes DESC), '[]'::jsonb) INTO v_tables
  FROM (
    SELECT c.relname::text AS name,
           pg_catalog.pg_total_relation_size(c.oid) AS bytes,
           COALESCE(s.n_live_tup, 0) AS rows
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY pg_catalog.pg_total_relation_size(c.oid) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(b ORDER BY b.bytes DESC), '[]'::jsonb) INTO v_storage
  FROM (
    SELECT o.bucket_id AS bucket,
           COALESCE(SUM((o.metadata->>'size')::bigint), 0) AS bytes,
           COUNT(*) AS objects
    FROM storage.objects o
    GROUP BY o.bucket_id
  ) b;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE u.last_sign_in_at > now() - interval '30 days')
    INTO v_users, v_active
  FROM auth.users u;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    -- Ohne command: Der Befehl kann Tokens enthalten.
    EXECUTE $q$
      SELECT COALESCE(jsonb_agg(x ORDER BY x.jobname), '[]'::jsonb)
      FROM (
        SELECT j.jobname::text AS jobname,
               j.active,
               r.status::text AS last_status,
               r.start_time AS last_start,
               left(r.return_message, 200) AS last_message,
               (SELECT COUNT(*) FROM cron.job_run_details d
                 WHERE d.jobid = j.jobid AND d.status = 'failed'
                   AND d.start_time > now() - interval '24 hours') AS failed_24h
        FROM cron.job j
        LEFT JOIN LATERAL (
          SELECT d.status, d.start_time, d.return_message
          FROM cron.job_run_details d
          WHERE d.jobid = j.jobid
          ORDER BY d.start_time DESC
          LIMIT 1
        ) r ON true
      ) x
    $q$ INTO v_cron;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_net') THEN
    EXECUTE $q$
      SELECT COALESCE(jsonb_agg(x ORDER BY x.status_code), '[]'::jsonb)
      FROM (
        SELECT r.status_code, COUNT(*) AS n, COUNT(*) FILTER (WHERE r.timed_out) AS timed_out
        FROM net._http_response r
        WHERE r.created > now() - interval '24 hours'
        GROUP BY r.status_code
      ) x
    $q$ INTO v_net;
  END IF;

  RETURN jsonb_build_object(
    'db_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'tables', v_tables,
    'storage', v_storage,
    'auth_users', v_users,
    'auth_active_30d', v_active,
    'cron', v_cron,
    'net', v_net
  );
END $$;

-- ── Eigene Modellkosten je Quelle und Tag (Europe/Zurich) ───────────────────
-- Tabellen und Spalte cost_usd werden zur Laufzeit geprüft; fehlende Quellen fallen weg.
-- OCR: Ohne eingetragenen Betrag zählt die Reservierung (wie das Tagesbudget).
CREATE OR REPLACE FUNCTION public.monitoring_ai_costs(p_since timestamptz)
RETURNS TABLE (source text, day date, cost_usd numeric, calls bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  r       record;
  v_parts text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('analyses',       'public.analyses',                 't.cost_usd'),
      ('chat',           'public.chat_messages',            't.cost_usd'),
      ('norm_summaries', 'public.project_norm_summaries',   't.cost_usd'),
      ('kenndaten',      'public.project_kenndaten_kosten', 't.cost_usd'),
      ('oereb_ocr',      'public.oereb_ocr_runs',           'COALESCE(t.cost_usd, t.reserved_usd)')
    ) AS v(src, tbl, expr)
  LOOP
    IF pg_catalog.to_regclass(r.tbl) IS NOT NULL
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid = pg_catalog.to_regclass(r.tbl)
                      AND a.attname = 'cost_usd' AND NOT a.attisdropped) THEN
      v_parts := v_parts || format(
        'SELECT %L::text AS src, (t.created_at AT TIME ZONE ''Europe/Zurich'')::date AS d, (%s)::numeric AS c FROM %s t WHERE t.created_at >= $1',
        r.src, r.expr, r.tbl);
    END IF;
  END LOOP;

  IF array_length(v_parts, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY EXECUTE
    'SELECT u.src, u.d, COALESCE(SUM(u.c), 0)::numeric, COUNT(*)::bigint FROM ('
    || array_to_string(v_parts, ' UNION ALL ')
    || ') u GROUP BY u.src, u.d ORDER BY u.d, u.src'
    USING p_since;
END $$;

-- ── Geoportal: Fehlerquote je Kanton (24 h), Kantone ohne Erfolg (7 Tage) ───
-- Gleiche Logik wie supabase/ops/geoportal-checks.sql (Abfragen 1 bis 3). Ohne Fehlertexte.
CREATE OR REPLACE FUNCTION public.monitoring_geoportal_health()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_cantons jsonb;
  v_dead    jsonb;
  v_geodata jsonb;
BEGIN
  IF pg_catalog.to_regclass('public.oereb_fetch_events') IS NULL THEN
    RETURN jsonb_build_object('available', false);
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.error_pct DESC, x.canton), '[]'::jsonb) INTO v_cantons
  FROM (
    SELECT e.canton,
           COUNT(*) AS calls,
           COUNT(*) FILTER (WHERE e.status = 'ok') AS ok,
           round(100.0 * COUNT(*) FILTER (WHERE e.status <> 'ok') / COUNT(*), 1) AS error_pct,
           MAX(e.at) FILTER (WHERE e.status = 'ok') AS last_ok
    FROM public.oereb_fetch_events e
    WHERE e.source = 'oereb' AND e.at > now() - interval '24 hours'
    GROUP BY e.canton
  ) x;

  -- no_egrid und ambiguous zählen nicht als Ausfall.
  SELECT COALESCE(jsonb_agg(x ORDER BY x.canton), '[]'::jsonb) INTO v_dead
  FROM (
    SELECT e.canton, COUNT(*) AS calls, MAX(e.at) AS last_attempt
    FROM public.oereb_fetch_events e
    WHERE e.source = 'oereb' AND e.at > now() - interval '7 days'
    GROUP BY e.canton
    HAVING COUNT(*) FILTER (WHERE e.status IN ('ok', 'no_egrid', 'ambiguous')) = 0
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.status), '[]'::jsonb) INTO v_geodata
  FROM (
    SELECT e.status, COUNT(*) AS n
    FROM public.oereb_fetch_events e
    WHERE e.source = 'geodata' AND e.at > now() - interval '24 hours'
    GROUP BY e.status
  ) x;

  RETURN jsonb_build_object('available', true, 'cantons', v_cantons, 'dead', v_dead, 'geodata', v_geodata);
END $$;

REVOKE ALL ON FUNCTION public.monitoring_db_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.monitoring_ai_costs(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.monitoring_geoportal_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.monitoring_db_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_ai_costs(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.monitoring_geoportal_health() TO service_role;

NOTIFY pgrst, 'reload schema';
