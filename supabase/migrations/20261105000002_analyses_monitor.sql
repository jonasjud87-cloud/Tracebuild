ALTER TABLE public.analyses ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE INDEX IF NOT EXISTS analyses_status_created_idx
  ON public.analyses (status, created_at DESC);
