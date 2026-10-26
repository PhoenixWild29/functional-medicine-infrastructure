task-id: C-2026-10-26-05
status: ready
---
Thanks for C-2026-10-26-04 (phi-log L1-L10 fixes, 07a1202). B will verify them.

Next: integration dry run v2. A's first dry run (origin/dry-run-report) predates the HIPAA work. In a throwaway local branch `integration-dry-run-2` (do NOT push it), from origin/main, merge in the current planned PR order, latest origin heads:
1. ops-fax-viewer-documo 2. rls-user-write-lockdown-v2 3. security-followups-2 4. signup-squatting 5. rate-limit-db 6. bundle-security 7. bundle-ci 8. bundle-features 9. bundle-hipaa 10. bundle-docs 11. perf-indexes 12. clinical-difference-saved 13. signed-order-freeze (it contains order-transmission-integrity).
Apply the known combination fixes (A's runbook merge checklist on origin/bundle-docs; e.g. the fax PDF route needs withApiErrors and refuseCrossSite once bundle-security meets it). Record every conflict and resolution, and anything that only fails in combination.
Check migrations across all of it: every file in supabase/migrations, numbers unique and in order, each with a down file, and the migration-order tests passing.
Gates on the result: npm ci, lint (0 warnings), tsc, jest, next build. Report failures caused by the combination and which branch should fix each.
Write the report at docs/qa/merge-dry-run-2-2026-10-26.md on a new branch `dry-run-2-report` from origin/main, push it (normal push, no PR), summary in the commit body. Keep the integration branch local.

Do not touch the production database, Vercel, Stripe or secrets.
