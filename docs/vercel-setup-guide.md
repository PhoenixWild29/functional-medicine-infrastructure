# Vercel Project Setup Guide

## Overview

This guide covers creating and configuring the CompoundIQ Vercel project for all three environments: production, staging (preview), and local development.

## Step 1: Create the Vercel Project

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New → Project**
3. Import the GitHub repository: `PhoenixWild29/functional-medicine-infrastructure`
4. Configure build settings:
   - **Framework Preset:** Next.js
   - **Root Directory:** `./`
   - **Build Command:** `next build`
   - **Install Command:** `npm install`
   - **Node.js Version:** 20.x
5. Click **Deploy**

## Step 2: Configure Environment Variables

In Vercel Dashboard → Project → Settings → Environment Variables, add each variable from `.env.example`.

Set the correct environment scope for each:

| Variable | Production | Preview | Development |
|----------|-----------|---------|-------------|
| `SUPABASE_URL` | prod project | staging project | local |
| `SUPABASE_SERVICE_ROLE_KEY` | prod key | staging key | local key |
| `STRIPE_SECRET_KEY` | `sk_live_xxx` | `sk_test_xxx` | `sk_test_xxx` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_xxx` | `pk_test_xxx` | `pk_test_xxx` |
| `PLAYWRIGHT_HEADLESS` | `true` | `true` | `false` |
| All others | prod values | test values | test values |

**Critical:** Never use `sk_live_` Stripe keys in preview or development environments.

## Step 3: Configure Webhooks

### Stripe
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Production URL: `https://your-domain.vercel.app/api/webhooks/stripe`
3. Events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `transfer.failed`
   - `charge.dispute.created`
4. Copy the signing secret → set as `STRIPE_WEBHOOK_SECRET`

### Documo (Fax)
1. Documo Dashboard → Webhook Settings
2. URL: `https://your-domain.vercel.app/api/webhooks/documo`
3. Copy the webhook secret → set as `DOCUMO_WEBHOOK_SECRET`

### Twilio (SMS)
1. Twilio Console → Phone Numbers → your number → Messaging
2. Webhook URL: `https://your-domain.vercel.app/api/sms/callback`
3. Method: HTTP POST

## Step 4: Enable Preview Environments

In Vercel Dashboard → Project → Settings → Git:
- Enable **Preview Deployments** for all branches
- This gives each PR its own URL automatically

## Step 5: Verify Cron Jobs

After deploying, verify cron jobs appear in:
Vercel Dashboard → Project → Settings → Cron Jobs

| Cron | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/sla-check` | Every 5 min | Check SLA deadlines and escalate |
| `/api/cron/payment-expiry` | Every 15 min | Expire unpaid orders after timeout |
| `/api/cron/adapter-health-check` | Every 10 min | Verify pharmacy adapter status |

## Step 6: Local Development Setup

```bash
# Copy the example env file
cp .env.example .env.local

# Fill in values from your Supabase local dev project
# Use Stripe test keys (sk_test_xxx)
# Run the app
npm run dev
```

## Environment Variable Checklist

### Database (6 vars)
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_ANON_KEY`
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `DATABASE_URL`

### Stripe (4 vars)
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_PUBLISHABLE_KEY`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`

### Twilio (4 vars)
- [ ] `TWILIO_ACCOUNT_SID`
- [ ] `TWILIO_AUTH_TOKEN`
- [ ] `TWILIO_PHONE_NUMBER`
- [ ] `TWILIO_WEBHOOK_SECRET`

### Documo (4 vars)
- [ ] `DOCUMO_API_KEY`
- [ ] `DOCUMO_ACCOUNT_ID`
- [ ] `DOCUMO_OUTBOUND_FAX_NUMBER`
- [ ] `DOCUMO_WEBHOOK_SECRET`

### Auth (2 vars)
- [ ] `JWT_SECRET`
- [ ] `CHECKOUT_TOKEN_EXPIRY`

### Monitoring (5 vars)
- [ ] `SENTRY_DSN`
- [ ] `SENTRY_AUTH_TOKEN`
- [ ] `NEXT_PUBLIC_SENTRY_DSN`
- [ ] `SENTRY_ORG`
- [ ] `SENTRY_PROJECT`

### Alerting (3 vars)
- [ ] `SLACK_WEBHOOK_URL`
- [ ] `SLACK_OPS_ALERTS_CHANNEL_ID`
- [ ] `PAGERDUTY_ROUTING_KEY`

### Adapter (4 vars)
- [ ] `ADAPTER_TIMEOUT_MS`
- [ ] `RETRY_MAX_ATTEMPTS`
- [ ] `CIRCUIT_BREAKER_THRESHOLD`
- [ ] `PLAYWRIGHT_HEADLESS`

### Next.js (2 vars)
- [ ] `NEXT_TELEMETRY_DISABLED`
- [ ] `NODE_ENV`

**Total: 34 variables**

> **Note on Sentry dual-config:** Both `SENTRY_DSN` (server-side) and `NEXT_PUBLIC_SENTRY_DSN` (client-side browser) are intentional — Sentry initializes separately in server components and client components in Next.js 14.
>
> **Note on Twilio webhook validation:** `TWILIO_AUTH_TOKEN` is used to verify the `X-Twilio-Signature` header on inbound SMS callbacks. `TWILIO_WEBHOOK_SECRET` is optional if using API Key auth instead.

## Security Rules

- `SUPABASE_SERVICE_ROLE_KEY` — server-side only, never in client bundle
- `STRIPE_SECRET_KEY` — server-side only, never in client bundle
- Only `NEXT_PUBLIC_*` variables are exposed to the browser
- Never commit `.env.local` — it is gitignored
- Rotate secrets immediately if accidentally committed or exposed
