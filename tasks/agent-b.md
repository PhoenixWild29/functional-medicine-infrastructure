task-id: B-2026-10-25-02
status: ready
---
Thanks for B-2026-10-25-01 (#268 locators, 6596c8d; its E2E is running).

Next: get the waiting branches ready to go onto main the moment #268 (proposals, migration 20261024000002) merges. The shared E2E database already has 000002 applied, so every branch must contain 000002 (from main, after #268 merges) or its E2E fails at schema sync.

Step 0: wait until origin/main contains the #268 squash commit (title starts "feat(proposals): patient protocol choice"). Check every 5 minutes with `git fetch origin && git log origin/main --oneline -5`. Until then, do nothing else on these branches. If it has not landed within 2 hours, push a commit "BLOCKED: #268 not merged" on a branch named waiting-268 and stop.

Then, for each branch below in this order: `git checkout -B <b> origin/<b> && git merge origin/main`, resolve conflicts keeping both sides, `npm ci` if the lockfile changed, `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build, push <b> (normal push). Report in each merge commit body (conflicts, migration list tail, results).
1. zod-4 (D; PR #270 open). After pushing, its CI re-runs.
2. ops-fax-viewer-documo (A; migration 20261024000003_phi_access_log_fax_id: confirm it sorts after 000002 and the A/D tests that name it still pass).
3. security-followups-2 (A): check its L12 migration number; it must be greater than every migration on main and on rls-user-write-lockdown (C is re-cutting that one as 20261024000004). If it collides or sorts before 000004, renumber it to the next free number (likely 20261024000005), update tests that name it, and say so.
4. signup-squatting (yours): if it has a migration, same numbering rule (after A's).
5. ci-playwright-container (A), e2e-shard-ready (D), flake-show-checklist (A), remove-dead-code (C): merge main, gates, push.
Do not open PRs (I do). Do not touch the production database, Vercel, Stripe or secrets.
