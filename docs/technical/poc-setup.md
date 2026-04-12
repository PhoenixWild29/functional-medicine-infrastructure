# CompoundIQ — POC Setup Runbook

This document covers every step required to stand up a working POC environment. All external services should be configured in **test / sandbox mode** — no real money, no real patients.

---

## Prerequisites

- Node.js ≥ 18 (use `.nvmrc` or `nvm use`)
- `npm` ≥ 9
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`npm install -g supabase`)
- [Vercel CLI](https://vercel.com/docs/cli) installed (`npm install -g vercel`)
- Accounts created for: Supabase, Vercel, Stripe, Twilio (optional), Documo (optional), Sentry, Slack (optional)

---

## Step 1 — Supabase Project

1. Go to [supabase.com](https://supabase.com) → New Project
2. Note your **Project Ref** (e.g. `abcdefghijklmnop`)
3. Link the CLI: `supabase link --project-ref <ref>`
4. Push all migrations: `supabase db push`
   - Verify in the Supabase dashboard → Table Editor that all 33 tables exist
   - Verify RLS is enabled on each table (Database → Tables → each row shows "RLS Enabled")
5. **Auth settings**: Supabase Dashboard → Authentication → Providers → Email
   - For POC: **disable** "Confirm email" so users from the seed script can log in immediately
6. Collect env vars from Supabase Dashboard → Project Settings → API:
   ```
   SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_URL
   SUPABASE_ANON_KEY
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   ```
7. Collect the database connection string from Project Settings → Database:
   ```
   DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
   ```
8. For CI/CD: set `SUPABASE_ACCESS_TOKEN` (from supabase.com → Account → Access Tokens) and `SUPABASE_PROJECT_REF`

---

## Step 2 — Local Build Verification

1. Copy `.env.example` to `.env.local` and fill in all Supabase vars (others can be placeholders for now)
2. Install dependencies: `npm install`
3. Verify TypeScript: `npm run build`
   - Fix any type errors before continuing
4. Run dev server: `npm run dev` — confirm `http://localhost:3000/login` loads

---

## Step 3 — Vercel Project

1. Go to [vercel.com](https://vercel.com) → Add New Project → Import from GitHub
2. Select the CompoundIQ repository
3. Framework preset: **Next.js** (auto-detected)
4. Add all environment variables from `.env.local` in the Vercel dashboard (Settings → Environment Variables)
   - Set for `Production` and `Preview` environments
   - `NODE_ENV` is auto-set by Vercel — do not override
5. Deploy: Vercel will build on the first push
6. Confirm build succeeds in the Vercel deployment log
7. After deploy, verify: `GET https://<vercel-url>/api/health`
   - Expected response: `{"status":"ok","db":"ok","version":"<git-sha>"}`
8. Collect for CI secrets:
   ```
   VERCEL_TOKEN      (Account Settings → Tokens)
   VERCEL_ORG_ID     (Settings → General → Team ID or Personal Account ID)
   VERCEL_PROJECT_ID (Project → Settings → General → Project ID)
   ```

---

## Step 4 — Stripe (Test Mode)

1. Log in to [stripe.com](https://stripe.com) → confirm **Test Mode** is active (toggle in header)
2. API keys (Developers → API Keys):
   ```
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```
3. **Connect platform setup** (required for clinic payment routing):
   - Stripe Dashboard → Connect → Get started → Platform type: Express
   - For POC: create one test Express account (Connect → Accounts → + Create) to represent the clinic
   - Copy the `acct_...` ID → set as `STRIPE_CONNECT_TEST_ACCOUNT_ID` (used by seed script)
4. **Webhook registration** (Developers → Webhooks → + Add endpoint):
   - URL: `https://<vercel-url>/api/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`
   - Copy signing secret:
     ```
     STRIPE_WEBHOOK_SECRET=whsec_...
     ```
5. Test the webhook: use the Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`) locally, or trigger a test event from the dashboard

---

## Step 5 — Twilio (Optional for POC)

> **If you don't have a verified Twilio number:** set `TWILIO_ENABLED=false`. SMS dispatch will be suppressed — only order metadata (order ID, template name, masked phone last 4) is logged to the Vercel function console; the SMS body is omitted for HIPAA compliance. To retrieve the checkout token for manual testing, query the `orders` table directly.
>
> ⚠️ **Important:** Even with `TWILIO_ENABLED=false`, all Twilio env vars (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WEBHOOK_SECRET`) must be set to placeholder values (e.g. `placeholder`) in Vercel. If left unset entirely, `requireEnv()` in `src/lib/env.ts` will throw at runtime if any code path touches them — even accidentally.

1. Log in to [twilio.com](https://twilio.com) → confirm trial/sandbox mode
2. Collect from Account Info:
   ```
   TWILIO_ACCOUNT_SID=ACxxxx...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=+1555...  (your verified or trial Twilio number)
   TWILIO_WEBHOOK_SECRET=...     (from API Keys → your signing key)
   ```
3. Register status callback: Twilio Console → Phone Numbers → your number → Messaging → Status Callback URL
   - `https://<vercel-url>/api/webhooks/twilio`

---

## Step 6 — Documo (Optional for POC)

> **If you don't have a Documo account:** set `DOCUMO_ENABLED=false`. Fax submissions will be suppressed — the prescription PDF is still built and uploaded to Supabase Storage, and the order still transitions to `FAX_QUEUED` using a **synthetic fax ID** (prefixed `poc-disabled-fax-`). The full order flow is demonstrable end-to-end.
>
> ⚠️ **Synthetic fax IDs are not real Documo job IDs.** Any `orders.documo_fax_id` values starting with `poc-disabled-fax-` were generated in `DOCUMO_ENABLED=false` mode and must not be used to look up fax status in the Documo dashboard, API, or for support tickets. They are POC artifacts only.
>
> ⚠️ **Important:** Even with `DOCUMO_ENABLED=false`, all Documo env vars (`DOCUMO_API_KEY`, `DOCUMO_ACCOUNT_ID`, `DOCUMO_OUTBOUND_FAX_NUMBER`, `DOCUMO_WEBHOOK_SECRET`) must be set to placeholder values in Vercel to prevent `requireEnv()` runtime errors.

1. Log in to [documo.com](https://documo.com) → mFax
2. Collect from API Settings:
   ```
   DOCUMO_API_KEY=...
   DOCUMO_ACCOUNT_ID=...
   DOCUMO_OUTBOUND_FAX_NUMBER=+1555...  (your Documo outbound number)
   DOCUMO_WEBHOOK_SECRET=...
   ```
3. Register webhook: Documo dashboard → Webhooks
   - URL: `https://<vercel-url>/api/webhooks/documo`

---

## Step 7 — Sentry

1. Go to [sentry.io](https://sentry.io) → New Project → Next.js
2. Collect:
   ```
   NEXT_PUBLIC_SENTRY_DSN=https://...@sentry.io/...
   SENTRY_AUTH_TOKEN=...    (User Settings → API Tokens → Create Token with project:releases scope)
   SENTRY_ORG=your-org-slug
   SENTRY_PROJECT=compoundiq
   ```
3. Verify PHI scrubbing: trigger a test error in development and confirm no PII appears in Sentry event breadcrumbs or extra data

---

## Step 8 — Slack (Optional for POC)

> If Slack is unavailable, set all Slack env vars (`SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_OPS_ALERTS_CHANNEL_ID`, `SLACK_OPS_MANAGER_USER_ID`) to placeholder values (e.g. `placeholder`). **Do not leave them unset** — `requireEnv()` will throw at runtime if any of these are absent when Slack code paths are reached. SLA alerts will fail silently (errors are caught and logged to console).

1. Create a Slack app at [api.slack.com](https://api.slack.com) → Your Apps → Create New App
2. Enable Incoming Webhooks → Add to Workspace → choose `#ops-alerts` channel
3. Collect:
   ```
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
   SLACK_BOT_TOKEN=xoxb-...          (OAuth & Permissions → Bot User OAuth Token)
   SLACK_SIGNING_SECRET=...          (Basic Information → App Credentials)
   SLACK_OPS_ALERTS_CHANNEL_ID=C...  (right-click channel → Copy link, extract ID)
   SLACK_OPS_MANAGER_USER_ID=U...    (click user profile → copy member ID)
   ```

---

## Step 9 — PagerDuty (Optional for POC)

For POC, PagerDuty is not required. SLA Tier 3 escalations will attempt to call PagerDuty but fail silently if the routing key is invalid.

```
PAGERDUTY_ROUTING_KEY=dummy-value-for-poc
```

---

## Step 10 — GitHub Actions Secrets

Set the following secrets in your GitHub repository (Settings → Secrets and variables → Actions).

### CI / Deploy Secrets

| Secret | Source |
|--------|--------|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | Supabase Project Settings |
| `SUPABASE_PROJECT_REF_STAGING` | Same as production for POC |
| `VERCEL_TOKEN` | Vercel Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel Settings → General |
| `VERCEL_PROJECT_ID` | Vercel Project → Settings |
| `SLACK_WEBHOOK_URL` | Step 8 above |

### E2E Playwright Secrets (required for the `e2e` CI job — WO-68)

The `e2e` job in `.github/workflows/ci.yml` starts a local `next dev` server and runs the full Playwright suite on every PR. It requires all server-side env vars the app needs at runtime:

| Secret | Value / Source |
|--------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API Keys |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry → Project → Client Keys |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `DATABASE_URL` | Supabase → Project Settings → Database (connection string) |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → endpoint |
| `JWT_SECRET` | Same value as your app `JWT_SECRET` |
| `SENTRY_AUTH_TOKEN` | Sentry → User Settings → API Tokens |
| `SENTRY_ORG` | Sentry org slug |
| `SENTRY_PROJECT` | `compoundiq` |

> **Notes:**
> - `TWILIO_ENABLED=false` and `DOCUMO_ENABLED=false` are hardcoded in the CI job — no secrets needed for Twilio/Documo.
> - `CHECKOUT_TOKEN_EXPIRY` is hardcoded to `3600` in CI — no secret needed.
> - `APP_BASE_URL` is hardcoded to `http://localhost:3000` in CI (local dev server) — no secret needed.
> - `PLAYWRIGHT_BASE_URL` is optional. If set, the E2E job runs against that URL instead of starting a local dev server. Set it to your Vercel preview URL if you prefer to run E2E against the deployed app.
> - Fork PRs from external contributors skip the E2E job automatically (secrets are unavailable on fork PRs — this is a GitHub limitation).

---

## Step 11 — Seed the Database

After infrastructure is configured, run the POC seed script:

```bash
cp .env.example .env.local
# Fill in all values from steps 1–10 above

npm run seed:poc
```

See [WO-54 Seed Script](../scripts/seed-poc.ts) for what is created. The script is idempotent — safe to run multiple times.

**Test users created by seed:**

| Role | Email | Password |
|------|-------|----------|
| `ops_admin` | `ops@compoundiq-poc.com` | `POCAdmin2026!` |
| `clinic_admin` | `admin@sunrise-clinic.com` | `POCClinic2026!` |
| `provider` | `dr.chen@sunrise-clinic.com` | `POCProvider2026!` |
| `medical_assistant` | `ma@sunrise-clinic.com` | `POCMA2026!` |

---

## Step 12 — E2E Validation

Follow the POC happy path documented in WO-55. Record issues in `docs/poc-validation-log.md`.

---

## Environment Variable Summary

All required vars with their sources:

| Variable | Required | Source |
|----------|----------|--------|
| `SUPABASE_URL` | ✅ | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Same |
| `SUPABASE_ANON_KEY` | ✅ | Same |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Same |
| `DATABASE_URL` | ✅ | Supabase → Project Settings → Database |
| `STRIPE_SECRET_KEY` | ✅ | Stripe → Developers → API Keys |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ | Same |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe → Webhooks → endpoint |
| `STRIPE_CONNECT_TEST_ACCOUNT_ID` | ✅ (seed) | Stripe → Connect → test account |
| `TWILIO_ACCOUNT_SID` | ⚠️ optional | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | ⚠️ optional | Same |
| `TWILIO_PHONE_NUMBER` | ⚠️ optional | Same |
| `TWILIO_WEBHOOK_SECRET` | ⚠️ optional | Twilio → API Keys |
| `TWILIO_ENABLED` | ✅ | Set `false` if no Twilio account |
| `DOCUMO_API_KEY` | ⚠️ optional | Documo → API Settings |
| `DOCUMO_ACCOUNT_ID` | ⚠️ optional | Same |
| `DOCUMO_OUTBOUND_FAX_NUMBER` | ⚠️ optional | Same |
| `DOCUMO_WEBHOOK_SECRET` | ⚠️ optional | Same |
| `DOCUMO_ENABLED` | ✅ | Set `false` if no Documo account |
| `JWT_SECRET` | ✅ | `openssl rand -base64 64` |
| `CHECKOUT_TOKEN_EXPIRY` | ✅ | `259200` (72h in seconds) |
| `APP_BASE_URL` | ✅ | Your Vercel deployment URL |
| `NEXT_PUBLIC_SENTRY_DSN` | ✅ | Sentry → Project → Client Keys |
| `SENTRY_AUTH_TOKEN` | ✅ | Sentry → User Settings → API Tokens |
| `SENTRY_ORG` | ✅ | Sentry org slug |
| `SENTRY_PROJECT` | ✅ | `compoundiq` |
| `SLACK_WEBHOOK_URL` | ⚠️ optional | Slack → App → Incoming Webhooks |
| `SLACK_BOT_TOKEN` | ⚠️ optional | Slack → App → OAuth |
| `SLACK_SIGNING_SECRET` | ⚠️ optional | Slack → App → Basic Info |
| `SLACK_OPS_ALERTS_CHANNEL_ID` | ⚠️ optional | Slack channel ID |
| `SLACK_OPS_MANAGER_USER_ID` | ⚠️ optional | Slack user ID |
| `PAGERDUTY_ROUTING_KEY` | ⚠️ optional | PagerDuty → Services → Integration |
| `ADAPTER_TIMEOUT_MS` | ✅ | `30000` |
| `RETRY_MAX_ATTEMPTS` | ✅ | `3` |
| `CIRCUIT_BREAKER_THRESHOLD` | ✅ | `0.5` |
| `PLAYWRIGHT_HEADLESS` | ✅ | `true` |
| `CRON_SECRET` | ✅ required | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — bearer token for all 10 cron endpoints |
