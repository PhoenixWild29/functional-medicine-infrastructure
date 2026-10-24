task-id: B-2026-10-24-08
status: ready
---
Thanks for B-2026-10-24-07 (proposals PR 4, 5c579c1). C is merging it into PR 5.

Next: D's M2/M3 from the security review (commit acde0fc on security-review-oct24), the parts that need no email sending (there is no email provider; do NOT switch logins to unconfirmed-until-email-click).

Branch: `git fetch origin && git checkout -b signup-squatting origin/main`.

1. M3, NPI squatting: today self-serve.ts:121-123 refuses an NPI already on any live provider with 409 NPI_TAKEN before anything is created, so a stranger can claim a real prescriber's NPI and block it, and probe which NPIs are customers. Change: uniqueness is enforced among APPROVED clinics' providers. A pending (unapproved) self-serve provider row does not block another sign-up with the same NPI; at ops approval, if the NPI is already on an approved clinic's live provider, Approve is refused with a clear ops-only message, and the ops review page flags "NPI also claimed by <n> other pending sign-up(s)". The public sign-up answer for an NPI that is taken by an approved clinic is the same generic response as any other validation failure the form can show for NPI (no customer-probing difference). Check every DB unique constraint/index on providers.npi_number; if one blocks this, propose the migration (number after the highest 20261024 one on any pushed branch; report it) and test on PGlite.
2. M2, email enumeration: the duplicate-email 409 at /api/signup lets anyone probe which emails have accounts. Make the response for "email already has an account" indistinguishable to the client from a successful submit where possible WITHOUT sending email: e.g. a neutral 202 "If this email can be used, your account is ready to sign in; otherwise sign in or reset your password" for both paths, while still creating nothing on the duplicate path. If that cannot be done without breaking the sign-up flow (the new user is signed in right after), explain and keep the 409 but rate-limit it harder and log it; say which you chose and why.
3. Ops: a way for ops to delete an unapproved self-serve sign-up (clinic, login, provider rows) from the ops review page, with confirmation and an onboarding event. Service role, ops_admin only, same-origin.
4. Red tests first; E2E: extend e2e/self-serve-signup.spec.ts for the NPI case and the ops delete.
5. `npm run lint` (0 warnings), tsc, Jest (--maxWorkers=3), build. Push signup-squatting (normal push, no PR). Full report in the final commit body.

Do not touch the production database, Vercel, Stripe or secrets.
