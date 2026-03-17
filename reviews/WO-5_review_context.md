# WO-5 Review Context — Vercel Project Setup & Environment Configuration

## Work Order Summary

**WO:** 5
**Title:** Vercel Project Setup & Environment Configuration
**Status:** in_review
**Phase:** 1
**Assignee:** Samuel Shamber

## Files Created

| File | Description |
|------|-------------|
| `vercel.json` | Cron jobs, function config, security headers |
| `.env.example` | All 30 environment variables with descriptions |
| `docs/vercel-setup-guide.md` | Step-by-step Vercel project setup guide |

## Scope

### In Scope
- `vercel.json` with cron jobs, function memory/duration settings, security headers
- Environment variable template (no real values)
- Vercel project setup documentation

### Out of Scope
- Actual application code deployment (WO-6)
- Production pharmacy credentials (Vault — WO-4)
- Custom domain configuration (ops task)

## Acceptance Criteria Checklist

### vercel.json
- [ ] Valid JSON
- [ ] Framework set to `nextjs`
- [ ] Build command: `next build`
- [ ] 3 cron jobs present:
  - [ ] `/api/cron/sla-check` — `*/5 * * * *`
  - [ ] `/api/cron/payment-expiry` — `*/5 * * * *`
  - [ ] `/api/cron/adapter-health-check` — `*/15 * * * *`
- [ ] Webhook handlers (stripe, documo, pharmacy): 30s / 1024MB
- [ ] SMS callback (twilio): 10s / 512MB
- [ ] Checkout: 10s / 512MB
- [ ] All 3 cron functions: 60s / 1024MB
- [ ] Security headers on `/api/(.*)`: X-Content-Type-Options, X-Frame-Options, Referrer-Policy

### .env.example
- [ ] 30 variables total
- [ ] No real secrets — all placeholder values
- [ ] `NEXT_PUBLIC_` prefix only on browser-safe vars (STRIPE_PUBLISHABLE_KEY, SENTRY_DSN)
- [ ] Twilio webhook validation note present (TWILIO_AUTH_TOKEN used for signature verification)
- [ ] All 8 categories covered: Supabase, Stripe, Twilio, Documo, Auth, Sentry, Alerting, Adapter

### Documentation
- [ ] Vercel project creation steps present
- [ ] Stripe webhook setup steps present
- [ ] Documo webhook setup steps present
- [ ] Twilio SMS callback setup steps present
- [ ] Production vs staging key separation documented
- [ ] Local dev setup steps present
- [ ] Variable count shows 30

## Agent Review Result
**PASS after fixes** — 2 issues found and resolved:
1. Added Twilio webhook validation note to .env.example
2. Corrected variable count from 28 → 30, added Next.js vars to checklist

## How to Review with Cowork
1. Open Claude Cowork and connect to the `Functional Medicine` folder
2. Read this file, `vercel.json`, `.env.example`, and `docs/vercel-setup-guide.md`
3. Work through every checkbox above
4. If all pass, mark WO-5 as `completed` in the Software Factory
