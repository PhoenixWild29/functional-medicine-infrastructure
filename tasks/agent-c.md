task-id: C-2026-10-25-02
status: ready
---
Thanks for C-2026-10-25-01 (remove-dead-code, be108fb).

Next: re-cut D's RLS user-write lockdown (migration 20261024000004) cleanly on main.
D's branch rls-user-write-lockdown (head 47db60d) is stacked on the OLD security-review-oct24, which still carries H1 (demo payouts off with live keys). Main got that review WITHOUT H1 via #267 (security-review-oct24-no-h1). Merging D's branch as is would bring H1 back. H1 must stay out (Sam has not decided; it lives only on demo-payouts-live-key-guard).

Step 0: wait until origin/main contains #268 (title starts "feat(proposals): patient protocol choice", migration 20261024000002). Check every 5 minutes. If not within 2 hours, push "BLOCKED: #268 not merged" on a branch waiting-268-c and stop.

Then:
- `git fetch origin && git checkout -b rls-user-write-lockdown-v2 origin/main`.
- Bring over ONLY D's lockdown commits from rls-user-write-lockdown (the writer-proof changes, migration 20261024000004_rls_user_write_lockdown.sql + down, its PGlite tests, any service-client code changes). Use `git log origin/security-review-oct24..origin/rls-user-write-lockdown` to list them and cherry-pick those. Verify `git diff origin/main..HEAD -- src/lib/clinics/demo-payouts.ts` is empty (no H1).
- Confirm 000004 sorts after 000002 and 000003 (A's fax column; may not be on main yet, that is fine).
- Re-check D's writer table against main as it is now (proposals added new writers: treatment_proposals etc. are not in the lockdown list, but orders writes from proposals code must use the service role; if any user-client write to orders/patients/providers/payment_groups exists in the proposals code, report it and do not lock that table).
- `npm run lint` (0 warnings), tsc, Jest, build. Push rls-user-write-lockdown-v2 (normal push, no PR). Report in the final commit body: commits picked, H1 check, writer re-check, migration SQL in full, results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
