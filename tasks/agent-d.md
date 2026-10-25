task-id: D-2026-10-25-01
status: ready
---
Thanks for D-2026-10-24-08 (zod 4, 6ad6f94). PR in turn.

Next: make E2E shardable (your CI report: sharding is impossible today because specs share seeded orders and accounts in one E2E project with workers: 1; the test step is ~13 of ~15 minutes and every PR waits on it).

Branch: `git fetch origin && git checkout -b e2e-shard-ready origin/main`.

1. Inventory: for every spec in e2e/, list the shared data it reads or writes (TEST_IDS clinic, provider, patients, pharmacies, catalog items, TEST_USERS logins, seeded orders), whether it mutates shared rows (status changes, deactivation, settings, checklist prefs, signup links, agreements), and its cleanup. Table in the report.
2. Design per-shard isolation that works with ONE E2E Supabase project: e.g. seedStaticData(shardIndex) creating a clinic, provider, patient(s), logins and pharmacies per shard with deterministic ids derived from the shard index (TEST_IDS becomes a function of process.env.TEST_SHARD), unique emails per shard, and shard-scoped cleanup. Global reference data (catalog, ingredients) stays shared read-only. Anything that cannot be isolated (e.g. a spec that changes a global setting) goes in a serial project that runs on one shard only.
3. Implement it so `npx playwright test --shard=1/2` and `--shard=2/2` can run at the same time against the same database without touching each other's rows. Keep workers: 1 inside a shard. Do not change ci.yml in this task (the switch to a 2-shard matrix is a follow-up after this proves out); but add a workflow_dispatch-only job `e2e-sharded-trial` in ci.yml that runs 2 shards in a matrix, outside the shared concurrency group's normal PR path, so it can be tried by hand without blocking PRs. It must still use the e2e-shared-supabase-project concurrency group so it never overlaps a PR's E2E.
4. All existing specs must keep passing in the normal single-shard run (that is what PR CI runs).
5. `npm run lint` (0 warnings), tsc, Jest, build; `npx playwright test --list` for each shard shows a disjoint split. Push e2e-shard-ready (normal push, no PR). Full report in the final commit body: inventory, design, changes, risks, what the trial run must confirm.

Do not touch the production database, Vercel, Stripe or secrets.
