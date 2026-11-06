-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- Analyse in Etappen: Hintergrundlauf aktivieren. KEINE automatische Migration.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ENTSCHEID  Ob pg_net und pg_cron in der Produktion aktiviert werden, entscheidet Jonas.
--            Niemand führt diese Datei ohne seine Freigabe aus.
--
-- WIRKUNG    Mit Aktivierung läuft eine lange Analyse auch bei geschlossenem Tab weiter.
--            Ohne Aktivierung funktioniert sie ebenfalls, aber nur, solange der Tab offen ist.
--            Die Oberfläche sagt in dem Fall nichts vom Schliessen der Seite (background=false).
--
-- VORAUSSETZUNG
--   1. Spike bestanden am 5.11.2026 (Details unten). Vor der Aktivierung die Function Region prüfen.
--   2. supabase/migrations/20261108000001_analysis_stages.sql ist eingespielt, Deployment ist live.
--
-- AUSFÜHREN  Im Supabase-SQL-Editor Block für Block, jeweils Ergebnis prüfen.
-- GILT FÜR   Nur neue Analysen. Laufende Jobs ohne dispatch_url bleiben beim Browser.

-- ── SPIKE: bestanden am 5.11.2026, Code danach entfernt ─────────────────────────────────────────────
-- waitUntil trug 10 von 10 Läufen über 280 s, ein Selbstaufruf über www antwortete 202. Gemessen wurde nur
-- der Selbstaufruf. Ob Anstösse aus pg_net die Rekursionssperre treffen, zeigt net._http_response nach der
-- Aktivierung; dafür gibt es den Rückfall auf den Browser. Offen: Der Sprung lief in iad1, nicht in fra1.
--
-- ZWEIG «Spike gescheitert» oder Erweiterungen abgelehnt
--   Diese Datei nicht ausführen. analysis_background_available() bleibt false, Jobs bekommen keine
--   dispatch_url, der Browser trägt die Kette. Keine Codeänderung nötig. Bereits aktiviert: Env
--   ANALYSIS_STAGE_DISPATCHER=browser setzen und Rückbau unten ausführen.
--   Plan B Vercel Queues ist bewusst nicht eingebaut. Er ersetzt nur die Schnittstelle Dispatcher
--   (frontend/lib/analysis-stages/ports.ts) und den Einstieg, Lease und Teile bleiben.
--
-- NACH DER AKTIVIERUNG prüfen (kostet Modellaufrufe, Jonas gibt frei)
--   Etappe 2: result_json.stages.cold_stages = 1 und cache_read_input_tokens > 0 in result_json.calls.
--   Sonst ist die Annahme zu signierten URLs falsch, Kosten neu bewerten (stages.cache_write_parts).
--   net._http_response: nur 202. Bei 508 oder 307 fällt der Job nach 4 Versuchen auf den Browser zurück.
--   Tab nach dem Start schliessen: Analyse wird später fertig. Abbruch in Etappe 2: innert Sekunden, Kosten da.
--   Admin: nicht «verwaist». Abgelaufene URL: Wortlaut des 400 mit FILE_FETCH_RE in errors.ts abgleichen.

-- ── 1. Erweiterungen ──────────────────────────────────────────────────────────────────────────────
-- Scheitert das WITH SCHEMA, ohne den Zusatz wiederholen. pg_net legt sein Schema net selbst an.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 2. Prüfen: Der Besitzer von analysis_dispatch muss net.http_post ausführen dürfen ─────────────
SELECT p.proname,
       pg_get_userbyid(p.proowner) AS besitzer,
       has_function_privilege(p.proowner, f.oid, 'EXECUTE') AS darf_http_post
  FROM pg_proc p
  CROSS JOIN (SELECT oid FROM pg_proc
               WHERE proname = 'http_post' AND pronamespace = 'net'::regnamespace LIMIT 1) f
 WHERE p.proname = 'analysis_dispatch' AND p.pronamespace = 'public'::regnamespace;
-- Erwartet: darf_http_post = true. Sonst hier abbrechen und GRANT klären.

-- ── 3. Wächter: holt jede Minute verlorene Ketten nach ────────────────────────────────────────────
SELECT cron.schedule('analysis-dispatch', '* * * * *', 'select public.analysis_dispatch()');
-- Der Wächter schreibt 1440 Zeilen pro Tag in cron.job_run_details: täglich aufräumen.
SELECT cron.schedule('analysis-cron-purge', '17 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$);

-- ── 4. Kontrolle ──────────────────────────────────────────────────────────────────────────────────
SELECT public.analysis_background_available();                        -- erwartet: true
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'analysis-dispatch';
SELECT status, return_message, start_time FROM cron.job_run_details
 ORDER BY start_time DESC LIMIT 5;                                     -- nach 1-2 Minuten: succeeded

-- ── Beobachten im Betrieb: Antworten ausser 202 (409 = verspätet zugestellter Anstoss, harmlos) ───
-- SELECT status_code, count(*) FROM net._http_response
--  WHERE created > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC;

-- ── Rückbau Hintergrundlauf: Neue und laufende Analysen laufen danach nur bei offenem Tab ─────────
-- SELECT cron.unschedule('analysis-dispatch');
-- SELECT cron.unschedule('analysis-cron-purge');
-- UPDATE public.analysis_jobs SET dispatch_url = NULL, dispatch_token_hash = NULL;
-- Die Erweiterungen können bleiben. analysis_background_available() meldet ohne Wächter false.

-- ── RUNBOOK Rollback auf ein Deployment ohne Etappen ──────────────────────────────────────────────
-- Das alte Deployment kennt die Stage-Route vermutlich nicht (Middleware antwortet 307), und seine Seite
-- nimmt nicht wieder auf. Laufende Jobs stünden bis 24 h und sperrten das Projekt nicht, aber zeigten
-- «läuft». Reihenfolge:
--   1. Rückbau Hintergrundlauf (oben), falls aktiviert.
--   2. Deployment zurückrollen.
--   3. Laufende Etappen-Analysen ehrlich schliessen, Kosten bleiben stehen:
-- UPDATE public.analyses a
--    SET status = 'error', finished_at = now(),
--        result_json = coalesce(a.result_json, '{}'::jsonb)
--          || jsonb_build_object('error', 'Analyse wegen Rückrollung abgebrochen. Bitte neu starten.')
--   FROM public.analysis_jobs j
--  WHERE j.analysis_id = a.id AND a.status = 'running';
--   4. Erst danach, falls die Tabellen weg sollen. Ohne Schritt 3 blieben diese Analysen auf running:
-- DROP FUNCTION public.analysis_dispatch(uuid);
-- DROP FUNCTION public.analysis_release_stage(uuid, uuid, double precision);
-- DROP FUNCTION public.analysis_claim_stage(uuid, text, uuid, integer);
-- DROP FUNCTION public.analysis_background_available();
-- DROP TABLE public.analysis_job_parts, public.analysis_jobs;
-- Die Policies bleiben auf SELECT: Das alte Deployment schreibt mit der Service-Role.
