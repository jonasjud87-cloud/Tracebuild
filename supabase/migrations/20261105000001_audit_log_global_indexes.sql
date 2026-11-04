CREATE INDEX IF NOT EXISTS audit_log_created_id_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_created_idx ON audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_email_created_idx ON audit_log (actor_email, created_at DESC);
