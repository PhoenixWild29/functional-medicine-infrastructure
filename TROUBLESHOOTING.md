# Troubleshooting Guide

## Webhook Issues

### Stripe webhook signature verification fails

**Symptom:** `POST /api/webhooks/stripe` returns 400 with "Invalid signature"

**Causes and fixes:**
1. `STRIPE_WEBHOOK_SECRET` is wrong or from a different endpoint
   - In Stripe dashboard → Webhooks → select endpoint → reveal signing secret
   - Update in Vercel environment variables
2. Request body was consumed before signature check (Next.js body parsing conflict)
   - Ensure the Stripe route uses `req.text()` not `req.json()` for the raw body
3. Stripe CLI forwarding issue locally
   - Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
   - Use the CLI-provided webhook secret (not dashboard secret) in `.env.local`

### Documo webhook HMAC failure

**Symptom:** `POST /api/webhooks/documo` returns 400

**Fix:** Verify `DOCUMO_WEBHOOK_SECRET` matches the secret configured in the Documo dashboard under Webhook Settings.

### Twilio webhook validation fails

**Symptom:** SMS status callbacks rejected

**Fix:** Verify `TWILIO_WEBHOOK_SECRET` (the auth token) matches. Twilio uses the auth token to sign webhook requests.

---

## Payments

### Stripe payment intent creation fails

**Symptom:** Checkout page shows "Unable to process payment" error

**Causes and fixes:**
1. Clinic's Stripe Connect account is not `ACTIVE`
   - Check `stripe_connect_status` in the `clinics` table
   - The clinic needs to complete Stripe onboarding in the Clinic Admin settings
2. Missing `STRIPE_SECRET_KEY` or incorrect key (test vs live mode mismatch)
3. Amount is zero or negative
   - Check `retail_price_snapshot` is set on the order

### Stripe transfer fails after payment

**Symptom:** Order stays in `PAID_PROCESSING` instead of advancing; `transfer_failures` row created

**Fix:** Check the clinic's Stripe Connect account restrictions:
- Log into Stripe → Connect → Accounts → find clinic account
- Look for payout schedule issues, identity verification requirements, or restricted capabilities

---

## Circuit Breaker

### Circuit breaker stuck OPEN for a pharmacy

**Symptom:** All Tier 1/2/3 submissions to a pharmacy fail instantly; orders route to Tier 4

**Diagnosis:**
```sql
SELECT pharmacy_id, state, failure_count, cooldown_until
FROM circuit_breaker_state
WHERE state IN ('OPEN', 'HALF_OPEN');
```

**Fix (ops dashboard):**
1. Go to Ops Dashboard → Adapter Health
2. Find the pharmacy with OPEN circuit breaker
3. Click "Close Circuit" to manually reset to CLOSED state

**Fix (SQL — emergency):**
```sql
UPDATE circuit_breaker_state
SET state                    = 'CLOSED',
    failure_count            = 0,
    cooldown_until           = NULL,
    last_failure_at          = NULL,
    tripped_by_submission_id = NULL
WHERE pharmacy_id = 'pharmacy-uuid-here';
```

---

## RLS Policy Debugging

### "Row not found" errors for known-existing rows

**Symptom:** API returns 404 or empty result for a row that exists in the database

**Cause:** RLS is filtering out the row because the JWT claims don't match

**Debug steps:**
1. Check the JWT claims in the browser (DevTools → Application → Local Storage → Supabase auth token → decode)
2. Verify `clinic_id` claim matches the row's `clinic_id`
3. For ops-admin routes: verify `app_role = ops_admin` in `user_metadata`

**Verify service_role is used in API routes:**
```typescript
// Correct — bypasses RLS
import { createServiceClient } from '@/lib/supabase/service'
const supabase = createServiceClient()

// Wrong — uses anon key, RLS applies
import { createClient } from '@/lib/supabase/client'
```

### New table missing RLS policy

**Symptom:** All rows invisible to authenticated users

**Fix:** Add RLS policies in a new migration. See [docs/migration-guide.md](docs/migration-guide.md) for patterns.

---

## Fax Issues

### Fax delivery permanently failed (FAX_FAILED status)

**Symptom:** Order stuck in `FAX_FAILED`; ops alert in `#ops-alerts`

**Steps:**
1. Check Documo dashboard for the fax job status and error code
2. Verify the pharmacy fax number is correct in the `pharmacies` table
3. Common errors:
   - `BUSY` / `NO_ANSWER`: Retry manually via Ops Dashboard → Order Detail → Retry Fax
   - `INVALID_NUMBER`: Update the pharmacy fax number in the database

