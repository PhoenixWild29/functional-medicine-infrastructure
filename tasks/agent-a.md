task-id: A-2026-10-23-03
status: ready
---
PR #247 (your branch `ops-review-self-signup`, head 2e7052a, which already has main merged) failed E2E on two tests in `e2e/self-serve-signup.spec.ts`. Fix both on the same branch. No migration (if one is needed, stop and report). Red test then fix. Push only.

1. REAL BUG, would break every approval on prod too. `clinics.stripe_connect_account_id` has a UNIQUE constraint (`clinics_stripe_connect_account_id_key`). Sunrise already holds 'poc_placeholder', so approving any other clinic with demo payouts fails: server log "[ops/onboarding] review failed ... action=approve: duplicate key value violates unique constraint clinics_stripe_connect_account_id_key" and the test waits in vain for "<name> approved. It can now sign and send orders." (spec line 234).
   Fix: the demo payout id is unique per clinic: `poc_placeholder_<clinic_id>`. Everywhere the app recognises the demo placeholder must accept the exact 'poc_placeholder' AND the `poc_placeholder_` prefix:
   - checkout PaymentIntent creation (`src/app/api/checkout/payment-intent/route.ts` isPocPlaceholder, and the payment-group intent route if it has the same check): omit Connect routing for both forms;
   - the Settings label helper `src/lib/stripe/demo-account.ts` (shows "Demo payout account");
   - any other place that compares to 'poc_placeholder' (grep the repo, including webhooks and ledger).
   Update `scripts/demo/2026-10-23-portal-clinic-payouts.sql` to set `'poc_placeholder_' || clinic_id` (still only where the account id is NULL or '').
   Tests: approving two clinics in a row both succeed; checkout omits transfer_data for the prefixed id; the label shows Demo payout account for it; a real `acct_...` id is unchanged.

2. Rate limit in the same spec: test "a pharmacy: /login > Get started ..." (line 248) now fails with server log "[signup] rate_limited | ip_hash=none" because your new ops-review test adds more sign-ups through the public form in the same run (all CI sign-ups share one IP). Fix the TEST, not the limiter: in the ops-review test, create the self-signed-up clinic, its provider, account and unverified NPI result directly with the service role (the same rows the sign-up writes), instead of going through /get-started. Keep everything the test asserts on the ops side.

3. Lint, tsc, Jest, build green. Put the full report (head SHA, files, Jest count, new SQL blob SHA) in the body of your final commit message and push.
