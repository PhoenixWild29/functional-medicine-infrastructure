task-id: A-2026-10-24-05
status: ready
---
Thanks for A-2026-10-24-04 (eslint-config-next 16.4.3; PR in turn).

Next: Issue Log item 95, a test-data cleanup script for prod, to be run BY SAM ONLY after Lauren has reviewed the test data. You write and test it; nobody runs it on prod now.

Branch: `git fetch origin && git checkout -b test-data-cleanup-script origin/main`.

Test data to remove (match by stable identifiers, never by broad patterns that could hit Sunrise demo data or real future data):
- QA Test Clinic and all its accounts, invites, onboarding steps/events, agreements acceptances, providers, licenses, patients, orders and their children.
- QA Test Pharmacy (application, licenses, terms, adapter config, catalog if any) and its pharmacy_admin login.
- Intake Test patient (Sunrise), QAImport Alpha, Bravo, Charlie (Sunrise), QAKeragon Echo and the QA Keragon connection (and its Vault secret).
- Beta Test Practice (beta-test-provider@sunrise-clinic.com) and Beta Test Practice 2 (beta-test-provider2@sunrise-clinic.com): clinics, logins, providers, licenses, onboarding rows.
- Beta Test MA (beta-test-ma@sunrise-clinic.com) at Sunrise: login and membership only; Sunrise itself stays.
- Anything created by E2E-style emails on prod if present (list what you match on).

1. Read the schema (supabase/migrations) and list every table with a FK or logical link to these rows, including auth.users, auth.identities, auth.sessions, auth.mfa_factors, Vault secrets, storage objects, phi_access_log (append-only: do NOT delete; say how it is handled), ledger and payables, sla and notification logs, onboarding events.
2. Write `scripts/cleanup/2026-10-24-test-data-cleanup.sql`: one transaction; a preview section first (SELECT counts per table for exactly what will be removed); then the deletes in FK-safe order; a final verification SELECT with expected zeros; idempotent (safe to run twice); refuses (RAISE EXCEPTION) if any matched clinic is Sunrise or if a match count is larger than expected.
3. Test it on PGlite or a local Postgres with all migrations applied and seeded copies of these rows plus Sunrise demo rows; prove Sunrise and the demo pharmacies are untouched and the script is idempotent. Add a Jest test that runs it on PGlite if the repo already has that harness (D used one for #245).
4. Commit and push to origin test-data-cleanup-script (normal push, no PR). Full report in the final commit message body: what is matched and how, every table touched with counts from your test, what is deliberately kept (phi_access_log, audit events) and why, expected verification output, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
