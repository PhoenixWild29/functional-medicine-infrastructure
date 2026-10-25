task-id: D-2026-10-25-03
status: ready
---
Thanks for D-2026-10-25-02 (axe on every route, 79109f7).

#268 (patient protocol choice, migration 20261024000002) is MERGED on main as 1a6362a. The shared E2E database has 000002, so every branch must contain main before its PR runs.

For each branch, in order: `git fetch origin && git checkout -B <b> origin/<b> && git merge origin/main`, resolve conflicts keeping both sides, `npm ci` if the lockfile changed, `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build, push <b> (normal push). Report in each merge commit body.
1. e2e-axe-all-routes: also add the new /plan/[token] states and the provider proposal UI (Review with options, Proposed tab, plan link dialog with Copy link / QR) to the route x role axe run if not already covered by #268's accessibility tests, and make the shard-ready helpers (if merged later) easy to adopt.
2. e2e-shard-ready: make sure the proposals spec and fixtures from #268 are shard-safe (per-shard patient, proposals cleanup per shard).
3. middleware-to-proxy (PR #266, on hold): merge main, gates, push (its CI re-runs).

Do not open PRs. Do not touch the production database, Vercel, Stripe or secrets.
