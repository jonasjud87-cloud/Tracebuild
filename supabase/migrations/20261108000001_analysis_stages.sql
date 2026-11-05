-- Analyse in Etappen. Additiv, mehrfach ausführbar. NICHT automatisch ausführen.
-- Ohne diese Migration läuft die Analyse wie bisher in einer Anfrage (Deckel 8 Teile).
--
-- Diese Datei aktiviert bewusst KEINE Erweiterung und legt keinen Cron-Job an. Das steht getrennt in
-- supabase/ops/analysis-stages-activate.sql und entscheidet Jonas. Ohne Aktivierung laufen die Etappen
-- nur, solange der Tab offen ist: analysis_background_available() meldet false, der Job bekommt keine
-- dispatch_url, die Statusroute meldet background=false und needs_resume, der Browser trägt die Kette.

ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS finished_at timestamptz;

-- ── Job: existiert nur, solange die Analyse läuft ────────────────────────────
CREATE TABLE IF NOT EXISTS public.analysis_jobs (
  analysis_id         uuid PRIMARY KEY REFERENCES public.analyses(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  org_id              uuid,
  actor_id            uuid,
  actor_email         text,
  run_id              text,
  state_version       integer NOT NULL DEFAULT 1,
  phase               text NOT NULL DEFAULT 'prepare'
                      CHECK (phase IN ('prepare','parts','consolidate','finalize')),
  stage_no            integer NOT NULL DEFAULT 0,
  no_progress_stages  integer NOT NULL DEFAULT 0,
  resumes             integer NOT NULL DEFAULT 0,
  active_ms           bigint NOT NULL DEFAULT 0,
  -- Lease: wer gerade rechnet. Läuft ohne Heartbeat ab (Funktion stirbt spätestens bei 300 s).
  lease_id            uuid,
  lease_until         timestamptz,
  -- Seit wann der Job freigegeben auf den nächsten Anstoss wartet.
  waiting_since       timestamptz,
  -- Anstoss durch die Datenbank. dispatch_url NULL = nur Browser (Preview, lokal, nicht aktiviert).
  dispatch_url        text,
  dispatch_token_hash text,
  next_dispatch_at    timestamptz NOT NULL DEFAULT now(),
  dispatch_attempts   integer NOT NULL DEFAULT 0,
  -- Eingefroren beim Start.
  snapshot            jsonb,
  files               jsonb NOT NULL,
  signed_urls         jsonb,
  urls_expire_at      timestamptz,
  preflight           jsonb,
  -- Fortschritt und Abschluss.
  parts_total         integer NOT NULL DEFAULT 0,
  parts_done          integer NOT NULL DEFAULT 0,
  last_progress_at    timestamptz NOT NULL DEFAULT now(),
  consolidation       jsonb,
  consolidation_attempts integer NOT NULL DEFAULT 0,
  consolidation_usage jsonb,
  final_items         jsonb,
  overload_wait_ms    bigint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analysis_jobs_dispatch_idx
  ON public.analysis_jobs (next_dispatch_at) WHERE dispatch_url IS NOT NULL;

-- ── Teile: ein Prüfauftrag je Zeile, die Idempotenz hängt hier ───────────────
CREATE TABLE IF NOT EXISTS public.analysis_job_parts (
  analysis_id        uuid NOT NULL REFERENCES public.analysis_jobs(analysis_id) ON DELETE CASCADE,
  position           integer NOT NULL,
  unit               jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','done','failed')),
  attempts           integer NOT NULL DEFAULT 0,
  unmetered_attempts integer NOT NULL DEFAULT 0,
  next_effort        text,
  lease_id           uuid,
  items              jsonb,
  call               jsonb,
  input_tokens       integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (analysis_id, position)
);
CREATE INDEX IF NOT EXISTS analysis_job_parts_status_idx
  ON public.analysis_job_parts (analysis_id, status);

-- ── Zugriff: nur Server (Service-Role) ───────────────────────────────────────
-- Enthält signierte URLs und Normtexte, deshalb keine Policy (Konvention 20261106000001_geoportal.sql).
ALTER TABLE public.analysis_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_job_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analysis_jobs, public.analysis_job_parts FROM anon, authenticated;

-- ── Claim: atomar, mit der Uhr der Datenbank ─────────────────────────────────
-- p_token_hash NULL = Anstoss aus einer angemeldeten Sitzung (Start, Wiederaufnahme).
CREATE OR REPLACE FUNCTION public.analysis_claim_stage(
  p_analysis_id uuid, p_token_hash text, p_lease_id uuid, p_lease_seconds integer DEFAULT 330
) RETURNS TABLE (stage_no integer, phase text, state_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  UPDATE public.analysis_jobs j
     SET lease_id = p_lease_id,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         waiting_since = NULL,
         stage_no = j.stage_no + 1,
         dispatch_token_hash = NULL,
         dispatch_attempts = 0,
         next_dispatch_at = now() + interval '6 minutes'
    FROM public.analyses a
   WHERE j.analysis_id = p_analysis_id
     AND a.id = j.analysis_id
     AND a.status = 'running'
     AND (j.lease_until IS NULL OR j.lease_until < now())
     AND (p_token_hash IS NULL OR j.dispatch_token_hash = p_token_hash)
  RETURNING j.stage_no, j.phase, j.state_version;
END $$;

-- ── Anstoss: ohne Argument der Wächter, mit Argument die direkte Übergabe ────
-- Wirft ohne pg_net (Schema net fehlt). Der Aufrufer meldet das, der Browser übernimmt.
CREATE OR REPLACE FUNCTION public.analysis_dispatch(p_analysis_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_token text;
  n integer := 0;
BEGIN
  IF p_analysis_id IS NULL THEN
    -- Abgebrochene Analysen: Job entfernen, sobald niemand mehr daran rechnet.
    DELETE FROM public.analysis_jobs j USING public.analyses a
     WHERE a.id = j.analysis_id AND a.status <> 'running'
       AND (j.lease_until IS NULL OR j.lease_until < now());
    -- Harte Obergrenze: nach 24 h ehrlich als Fehler schliessen.
    UPDATE public.analyses a
       SET status = 'error',
           finished_at = now(),
           result_json = coalesce(a.result_json, '{}'::jsonb)
             || jsonb_build_object('error', 'Zeitüberschreitung', 'timed_out', true)
      FROM public.analysis_jobs j
     WHERE j.analysis_id = a.id AND a.status = 'running'
       AND j.created_at < now() - interval '24 hours';
  END IF;

  FOR r IN
    SELECT j.analysis_id, j.dispatch_url, j.dispatch_attempts
      FROM public.analysis_jobs j
      JOIN public.analyses a ON a.id = j.analysis_id
     WHERE a.status = 'running'
       AND j.dispatch_url IS NOT NULL
       AND (j.lease_until IS NULL OR j.lease_until < now())
       AND j.next_dispatch_at <= now()
       AND (p_analysis_id IS NULL OR j.analysis_id = p_analysis_id)
     ORDER BY j.next_dispatch_at
     LIMIT 20
     FOR UPDATE OF j SKIP LOCKED
  LOOP
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    UPDATE public.analysis_jobs
       SET dispatch_token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
           dispatch_attempts = r.dispatch_attempts + 1,
           next_dispatch_at = now() + make_interval(
             secs => least(600, 60 * power(2, least(r.dispatch_attempts, 4))::int))
     WHERE analysis_id = r.analysis_id;
    PERFORM net.http_post(
      url := r.dispatch_url,
      body := jsonb_build_object('analysis_id', r.analysis_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-analysis-dispatch-token', v_token),
      timeout_milliseconds := 30000
    );
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ── Darf die Oberfläche «läuft auch bei geschlossenem Tab» sagen? ────────────
-- Nur, wenn pg_net, pg_cron und der Wächter-Job wirklich da sind. Sonst wäre die Zusage unwahr.
CREATE OR REPLACE FUNCTION public.analysis_background_available()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_job boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN false;
  END IF;
  -- Dynamisch: Ohne pg_cron gibt es das Schema cron nicht.
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = ''analysis-dispatch'' AND active)' INTO v_job;
  RETURN v_job;
END $$;

REVOKE ALL ON FUNCTION public.analysis_claim_stage(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analysis_dispatch(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analysis_background_available() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analysis_claim_stage(uuid, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.analysis_dispatch(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.analysis_background_available() TO service_role;

-- Rückbau: DROP FUNCTION analysis_dispatch, analysis_claim_stage, analysis_background_available;
-- DROP TABLE analysis_job_parts, analysis_jobs. Vorher allfälligen Wächter entfernen (Aktivierungsdatei).
