task-id: B-2026-10-26-06
status: ready
---
Thanks for B-2026-10-26-05 (bundle-hipaa review: no merge defect, 3eeb710).

Next: E2E coverage for the HIPAA features, so bundle-hipaa's PR run checks them. D owns bundle-hipaa; put your work on a new branch `e2e-hipaa` from origin/bundle-hipaa, and D will merge it in.
Add e2e/hipaa-safeguards.spec.ts (register in playwright.config testMatch), using existing seed data only:
1. Forgot password: the page shows the same message for a seeded email and an unknown email (do not assert email delivery).
2. Change password: already covered by password-change.spec.ts? If so, skip; otherwise sign in as a seeded test user, change, sign out, sign in with the new password, and restore.
3. A non-recovery session posting to /api/auth/password gets 403.
4. Failed sign-ins: 5 wrong passwords for a seeded test user, then /ops/security as ops shows the alert (no raw email on the page).
5. Ops access review: /ops/access-review loads for ops, filters by date, shows rows; a clinic user gets refused.
6. Emergency reason: opening patient-level detail from ops prompts for a reason; Cancel does not open it.
7. Help: /help loads for a clinic user and its sections are reachable by keyboard.
Unique locators (no getByRole('alert')). Never enter a card. Keep it under ~3 minutes. If any step needs a seed the E2E project does not have, skip it with a clear comment.
Gates: lint (0 warnings), tsc, jest. Push e2e-hipaa (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
