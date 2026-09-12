-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: audit_log.org_id darf NULL sein
--
-- Hintergrund: Plattformweite Super-Admin-Aktionen (z.B. eine Norm, die direkt
-- als plattformweit hochgeladen wird, org_id = NULL) gehören zu keiner
-- einzelnen Organisation. Ohne diese Lockerung kann so eine Aktion nicht
-- protokolliert werden.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_log ALTER COLUMN org_id DROP NOT NULL;
