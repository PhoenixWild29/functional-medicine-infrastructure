task-id: A-2026-10-25-05
status: ready
---
Thanks for A-2026-10-25-04 (branches updated, docs-oct25 9358cca).

Next: D's finding L7. Rate limits are in memory per Vercel instance (lib/security/rate-limit.ts), so concurrent instances multiply them. There is no Redis; use Postgres (Supabase) instead.

Branch: `git fetch origin && git checkout -b rate-limit-db origin/main`.
1. Design a small fixed-window (or sliding-log) limiter stored in Postgres: e.g. table rate_limit_hits(bucket text, key_hash text, window_start timestamptz, count int, primary key(bucket,key_hash,window_start)) with an atomic upsert-increment RPC (SECURITY DEFINER, fixed search_path pg_catalog, public, EXECUTE service_role only) returning the new count; keys are keyed hashes (never raw IP or email); old rows pruned by the existing retention/cron path or the RPC itself. RLS on, no policies for anon/authenticated.
2. Keep the current createRateLimiter API; add a DB-backed implementation used for the public and expensive routes: /api/signup, /api/join/[token], /api/onboarding/invite/accept, /api/patients/face-sheet, the ops fax PDF view (if on main by then), /api/plan/[token] (proposals). Fail open with a logged warning if the DB call errors (do not lock users out because the limiter is down), and keep the in-memory limiter as the first, cheap layer.
3. Migration: number it after the highest migration on main AND on these pushed branches: rls-user-write-lockdown-v2 (000004), security-followups-2 (L12), signup-squatting (if any). Check with git ls-tree and report the number you used. Test on PGlite (atomic increments under concurrency, window rollover, pruning, grants).
4. Red tests first for the limiter and each route's 429 path.
5. `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build. Push rate-limit-db (normal push, no PR). Full report in the final commit body with the migration SQL in full.

Do not touch the production database, Vercel, Stripe or secrets.
