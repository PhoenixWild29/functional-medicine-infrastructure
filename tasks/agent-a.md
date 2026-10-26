task-id: A-2026-10-26-04
status: ready
---
Thanks for A-2026-10-26-03 (f4b7487 and the freeze merge 9e6fb0d). Clear SQL and env var list.

Next: prepare HIPAA gap B3 (C's evidence map, origin/review-high-risk docs/compliance/technical-safeguards-evidence-2026-10-25.md): MFA is not enforced in RLS, so a password-only session can read PHI through PostgREST. This is DECISION-GATED (Sam has not yet decided REQUIRE_MFA for all staff), so prepare it ready to ship, do not merge it anywhere.

Branch: `git fetch origin && git checkout -b rls-aal2 origin/signed-order-freeze` (it must sort after 000011).
- Migration 20261024000012_rls_require_aal2.sql + down: for every table with PHI (list them from the RLS inventory), add a RESTRICTIVE policy for authenticated that requires (auth.jwt() ->> 'aal') = 'aal2' for staff roles that are required to have MFA. Make the requirement follow the same rule as the app: pharmacy_admin always; other staff roles only when a database-side switch is on. Since env vars are not visible to Postgres, use a single-row settings table or a function returning a constant (say which, and how Sam flips it with one SQL statement). Patients (token pages) go through the service role and are unaffected; say so.
- App: when a staff user's session is aal1 and the switch is on, the app already redirects to MFA; confirm no page or API still reads PHI with the user-scoped client before that redirect.
- Tests: static migration test; a PGlite test where an aal1 JWT reads 0 rows and an aal2 JWT reads rows, per role, with the switch on and off.
- Also write docs/ops/session-timeout.md for B8: the hosted Supabase settings (names only) for session time-box and inactivity timeout, recommended values, and what users see.
PREPARED only. Gates: lint (0 warnings), tsc, jest, next build. Push rls-aal2 (normal push, no PR). Report in the commit body with the full SQL.

Do not touch the production database, Vercel, Stripe or secrets.
