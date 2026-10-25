task-id: A-2026-10-25-12
status: ready
---
Thanks for A-2026-10-25-11 (three bundles, d215e6d last).

Next, two parts.

Part 1: prod SQL runbook (AI-facing; the orchestrator hands each block to Sam at its moment).
Branch: `git checkout bundle-docs && git pull`, then `git merge --no-ff origin/docs-run-sheet-v3` (D added the what's-new source and checklist v2 since you built it; docs only, confirm).
Add docs/ops/prod-sql-runbook-2026-10-25.md. For each migration, in merge order:
- 20261024000003 (ops-fax-viewer-documo), 000004 (rls-user-write-lockdown-v2), 000005 (security-followups-2), 000006 (signup-squatting), 000007 (rate-limit-db), 000008 (perf-indexes).
Give:
1. The exact SQL to paste in the Supabase SQL editor, copied VERBATIM from the branch's migration file at its current origin head (say the head SHA). If a file relies on anything the SQL editor does not do the same way as `supabase db push` (e.g. psql meta-commands, multiple statements needing separate runs, CONCURRENTLY), say so and give the editor-ready form.
2. One read-only verification SELECT returning named columns with the expected values (e.g. col_expect_1), checking every object the migration creates or changes (columns, indexes, policies, grants, functions, triggers).
3. Whether it is safe to run before its PR merges with the current prod code (it must be: prod code must keep working with the new schema). Check each one against main's code and say yes/no with the reason. Flag any that is not.
4. The down SQL, for emergencies only.
Also include scripts/checks/2026-10-25-drafts-missing-snapshots.sql (from state-machine-enforcement) as a read-only pre-merge check for bundle-features, verbatim.
Part 2: in the same doc, a merge checklist per PR in this order: fax, lockdown v2, security-followups-2, signup-squatting, rate-limit-db, bundle-security, bundle-ci, bundle-features, bundle-docs, perf-indexes. For each: which branch must merge origin/main first, which known combination fix applies at that point (e.g. the fax PDF route needs withApiErrors and refuseCrossSite once bundle-security meets the fax PR), and which prod SQL must run before it.
Gates: none beyond confirming docs-only changes. Push bundle-docs (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