### Inbound fax not matching to an order

**Symptom:** Fax appears in `inbound_fax_queue` with status `UNMATCHED`

**Fix:** Go to Ops Dashboard → Fax Triage → manually match the fax to the correct order or pharmacy.

---

## SMS Issues

### SMS not delivered (status = `undelivered`)

**Symptom:** Patient did not receive payment link SMS

**Steps:**
1. Check `sms_log` for error_code:
   ```sql
   SELECT error_code, to_number, status FROM sms_log WHERE order_id = 'order-uuid';
   ```
2. Common Twilio error codes:
   - `30003` — Unreachable destination handset
   - `30006` — Landline or unreachable carrier
   - `21610` — Patient opted out (STOP message)
3. For `21610`: Patient needs to text START to re-opt-in, OR use clinic notification fallback

### SMS rate limit hit

**Symptom:** `sms_log` shows error after several SMS sends to same number

**Cause:** Rate limit of 5 SMS per 24h per phone number exceeded

**Fix:** Wait for the 24h window to reset. This is a HIPAA-motivated guard to prevent SMS spam.

---

## SLA / Alerting

### Slack alerts not firing for breached SLAs

**Symptom:** SLA deadline passed but no Slack message in `#ops-alerts`

**Steps:**
1. Check `ops_alert_queue` for pending (unsent) alerts:
   ```sql
   SELECT * FROM ops_alert_queue WHERE sent_at IS NULL ORDER BY created_at DESC;
   ```
2. If alerts are queued but not sent: check `SLACK_WEBHOOK_URL` is valid
3. If no alerts queued: verify `sla-check` cron is running (Vercel → Functions → cron jobs)
4. Check `sla_notifications_log` to see if notifications were sent and deduplicated

### PagerDuty incident not created for Tier 3 SLA breach

**Cause:** `PAGERDUTY_ROUTING_KEY` not set or invalid

**Fix:** Verify `PAGERDUTY_ROUTING_KEY` in Vercel environment variables. Test manually:
```bash
curl -X POST https://events.pagerduty.com/v2/enqueue \
  -H "Content-Type: application/json" \
  -d '{"routing_key":"YOUR_KEY","event_action":"trigger","payload":{"summary":"Test","severity":"info","source":"test"}}'
```

### PagerDuty incident not resolving after order is delivered

**Symptom:** PagerDuty incident stays OPEN after the SLA condition was cleared

**Steps:**
1. Check `order_sla_deadlines` to confirm `resolved_at` was set:
   ```sql
   SELECT order_id, sla_type, resolved_at FROM order_sla_deadlines WHERE order_id = 'order-uuid';
   ```
2. If `resolved_at` is NULL: the resolve code path was not reached. Check `resolveSlasForTransition()` call in the status transition that should have resolved the SLA.
3. If `resolved_at` is set but PagerDuty is still open: the `resolveSlaEscalation()` call failed. Check Sentry for errors on that order's transition.
4. Manually resolve via the PagerDuty API:
   ```bash
   curl -X POST https://events.pagerduty.com/v2/enqueue \
     -H "Content-Type: application/json" \
     -d '{"routing_key":"YOUR_KEY","event_action":"resolve","dedup_key":"sla-<order_id>-<sla_type>"}'
   ```

### PagerDuty alert fired but wrong severity

**Cause:** Only Tier 3 escalations should fire PagerDuty (critical severity). If Tier 1 or Tier 2 alerts are appearing, `triggerSlaEscalation()` is being called outside of the Tier 3 escalation branch in the cron.

**Fix:** Check the SLA cron handler to confirm the guard `if (escalationTier === 3)` wraps every `triggerSlaEscalation()` call.

---

## Type Generation

### TypeScript error: "Property X does not exist on type Database"

**Cause:** `src/types/database.types.ts` is stale after a recent migration

**Fix:**
```bash
npm run db:types
```

If the CI pipeline is failing with this error, the types file must be regenerated and committed before pushing.

---

## Database Connection

### Supabase connection timeout in serverless functions

**Symptom:** Vercel function times out on database operations

**Fix:**
1. Use the Supabase connection pooler URL (Supabase dashboard → Settings → Database → Connection pooling → Transaction mode)
2. Set `SUPABASE_URL` to the pooler URL for serverless environments
3. Ensure `NEXT_PUBLIC_SUPABASE_URL` uses the standard project URL (for client-side auth)

---

## Authentication

### Login page shows 404 or is unreachable

**Cause:** `src/app/login/page.tsx` may not have been deployed (check Vercel build log).

**Fix:** Confirm the file exists and `npm run build` passes locally. Verify the Vercel deployment includes the latest commit.

