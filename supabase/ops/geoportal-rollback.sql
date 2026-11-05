-- Rollback der importierten Reglemente. NICHT AUTOMATISCH AUSFÜHREN, nur von Hand nach Rücksprung des Codes.
--
-- Warum nötig: Alter Code kennt auto_scope nicht und vergleicht nur jurisdiction_name. Er wiese
-- objektbezogene Normen (auto_scope = 'parcel') der ganzen Gemeinde zu und ihre Texte kämen in jede Prüfung.
--
-- Reihenfolge verbindlich: oereb_documents, project_norms, norms.
-- Erhalten bleiben: manuell gepflegte Normen (source_kind IS NULL) und vergangene Analysen, weil
-- analysis_items Titel und Befund kopiert haben (analysis_items.norm_id wird per ON DELETE SET NULL leer).
-- norm_versions fällt per CASCADE mit der Norm weg. Vorher sichern, falls der Nachvollzug nötig ist.
--
-- oereb_ocr_runs bleibt als Kostennachweis (der Verweis aufs Dokument fällt per ON DELETE SET NULL).
-- Die Rechte aus der Migration (Auszug nur lesbar, Identität per Trigger geschützt) bleiben bewusst
-- bestehen: Auch alter Code schreibt nur über die Service-Role.

BEGIN;

SELECT count(*) AS importierte_normen FROM norms WHERE source_kind = 'oereb_auto';

DELETE FROM oereb_documents;

DELETE FROM project_norms
WHERE norm_id IN (SELECT id FROM norms WHERE source_kind = 'oereb_auto')
   OR trigger LIKE 'oereb-doc:%';

-- Uploads, die eine amtliche Fassung abgelöst hat: Der Verweis fällt per ON DELETE SET NULL, die
-- Zuweisung kommt unten zurück. Setzt Migration 20261107000001 voraus; ohne sie diese Blöcke weglassen.
CREATE TEMP TABLE _abg ON COMMIT DROP AS SELECT id FROM norms WHERE superseded_by_norm_id IS NOT NULL;

DELETE FROM norms WHERE source_kind = 'oereb_auto';

UPDATE norms SET superseded_similarity = NULL, superseded_at = NULL WHERE id IN (SELECT id FROM _abg);

INSERT INTO project_norms (project_id, norm_id, added_by)
SELECT p.id, n.id, 'system'
FROM norms n
JOIN _abg USING (id)
JOIN projects p
  ON p.org_id = n.org_id
 AND COALESCE(p.domain, 'bau') = n.domain
 AND p.location->>'municipality' = n.jurisdiction_name
ON CONFLICT (project_id, norm_id) DO NOTHING;

-- Ergebnis prüfen, dann COMMIT von Hand. Im Zweifel ROLLBACK.
SELECT count(*) AS verbleibend_sollte_0_sein FROM norms WHERE source_kind = 'oereb_auto';
-- COMMIT;
