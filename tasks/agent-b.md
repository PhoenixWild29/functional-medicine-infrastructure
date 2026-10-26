task-id: B-2026-10-26-11
status: ready
---
Thanks for B-2026-10-26-10 (jest-timing 1be952d). Excellent: 2,106 s to 554 s, a sync child process removed, and a CI job timeout. D will merge it into bundle-hipaa.

Next: independent review of origin/rls-aal2 (A, 524e924; PREPARED and decision-gated, migration 20261024000012). You have not seen it.
- The RESTRICTIVE policy on 28 PHI tables: any PHI table missing (check every table with patient or order data against the schema on signed-order-freeze, including any added by 000009-000011); any table where adding the restrictive policy breaks a legitimate path (e.g. a staff read that happens before MFA, a security-definer function that relies on caller RLS, a view).
- staff_mfa_satisfied(): SECURITY DEFINER with pinned search_path, the aal claim read, roles matching the app's MFA_ROLES and ALWAYS_MFA_ROLES, fail-closed behaviour, and no way for a client to read or change security_settings.
- With the switch OFF (default), confirm the only behaviour change is pharmacy_admin needing aal2 on these tables, and that pharmacy_admin flows in the app already have aal2 by then (so nothing breaks on merge).
- The down migration, and the PGlite harness (does it apply all migrations faithfully; any Supabase difference that would make a test pass that would fail on hosted Supabase).
For each finding: file:line, concrete scenario, severity, fix. Confirm before reporting. Do NOT push to rls-aal2. Append to docs/qa/review-2026-10-26-hipaa-fixes.md on review-hipaa-fixes, push, summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
