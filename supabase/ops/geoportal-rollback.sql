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
-- Die Rechte aus der Migration (Auszug nur lesbar, Identität per Trigger geschützt) bleiben bewusst
-- bestehen: Auch alter Code schreibt nur über die Service-Role.

BEGIN;

SELECT count(*) AS importierte_normen FROM norms WHERE source_kind = 'oereb_auto';

DELETE FROM oereb_documents;

DELETE FROM project_norms
WHERE norm_id IN (SELECT id FROM norms WHERE source_kind = 'oereb_auto')
   OR trigger LIKE 'oereb-doc:%';

DELETE FROM norms WHERE source_kind = 'oereb_auto';

-- Ergebnis prüfen, dann COMMIT von Hand. Im Zweifel ROLLBACK.
SELECT count(*) AS verbleibend_sollte_0_sein FROM norms WHERE source_kind = 'oereb_auto';
-- COMMIT;
