-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Audit-Log pro Organisation
--
-- Hintergrund: Im Super-Admin-Cockpit soll pro Organisation nachvollziehbar
-- sein, wer welche Admin-Aktion (Einladen, Rollenwechsel, Entfernen) wann
-- ausgeführt hat.
--
-- Mehrfach ausführbar (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  actor_id      uuid,               -- NULL nur, wenn das Konto des Akteurs später gelöscht wurde
  actor_email   text NOT NULL,
  action        text NOT NULL,      -- invite | reinvite | role_change | remove
  target_id     uuid,
  target_email  text,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_org_created_idx ON audit_log (org_id, created_at DESC);

-- RLS aktiv, aber ohne Policies: Zugriff erfolgt ausschliesslich über den
-- Service-Role-Client aus vertrauenswürdigen Admin-API-Routen — genauso wie
-- bei organizations/users. Für anon/authenticated gibt es bewusst keine
-- Policies, der Service-Key umgeht RLS ohnehin.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE audit_log IS
  'Anhängeprotokoll (append-only) für Admin-Aktionen innerhalb einer Organisation: Einladen, erneutes Einladen, Rollenwechsel, Entfernen. Wird nur von Server-seitigen Admin-Routen mit dem Service-Key beschrieben.';
