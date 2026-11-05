-- Prüfabfragen Geoportal-Anbindung. Nur lesend, ausser dem letzten, auskommentierten Block.

-- 1. Kantone der letzten 24 h: Fehlerquote und letzter Erfolg. Dauerhafter Ausfall: ok = 0.
SELECT canton,
       count(*) AS abrufe,
       count(*) FILTER (WHERE status = 'ok') AS ok,
       round(100.0 * count(*) FILTER (WHERE status <> 'ok') / count(*), 1) AS fehler_pct,
       max(at) FILTER (WHERE status = 'ok') AS letzter_erfolg,
       round(avg(duration_ms)) AS ms_schnitt
FROM oereb_fetch_events
WHERE source = 'oereb' AND at > now() - interval '24 hours'
GROUP BY canton
ORDER BY fehler_pct DESC, canton;

-- 2. Kantone ohne Erfolg seit 7 Tagen, trotz Abrufen. no_egrid und ambiguous zählen nicht als Ausfall.
SELECT canton, count(*) AS abrufe, max(at) AS letzter_versuch,
       (array_agg(detail ORDER BY at DESC))[1] AS letzter_fehler
FROM oereb_fetch_events
WHERE source = 'oereb' AND at > now() - interval '7 days'
GROUP BY canton
HAVING count(*) FILTER (WHERE status IN ('ok', 'no_egrid', 'ambiguous')) = 0;

-- 3. Geodaten: Quote der letzten 24 h.
SELECT status, count(*) FROM oereb_fetch_events
WHERE source = 'geodata' AND at > now() - interval '24 hours'
GROUP BY status;

-- 4. Importe: Ablehnungsgründe.
SELECT status, reject_reason, count(*) FROM oereb_documents GROUP BY 1, 2 ORDER BY 3 DESC;

-- 5. Dokumente, die dauerhaft scheitern.
SELECT canton, bfs_number, title, attempts, reject_detail, last_checked_at
FROM oereb_documents WHERE status = 'failed' AND attempts >= 3 ORDER BY attempts DESC LIMIT 50;

-- 6. Automatische Updates, die der Schrumpfschutz abgelehnt hat.
SELECT canton, bfs_number, title, last_update_detail, last_checked_at
FROM oereb_documents WHERE last_update_status = 'rejected_shrink' ORDER BY last_checked_at DESC LIMIT 50;

-- 7. Gemeinde-Reglemente mit gleichem Titel unter mehreren URLs: Fusion oder alte Fassung in der Frist?
--    Die alte Fassung wird abgelöst, sobald sie 30 Tage in keinem frischen Abruf mehr vorkam oder
--    dreimal nicht abrufbar war. Was länger hier steht, wird weiter abgerufen, gilt also als Fusion.
SELECT canton, bfs_number, title_key, count(*) AS urls,
       array_agg(url_normalized) AS url_liste, array_agg(last_seen_at) AS zuletzt_gesehen
FROM oereb_documents
WHERE status = 'imported' AND scope = 'municipal'
GROUP BY canton, bfs_number, title_key
HAVING count(*) > 1;

-- 8. Altprojekte, deren Zone die Migration auf 'manual' gesetzt hat: bitte prüfen.
SELECT p.id, p.name, b.bauzone AS zone_beim_nachtrag, p.bauzone, p.zone_source, p.location, e.status AS auszug, e.fetched_at
FROM geoportal_zone_backfill b
JOIN projects p ON p.id = b.project_id
LEFT JOIN oereb_extracts e ON e.project_id = p.id
ORDER BY p.created_at;

-- 9. Aufräumen, von Hand:
-- DELETE FROM oereb_fetch_events WHERE at < now() - interval '90 days';
