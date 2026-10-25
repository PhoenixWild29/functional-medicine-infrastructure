task-id: C-2026-10-25-03
status: ready
---
#268 (patient protocol choice, migration 20261024000002) is MERGED on main as 1a6362a. Your BLOCKED note (waiting-268-c) is resolved.

Do C-2026-10-25-02 now, without the wait: re-cut D's RLS user-write lockdown on main without H1.
- `git fetch origin && git checkout -b rls-user-write-lockdown-v2 origin/main`.
- Cherry-pick ONLY D's lockdown commits from rls-user-write-lockdown (list with `git log origin/security-review-oct24..origin/rls-user-write-lockdown`): writer-proof code changes, migration 20261024000004_rls_user_write_lockdown.sql + down, its PGlite tests. Verify `git diff origin/main..HEAD -- src/lib/clinics/demo-payouts.ts` is empty (no H1).
- Re-check D's writer table against main now (the proposals code writes orders; it must use the service role for every orders write; if any user-client write to orders/patients/providers/payment_groups exists, report it and do not lock that table).
- `npm run lint` (0 warnings), tsc, Jest, build. Push rls-user-write-lockdown-v2. Report in the final commit body with the migration SQL in full.

Then: `git checkout -B remove-dead-code origin/remove-dead-code && git merge origin/main`, resolve (the proposals code may now import something you removed, or add new dead code), gates, push.

Do not open PRs. Do not touch the production database, Vercel, Stripe or secrets.
