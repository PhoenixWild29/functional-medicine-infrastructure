task-id: B-2026-10-25-03
status: ready
---
#268 (patient protocol choice, migration 20261024000002) is MERGED on main as 1a6362a (Sam ran its SQL on prod). Your BLOCKED note (waiting-268) is resolved; no need to wait.

The shared E2E database has 000002, so every branch must contain main now. For each branch below, in this order: `git fetch origin && git checkout -B <b> origin/<b> && git merge origin/main`, resolve conflicts keeping both sides, `npm ci` if the lockfile changed, `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build, push <b> (normal push). Report in each merge commit body (conflicts, migration list tail, results).
1. zod-4 (D; PR #270 open, its CI re-runs on push).
2. ops-fax-viewer-documo (A; migration 20261024000003_phi_access_log_fax_id must sort after 000002; the tests that name it must pass).
3. security-followups-2 (A): its L12 migration must be numbered after 20261024000004 (C's lockdown, being re-cut). If it is not, renumber it to 20261024000005 (or the next free number), update tests that name it, and say so.
4. signup-squatting (yours): if it has a migration, number it after A's.
Do not open PRs. Do not touch the production database, Vercel, Stripe or secrets.
