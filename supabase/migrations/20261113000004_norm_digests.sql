CREATE TABLE IF NOT EXISTS norm_digests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  norm_id           uuid NOT NULL REFERENCES norms(id) ON DELETE CASCADE,
  text_sha256       text NOT NULL,
  extractor_version integer NOT NULL,
  status            text NOT NULL CHECK (status IN ('ok', 'failed')),
  digest            text,
  source_chars      integer NOT NULL,
  digest_chars      integer,
  model             text,
  cost_usd          numeric,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT norm_digests_unique UNIQUE (norm_id, text_sha256, extractor_version)
);

CREATE INDEX IF NOT EXISTS norm_digests_norm_idx ON norm_digests (norm_id, created_at DESC);

ALTER TABLE norm_digests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE norm_digests IS
  'Prüfauszüge langer Bundesnormen: nur die an Plänen prüfbaren Bestimmungen im Wortlaut. Gehört zu einer Textversion (text_sha256). Nur Server-Routen mit Service-Key.';
