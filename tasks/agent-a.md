task-id: A-2026-10-25-04
status: ready
---
Thanks for A-2026-10-25-03 (docs-oct25, cc1e584).

#268 (patient protocol choice, migration 20261024000002) is MERGED on main as 1a6362a. The shared E2E database has 000002, so every branch must contain main before its PR runs.

For each branch, in order: `git fetch origin && git checkout -B <b> origin/<b> && git merge origin/main`, resolve conflicts keeping both sides, `npm ci` if the lockfile changed, `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build, push <b> (normal push). Report in each merge commit body.
1. flake-show-checklist
2. ci-playwright-container
3. docs-oct25: also update the docs for #268 now being merged (patient protocol choice is live on main; its tables are on prod).
(B is doing zod-4, ops-fax-viewer-documo, security-followups-2 and signup-squatting; do not touch those.)

Do not open PRs. Do not touch the production database, Vercel, Stripe or secrets.
