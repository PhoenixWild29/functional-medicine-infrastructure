-- ============================================================
-- Shared rate-limit counts (security review L7)
-- ============================================================
--
-- The in-memory limiter (src/lib/security/rate-limit.ts) counts per
-- Vercel instance, so N warm instances allow N times each limit. There is
-- no Redis; this keeps one fixed-window count per (bucket, key, window)
-- in Postgres, shared by every instance. The app keeps the in-memory
-- limiter as the first, cheap layer and calls rate_limit_hit() after it
-- (src/lib/security/shared-rate-limit.ts); if this call fails the app
-- fails open.
--
--   1. rate_limit_hits: bucket (a short code such as 'signup'), key_hash
--      (HMAC-SHA256 hex of the key under the audit secret: never a raw IP,
--      email or token), window_start, hit_count. No PHI.
--   2. rate_limit_hit(bucket, key_hash, window_seconds): one atomic
--      upsert-increment (INSERT ... ON CONFLICT DO UPDATE, so concurrent
--      calls never lose a hit) returning the window's count and start.
--      It also prunes the bucket's rows older than the previous window,
--      so the table stays small without a cron.
--
-- RLS on with no policies; anon and authenticated have no table grants
-- and cannot execute the function. Only service_role calls it. SECURITY
-- DEFINER with search_path pg_catalog first. Ends with
-- apply_pharmacy_admin_scope() (20261014000001) as the last statement
-- before COMMIT.

BEGIN;

-- 1. rate_limit_hits
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  bucket       TEXT        NOT NULL CONSTRAINT chk_rate_limit_hits_bucket CHECK (bucket ~ '^[a-z_]{1,40}$'),
  key_hash     TEXT        NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_start TIMESTAMPTZ NOT NULL,
  hit_count    INTEGER     NOT NULL DEFAULT 1 CONSTRAINT chk_rate_limit_hits_count CHECK (hit_count >= 1),
  PRIMARY KEY (bucket, key_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_prune ON rate_limit_hits (bucket, window_start);

ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rate_limit_hits FROM PUBLIC, anon, authenticated;

-- 2. rate_limit_hit
CREATE OR REPLACE FUNCTION rate_limit_hit(p_bucket TEXT, p_key_hash TEXT, p_window_seconds INTEGER)
RETURNS TABLE (hits INTEGER, window_started TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_window TIMESTAMPTZ;
BEGIN
  IF p_bucket IS NULL OR p_bucket !~ '^[a-z_]{1,40}$' THEN
    RAISE EXCEPTION 'rate_limit_hit: bad bucket' USING ERRCODE = '22023';
  END IF;
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rate_limit_hit: bad key hash' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'rate_limit_hit: bad window' USING ERRCODE = '22023';
  END IF;

  v_window := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  RETURN QUERY
  INSERT INTO public.rate_limit_hits AS h (bucket, key_hash, window_start, hit_count)
  VALUES (p_bucket, p_key_hash, v_window, 1)
  ON CONFLICT (bucket, key_hash, window_start) DO UPDATE SET hit_count = h.hit_count + 1
  RETURNING h.hit_count, h.window_start;

  -- Prune this bucket's finished windows (anything before the previous one).
  DELETE FROM public.rate_limit_hits
  WHERE bucket = p_bucket
    AND window_start < v_window - make_interval(secs => p_window_seconds);
END;
$$;

REVOKE EXECUTE ON FUNCTION rate_limit_hit(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION rate_limit_hit(TEXT, TEXT, INTEGER) TO service_role;

-- 3. Pharmacy admin scope (last statement before COMMIT)
SELECT apply_pharmacy_admin_scope();

COMMIT;
