task-id: A-2026-10-25-14
status: ready
---
Thanks for A-2026-10-25-13 (bundle-ci lockfile and override, f08ed09).

Next: run the FULL E2E suite on the integrated result locally, before the serial PR runs, so failures show up now and not one PR at a time.

1. Check whether this PC can run a local Supabase: Docker Desktop (or another Docker engine) running, and the Supabase CLI version CI pins (ci.yml). If not, stop and report exactly what is missing; do NOT install Docker or change system settings.
2. If it can: in a throwaway local branch `integration-e2e` (do NOT push it), start from origin/main and merge, in order: ops-fax-viewer-documo, rls-user-write-lockdown-v2, security-followups-2, signup-squatting, rate-limit-db, bundle-security, bundle-ci, bundle-features (latest origin heads), perf-indexes, clinical-difference-saved. Apply the fax PDF route combination fix (withApiErrors + refuseCrossSite) and any others your runbook lists.
3. `supabase start` locally, apply all migrations, seed the way CI seeds the E2E project (read ci.yml and the e2e setup; use local keys only, never the shared E2E project's or prod secrets), then run the whole Playwright suite the way CI does (same projects, workers, SERIAL handling).
4. Report: pass/fail per spec; for each failure, the cause (app bug, test bug, seed/env difference from CI) and which branch it belongs to, with the fix. Fix test/app bugs on the branch they belong to ONLY if that branch is yours (rate-limit-db, bundle-security, bundle-ci, bundle-docs); otherwise report and I will route it.
5. `supabase stop` when done.
Push nothing but fixes on your own branches. Put the report in a commit on bundle-docs at docs/qa/local-e2e-2026-10-25.md and push bundle-docs.

Do not touch the production database, Vercel, Stripe or secrets, and do not use the shared E2E Supabase project.
