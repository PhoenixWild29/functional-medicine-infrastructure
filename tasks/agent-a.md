task-id: A-2026-10-23-02
status: ready
---
If Sam already pasted this exact task to you, do not redo it: finish it if unfinished, otherwise just mark the task-id done.

Continue on `ops-review-self-signup`. No migration (if one is needed, stop and report). Push only. Red test then fix per item.

1. `src/lib/clinics/portal-clinic.ts`: `isPortalOnboardedClinic` also returns true for clinics with `signup_source = 'self_serve'` (no invite needed). A self-signed-up clinic never sees the live Stripe "Start Onboarding" button.
2. Ordering opens on approval, using the demo payout path Sunrise uses: when ops approves a clinic (invited or self sign-up) that has no `stripe_connect_account_id`, the approve path sets `stripe_connect_account_id = 'poc_placeholder'` and `stripe_connect_status = 'ACTIVE'` in the same write as the approval. Behind `DEMO_PAYOUTS_ON_APPROVAL`, default on. Never overwrite a real Connect account id. Add "Demo payout account set on approval" to the approval history note.
3. `LAUNCH_COPY` ("Ordering opens at launch") shows only when a portal clinic has no active payout account.
4. `scripts/demo/2026-10-23-portal-clinic-payouts.sql`: idempotent; sets the placeholder and ACTIVE for approved portal clinics with no Connect account; check query at the end.
5. Tests: approve with no account sets the placeholder; real account untouched; flag off = today. E2E: an approved self-sign-up clinic's admin sees + New Prescription enabled.
6. Lint, tsc, Jest, build green. Put your full report (head SHA, files, Jest count, SQL blob SHA, expected check results) in the body of your final commit message and push.
