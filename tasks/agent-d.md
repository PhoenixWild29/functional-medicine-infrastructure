task-id: D-2026-10-26-12
status: ready
---
PRIORITY. Merge day has started: Sam ran the fax SQL and #271 is merged (main eb36332). You are the merge steward from now on: when the orchestrator opens the next PR in the plan, you bring its branch up to date with main. This comes before everything else in your queue.

Now: PR #273 (rls-user-write-lockdown-v2, head 9611fd2) conflicts with main.
`git fetch origin && git checkout rls-user-write-lockdown-v2 && git pull && git merge origin/main`
- Resolve using your runbook's merge checklist and C's dry run 2 (the shared "newest migration" test: keep both 000003 and 000004 assertions in sort order). Keep every side's change.
- Gates: npm ci, lint (0 warnings), tsc, jest, next build. Push (normal push). Do NOT open or merge PRs; the orchestrator does that.
- Report in the merge commit body.
Then, for each later PR in the plan (security-followups-2, signup-squatting, rate-limit-db, bundle-security, bundle-ci, bundle-features, bundle-hipaa, bundle-docs, perf-indexes, clinical-difference-saved, signed-order-freeze), the orchestrator will post a task line here; do the same.

After #273 is pushed, continue with what was queued before (D-2026-10-26-11, the decisions code; the full text is in this file's git history at 1d9101d):
items 8 (hide Hybrid in pharmacy search), 9 (stale comment), 10 (portal poll fix + "Tracking pending"), 11 (delete permissions: creator or clinic admin; soft delete favorites if no migration needed), 12 (NEXT_PUBLIC_SUPPORT_EMAIL in Help), and invite must_change_password, on decisions-oct26 from origin/bundle-hipaa, then merged into bundle-hipaa. If a merge-steward line appears while you work on these, stop and do it first.

Do not touch the production database, Vercel, Stripe or secrets.
