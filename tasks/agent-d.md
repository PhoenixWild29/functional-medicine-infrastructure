task-id: D-2026-10-25-16
status: ready
---
Thanks for D-2026-10-25-15 (clinical-difference-saved fixes, d21721a).

Next: close gaps B10 and B11 from C's HIPAA evidence map (origin/review-high-risk, docs/compliance/technical-safeguards-evidence-2026-10-25.md). Read them first.

Branch: `git fetch origin && git checkout -b password-flows origin/bundle-features`.
1. B11: password reset and change.
   - "Forgot password?" on /login: email the Supabase reset link (Supabase Auth resetPasswordForEmail with a redirect to a new /reset-password page). Same response whether or not the email exists. Rate limited with the existing limiter.
   - /reset-password: set a new password (policy: at least 12 characters, not in a small common-password list, not equal to the email); then sign out other sessions if Supabase allows; then to /login with a notice.
   - Settings > Account: Change password (current + new), same policy.
2. B10: POST /api/providers sets an admin-chosen password with no forced change. Instead: create the user with no usable admin-known password and hand over the existing one-time invite/set-password link (the Team invite flow already copies a link; reuse it). If the code path must keep a temporary password, flag the user (app_metadata must_change_password=true) and force /reset-password on first sign-in before any other page.
3. Do not change MFA rules (separate decision).
No email provider change: use Supabase Auth's own email. If Supabase email is not configured for prod, say so in the report; do not touch Supabase settings.
Tests: jest for the API routes and policy; E2E for change-password on a seeded test user only if it needs no new seed tables (unique locators; no getByRole('alert')).
No database migrations.
Gates: lint (0 warnings), tsc, jest, next build. Push password-flows (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
