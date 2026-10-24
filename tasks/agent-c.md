task-id: C-2026-10-24-02
status: ready
---
Thanks for C-2026-10-24-01 (merged as #251). Next: E2E stability.

On #117's run 40100758270 `e2e/first-run-checklist.spec.ts:66` was flaky (failed, then passed on retry). Flakes cost us 15-20 minutes per E2E rerun and make real failures harder to see.

Branch: `git fetch origin && git checkout -b e2e-flake-first-run-checklist origin/main`.

1. Read the spec at :66 and the component it drives. Find why it can fail once and pass on retry (race on data load, missing await on navigation/network, timing-based waits, shared state between tests, order-dependent data). Use the check-run annotations of recent runs (`gh run list --workflow ci.yml --limit 20`, then `gh run view <id> --log-failed`) to find this and any other spec marked flaky in the last 20 E2E runs on main and PRs.
2. Fix the root cause in the test (proper web-first assertions, waiting for the specific response or element, isolated data) or in the app if the app has a real race. Never add fixed sleeps, never raise global timeouts, never mark tests skip/fixme.
3. Do the same for every other spec you found flaky in step 1 (list them).
4. Run lint, tsc, Jest; run the changed specs locally if your setup allows (if a local Supabase cannot start, say so). Commit and push to origin e2e-flake-first-run-checklist (normal push, no PR). Full report in the final commit message body: each flaky spec, evidence (run ids), root cause, fix, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
