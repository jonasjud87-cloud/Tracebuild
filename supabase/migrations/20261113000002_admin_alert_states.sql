CREATE TABLE IF NOT EXISTS admin_alert_states (
  alert_id         text PRIMARY KEY CHECK (char_length(alert_id) BETWEEN 1 AND 200),
  state            text NOT NULL CHECK (state IN ('archived', 'deleted')),
  fingerprint      text NOT NULL,
  acted_by         uuid,
  acted_by_email   text,
  acted_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_alert_states ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE admin_alert_states IS
  'Archivierte oder gelöschte Glocken-Meldungen des Admin-Dashboards. Die Meldungen selbst werden berechnet; hier steht nur, welche ausgeblendet sind. Nur Server-Routen mit Service-Key.';
