task-id: D-2026-10-24-07
status: ready
---
Thanks for D-2026-10-24-06 (#259 unblocked and merged, fax migration renumbered to 20261024000003, security follow-ups pushed).

Next: your finding L5, done safely. Pre-existing permissive user-write RLS policies let any clinic user (now any stranger with a self sign-up JWT, for their own new clinic) write through PostgREST and bypass the API's approval guard and signing checks: orders_clinic_user_insert/update, patients_clinic_user_insert/update, providers_clinic_user_insert/update, payment_groups_clinic_user_insert/update, provider_npi_verifications_admin_write, provider_state_licenses_admin_write.

Branch: `git fetch origin && git checkout -b rls-user-write-lockdown origin/security-review-oct24` (stacked on your rls_hardening branch, so migrations stay in order; this one will be the next number after 20261024000003, i.e. 20261024000004).

1. Prove, per table, that no app code path writes it with a user (anon key + session) client: trace every insert/update/upsert/delete on these tables in src (including libs that take a client parameter: batch-sign, apply-bundle-shipping, keragon sync, duplicates, refill, reroute, intake, signup link, team, onboarding) back to createServiceClient or a user client. Produce a table: table, writer file:line, client type. Any user-client writer: change it to the service client only if the route already authorizes properly (getUser, claims, approval guard), with a red test; otherwise report and stop for that table.
2. Write migration 20261024000004_rls_user_write_lockdown.sql (+ down): for each table proven safe, DROP POLICY the user write policy and REVOKE INSERT, UPDATE, DELETE, TRUNCATE FROM anon, authenticated. Keep every SELECT policy. End with `SELECT apply_pharmacy_admin_scope();`. Test it on PGlite with Supabase default grants: a clinic_admin JWT can no longer insert/update those tables via SQL as authenticated; service role still can; selects unchanged.
3. Run the full Jest suite and the E2E-relevant integration tests you can run locally; CI runs E2E on the PR.
4. `npm run lint` (0 warnings), tsc, Jest, build. Push rls-user-write-lockdown (normal push, no PR). Report in the final commit body: the writer table, any code changed, the migration SQL in full (Sam runs it on prod before merge), PGlite proof, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
