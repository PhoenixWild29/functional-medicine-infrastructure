task-id: C-2026-10-26-09
status: ready
---
Finish C-2026-10-26-08 (V1/V2 and the freeze re-merge) first if not done.

Next: Sam has started Docker Desktop. Run the FULL E2E suite locally on the integrated result, so failures show before the serial PR runs (this was A-2026-10-25-14, blocked on Docker; read A's report origin/bundle-docs docs/qa/local-e2e-2026-10-25.md and your own dry run 2).
1. Confirm `docker version` reaches the engine. If not, stop and report; do not change system settings.
2. Rebuild your throwaway `integration-dry-run-2` locally with the latest origin heads of all 13 PRs in plan order (do NOT push it), applying the combination fixes.
3. `npx supabase@<CI's pinned version> start`, apply all migrations, seed exactly as CI seeds the E2E project (read ci.yml and e2e setup; local keys only; never the shared E2E project, never prod).
4. Run the whole Playwright suite the way CI does (projects, workers, SERIAL handling).
5. Report pass/fail per spec; for each failure: cause (app bug, test bug, seed/env difference) and which branch owns it, with the fix. Fix it on its branch only if that branch is yours or a bundle (bundle-security, bundle-ci, bundle-features, bundle-hipaa, signed-order-freeze, order-transmission-integrity); otherwise report it.
6. `supabase stop` when done.
Report at docs/qa/local-e2e-2026-10-26.md on a new branch `local-e2e-report` from origin/main, push, summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets, and do not use the shared E2E Supabase project.
