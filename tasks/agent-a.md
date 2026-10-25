task-id: A-2026-10-25-10
status: ready
---
Thanks for A-2026-10-25-09 (checkout-token-out-of-url, e040c71).

Next: a merge dry run, so the PR queue merges without surprises. About 20 branches are waiting; several touch the same files (Rx review/sign, order drawer, route handlers).

Work in a throwaway local branch: `git fetch origin && git checkout -b integration-dry-run origin/main`. Do NOT push this branch and do NOT open a PR.
Merge these origin branches in this order (the planned PR order), one by one with `git merge --no-ff`:
1. ops-fax-viewer-documo
2. rls-user-write-lockdown-v2
3. security-followups-2
4. signup-squatting
5. rate-limit-db
6. flake-show-checklist
7. ci-playwright-container
8. remove-dead-code
9. docs-oct25
10. e2e-axe-all-routes
11. e2e-shard-ready
12. perf-bundles
13. test-data-cleanup-script
14. docs-prod-clickthrough
15. ci-actions-node24
16. todo-sweep
17. token-pages-hardening
18. checkout-token-out-of-url
19. error-boundaries
20. api-input-validation
21. security-followups-3
22. rx-quantity-shipping
23. rx-allergies-required
24. favorites-frequent
25. docs-requirements-coverage
For each: clean or conflicted. On a conflict: resolve it correctly in the dry run, then record the files and the resolution. Then fix it at the source: on the LATER branch, `git merge origin/main` is not enough (main does not have the earlier one yet), so instead tell me exactly which branch should merge which earlier branch, or whether a reorder avoids it. Do not push changes to other agents' branches.
Also check migration numbering across all branches: list every new file in supabase/migrations with its branch; flag duplicates or out-of-order numbers.
After all merges: run lint (0 warnings), tsc, jest and next build on the result and report failures caused by the combination (not present on any single branch).
Report in a commit on a new branch `dry-run-report` (from origin/main) at docs/qa/merge-dry-run-2026-10-25.md, push it (normal push, no PR), and put the summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
