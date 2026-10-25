task-id: B-2026-10-25-04
status: ready
---
Thanks for B-2026-10-25-03 (all four branches merged with main and pushed).

Next: bring A's test-data cleanup script up to date. Branch test-data-cleanup-script (A, 4f46190) was written before #268 (patient protocol choice: treatment_proposals, treatment_proposal_options, proposal_choice_items, treatment_proposal_events, orders.proposal_option_id), before the fax PHI column (fax_id on phi_access_log, PR #271) and before today's E2E test data patterns. Sam runs it on prod only after Lauren's review.

`git fetch origin && git checkout -B test-data-cleanup-script origin/test-data-cleanup-script && git merge origin/main`.
1. Read A's report in that branch's head commit. Extend the script so test patients' proposals are handled: proposals are never deleted by design (append-only events and choice items, no DELETE grant for service_role on treatment_proposals). Decide and document the right handling for test data: e.g. the script runs as postgres in the SQL editor (not service_role), so it can delete them; or mark them cancelled and detach orders. Choose what keeps audit tables honest and explain.
2. Re-check every FK to the rows the script deletes (orders now referenced by proposal_choice_items; options by orders). Keep the preview counts, FK-safe order, idempotency, the Sunrise guard and the expected-count guard.
3. Add any new test data created on prod since A wrote it, matched by stable identifiers only (Beta Test MA, beta-test-provider*, QA*). Do not match by broad patterns.
4. Re-run the PGlite test with all migrations through main plus seeded proposals for a test patient; prove Sunrise and demo pharmacies untouched and idempotency.
5. `npm run lint` (0 warnings), tsc, Jest. Push test-data-cleanup-script (normal push, no PR). Report in the final commit body with the expected verification output.

Do not touch the production database, Vercel, Stripe or secrets.
