-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Ankündigungen und Wartungsbanner
--
-- Hintergrund: Super-Admins sollen im Admin-Dashboard Hinweise und
-- Wartungsbanner anlegen können, die allen Nutzern (org_id = NULL) oder nur
-- den Mitgliedern einer Organisation angezeigt werden.
--
-- Mehrfach ausführbar (IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS announcements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid REFERENCES organizations(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message          text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 1000),
  type             text NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'maintenance', 'critical')),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  ends_at          timestamptz,
  dismissible      boolean NOT NULL DEFAULT true,
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid,
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_window_check CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS announcements_active_window_idx ON announcements (active, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS announcements_org_idx ON announcements (org_id);

DROP TRIGGER IF EXISTS announcements_set_updated_at ON announcements;
CREATE TRIGGER announcements_set_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS aktiv, aber ohne Policies: Zugriff erfolgt ausschliesslich über den
-- Service-Role-Client aus vertrauenswürdigen API-Routen — genauso wie bei
-- audit_log.
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE announcements IS
  'Ankündigungen und Wartungsbanner. org_id NULL = für alle Organisationen sichtbar. Wird nur von Server-seitigen Routen mit dem Service-Key gelesen und beschrieben.';
