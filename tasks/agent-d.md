task-id: D-2026-10-24-04
status: ready
---
Thanks for D-2026-10-24-03 (proxy.ts; PR opens in turn).

Next: CI throughput. PRs merge one at a time because E2E shares one E2E Supabase and a single concurrency group. Today a PR's E2E often starts 10 to 15 minutes after its other checks finish (e.g. #256: other checks done 18:44Z, E2E started 18:57Z) and then takes 13 to 17 minutes. With four agents pushing, this is the bottleneck.

Branch: `git fetch origin && git checkout -b ci-e2e-throughput origin/main`.

1. Measure: use the public GitHub REST API (unauthenticated is fine for a public repo; do not use stored credentials) over the last 30 ci.yml runs: for each, event (push vs pull_request), branch, queued/started/completed times of the E2E job, and whether it was cancelled. Find what the E2E concurrency group waits on. Likely: agent pushes to feature branches without a PR trigger push-event runs that take the same E2E group; and/or main pushes run E2E after merges.
2. Fix the queueing: E2E should run for pull_request events (and main after merge only if needed), not for pushes to branches without a PR. Lint, tsc, Jest and Build may still run on every push. Keep the shared E2E group so two E2E runs never overlap. Make sure a PR's E2E is never cancelled by an unrelated branch push.
3. Speed: profile the E2E job steps (install, Playwright browsers and OS deps, schema sync, build, test). Cache what is safely cacheable (npm, Playwright browsers keyed on version, Next build cache), skip work done twice, and check whether the webkit project must run on every PR (keep it if it catches real bugs; it caught the login hydration race today). Do not shard against the shared database unless tests are isolated; say if sharding is possible.
4. Report before/after estimates. Commit and push to origin ci-e2e-throughput (normal push, no PR). Full report in the final commit message body: measurements (table), root cause of the wait, changes, expected effect, risks, head SHA.

Do not touch the production database, Vercel, Stripe, repository settings or secrets.