### Callback fails after email verification link is clicked

**Symptom:** `/auth/callback` returns an error or redirects to `/login?error=auth_callback_failed`

**Causes and fixes:**
1. `JWT_SECRET` is wrong or rotated — set the correct value in Vercel environment variables
2. `/auth/callback` is not in middleware `publicRoutes` — the route will redirect to `/login` before the PKCE exchange can run
   - Fix: ensure `publicRoutes` in `src/middleware.ts` includes `/auth/callback`
3. Supabase "Confirm email" is enabled — the verification link redirects to `/auth/callback?code=...`; if the code has expired (10-minute window), the exchange will fail. Re-send the verification email.

### Ops admin cannot see cross-clinic data (RLS blocking)

**Symptom:** Ops pipeline shows empty or shows only one clinic's orders

**Cause:** `app_role = ops_admin` is not in the user's JWT claims

**Debug:**
```sql
-- Check what Supabase sees for this user's JWT
SELECT auth.jwt() -> 'user_metadata' ->> 'app_role';
```

**Fix:** Verify the user was created with `user_metadata: { app_role: 'ops_admin' }`. If the user was created with `app_metadata` instead of `user_metadata`, update via the Supabase dashboard → Authentication → Users → edit user → User Metadata.

### User redirected to `/unauthorized` after login

**Cause:** `app_role` in `user_metadata` is missing, misspelled, or uses a value not in the allowed roles list

**Allowed values:** `ops_admin`, `clinic_admin`, `provider`, `medical_assistant`

**Fix:** Check the user's metadata in the Supabase dashboard and correct the `app_role` value.

---

## POC Feature Flags

### SMS not being sent (`TWILIO_ENABLED=false`)

**Expected behavior:** SMS dispatch is suppressed. Only non-PHI metadata is logged to the Vercel function console (`order_id`, `template_name`, `to=...XXXX`). The SMS body is intentionally omitted from logs for HIPAA compliance.

**To retrieve the checkout token for manual testing:**
```sql
SELECT checkout_token FROM orders WHERE order_id = 'your-order-uuid';
```
Then navigate to `https://<vercel-url>/checkout/<token>` directly.

**To re-enable:** Set `TWILIO_ENABLED=true` in Vercel environment variables and redeploy.

### Fax not being sent (`DOCUMO_ENABLED=false`)

**Expected behavior:** Fax submission is suppressed. A synthetic fax ID (prefixed `poc-disabled-fax-`) is assigned. The order still transitions to `FAX_QUEUED` and all SLA/audit trail records are created. The prescription PDF is still built and uploaded to Supabase Storage.

**Note:** Synthetic fax IDs (`poc-disabled-fax-*`) are NOT real Documo job IDs and will not appear in the Documo dashboard.

**To re-enable:** Set `DOCUMO_ENABLED=true` in Vercel environment variables and redeploy.

### `requireEnv()` throws even though a service is disabled

**Cause:** `TWILIO_ENABLED=false` or `DOCUMO_ENABLED=false` suppresses the service call, but does not remove the `requireEnv()` check for that service's credentials. All env vars must be set to at least a placeholder value (e.g. `placeholder`) to prevent runtime errors.

**Fix:** Set all Twilio or Documo env vars to placeholder strings in Vercel, even if `ENABLED=false`.

---

## Seed Script

### `npm run seed:poc` fails with "Missing SUPABASE_URL"

**Fix:** Ensure `.env.local` exists and contains `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The script uses `dotenv-cli` to load `.env.local` — if the file is missing, these vars won't be set.

### Seed script runs but users cannot log in

**Cause:** Supabase "Confirm email" is enabled — users created with `email_confirm: true` bypass this, but if Auth settings override it, login may be blocked.

**Fix:** In Supabase dashboard → Authentication → Providers → Email, disable "Confirm email" for the POC project.

### Seed script shows "already exists — skipped" for everything but data looks wrong

**Cause:** The script is idempotent by deterministic UUID — it skips any row that already exists with the POC's fixed UUIDs. If data was manually edited between runs, the script won't overwrite it.

**Fix:** To reset POC data to a clean state, delete the rows with the deterministic UUIDs directly in the Supabase dashboard, then re-run `npm run seed:poc`.

### Catalog items not appearing in pharmacy search

**Cause:** The state-compliance filter in catalog search requires a matching `pharmacy_state_licenses` row for the search state. If the pharmacy license for TX was not seeded, no results appear.

**Fix:** Re-run `npm run seed:poc` (idempotent) — it will create the missing TX license for Strive Pharmacy if absent.
