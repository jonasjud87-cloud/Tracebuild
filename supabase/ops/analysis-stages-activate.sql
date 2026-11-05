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
--   1. supabase/migrations/20261108000001_analysis_stages.sql ist eingespielt.
--   2. Der Spike unten ist bestanden (10 Sprünge ohne 508).
--      Scheitert er: Diese Datei NICHT ausführen, Zweig «Spike gescheitert» unten.
--
-- AUSFÜHREN  Im Supabase-SQL-Editor Block für Block, jeweils Ergebnis prüfen.
-- GILT FÜR   Nur neue Analysen. Laufende Jobs ohne dispatch_url bleiben beim Browser.

-- ── ABNAHMESCHRITT: Spike Rekursionssperre 508 (nur auf Vercel messbar, noch NICHT ausgeführt) ─────
-- Frage: Trifft die Vercel-Sperre (508 INFINITE_LOOP_DETECTED) auch Aufrufe aus pg_net? «Keine
-- x-vercel-id, also keine Sperre» ist Schlussfolgerung, nicht Doku. Ein Einzelbericht nennt 508 nach dem
-- 4. Lauf bei Selbstaufruf. Ohne Modellkosten, auf einer Preview, pg_net auf einer Kopie oder nach Freigabe:
--   a. Temporäre Route: schläft 200 s, ruft dann per RPC net.http_post auf sich selbst, mit Header
--      x-vercel-protection-bypass. Secret erzeugt Jonas, nur für den Spike, danach widerrufen.
--   b. waitUntil aus @vercel/functions unter Next 14.2.30 mitprüfen: Route läuft nach der Antwort weiter.
--   c. BESTANDEN: 10 Sprünge ohne 508, abgelesen in net._http_response.
--   d. Route, Testfunktion und Secret entfernen.
--
-- ZWEIG «Spike gescheitert» oder Erweiterungen abgelehnt
--   Diese Datei nicht ausführen. analysis_background_available() bleibt false, Jobs bekommen keine
--   dispatch_url, der Browser trägt die Kette. Keine Codeänderung nötig. Bereits aktiviert:
--   Env ANALYSIS_STAGE_DISPATCHER=browser setzen und Wächter entfernen (Rückbau unten).
--   Plan B Vercel Queues ist bewusst nicht eingebaut. Er ersetzt nur die Schnittstelle Dispatcher
--   (frontend/lib/analysis-stages/ports.ts) und den Einstieg, Lease und Teile bleiben.
--
-- NACH DER AKTIVIERUNG prüfen (kostet Modellaufrufe, Jonas gibt frei)
--   Etappe 2, erster Aufruf: cache_read_input_tokens > 0 in result_json.calls. Bei 0 ist die Annahme zu
--   signierten URLs falsch, Kosten neu bewerten. Vercel-Log: kein 508, kein 307 auf /api/v1/internal/*.
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

-- ── 4. Kontrolle ──────────────────────────────────────────────────────────────────────────────────
SELECT public.analysis_background_available();                        -- erwartet: true
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'analysis-dispatch';
SELECT status, return_message, start_time FROM cron.job_run_details
 ORDER BY start_time DESC LIMIT 5;                                     -- nach 1-2 Minuten: succeeded

-- ── Beobachten im Betrieb: Antworten ausser 202 (409 = verspätet zugestellter Anstoss, harmlos) ───
-- SELECT status_code, count(*) FROM net._http_response
--  WHERE created > now() - interval '1 day' GROUP BY 1 ORDER BY 2 DESC;

-- ── Rückbau: Neue Analysen laufen danach wieder nur bei offenem Tab ───────────────────────────────
-- SELECT cron.unschedule('analysis-dispatch');
-- Die Erweiterungen können bleiben. analysis_background_available() meldet ohne Wächter false.
