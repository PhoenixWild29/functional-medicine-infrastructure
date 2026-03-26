# WO-8 Review Context: Third-Party SDK Integration

## Summary
WO-8 implements server-side SDK clients for all 7 third-party services: Stripe, Twilio, Documo, Playwright, Sentry, Slack, and PagerDuty. All clients are server-only, authenticated via `serverEnv`, and include mandatory HIPAA PHI boundary documentation.

## Files Delivered
| File | Service |
|------|---------|
| `src/lib/stripe/client.ts` | Stripe Node SDK v14, API 2024-12-18, 30s timeout |
| `src/lib/twilio/client.ts` | Twilio SDK v5, webhook signature validator |
| `src/lib/documo/client.ts` | Documo mFax REST v2 (fetch), HMAC-SHA256 webhook validation |
| `src/lib/playwright/config.ts` | Browser launch config, 30s timeout, screenshot bucket |
| `src/lib/sentry/phi-scrubber.ts` | PHI scrubbing — 11 regex patterns + key redaction |
| `sentry.client.config.ts` | Client Sentry init, no session replay |
| `sentry.server.config.ts` | Server Sentry init |
| `sentry.edge.config.ts` | Edge Sentry init |
| `src/lib/slack/client.ts` | Slack Incoming Webhook (fetch), PHI-safe alert builders |
| `src/lib/pagerduty/client.ts` | PagerDuty Events API v2 (fetch), dedup key pattern |
| `next.config.ts` | Wrapped with `withSentryConfig` |
| `src/lib/env.ts` | Added `twilioWebhookSecret()` |
| `package.json` | Added stripe ^14, twilio ^5, playwright ^1.45, @sentry/nextjs ^8 |
| `.env.example` | Added SENTRY_ORG, SENTRY_PROJECT |

## Acceptance Criteria Checklist

### Stripe
- [x] `stripe` (server Node SDK) v14.x in package.json
- [x] `createStripeClient()` uses API version `2024-12-18`
- [x] Timeout 30000ms
- [x] HIPAA comment: zero PHI in Stripe metadata/descriptions/line items

### Twilio
- [x] `twilio` v5.x in package.json
- [x] `createTwilioClient()` uses TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN
- [x] `validateTwilioWebhook()` validates X-Twilio-Signature
- [x] TWILIO_WEBHOOK_SECRET in `serverEnv`

### Documo
- [x] Fetch-based client (no official SDK)
- [x] `sendFax()` and `getFaxStatus()` exported
- [x] `validateDocumoWebhook()` uses HMAC-SHA256 via Web Crypto API (Edge-compatible)
- [x] HIPAA BAA note in comments
- [x] Timeouts via `AbortSignal.timeout()`

### Playwright
- [x] `playwright` v1.45.x in package.json
- [x] `getBrowserLaunchOptions()` respects PLAYWRIGHT_HEADLESS env var
- [x] `PLAYWRIGHT_TIMEOUT_MS = 30_000`
- [x] `SCREENSHOT_BUCKET = 'adapter-screenshots'` constant with TTL note

### Sentry
- [x] `@sentry/nextjs` v8.x in package.json
- [x] All 3 Sentry configs exist (client, server, edge)
- [x] All 3 configs wire `phiBeforeSend` in `beforeSend`
- [x] Session replay sample rates = 0 (no session replay — could capture PHI)
- [x] `next.config.ts` wrapped with `withSentryConfig`
- [x] `phi-scrubber.ts` has 11 regex patterns: phone, NPI, medication names, Stripe keys/IDs, API keys, passwords, vault secret IDs, email, SSN, DOB
- [x] `DROPPED_EXTRA_KEYS` drops: stripeEvent, stripeMetadata, documoPayload, twilioBody, pharmacyApiResponse, pharmacyWebhookPayload
- [x] `ALWAYS_REDACT_KEYS` covers all secrets: password, token, api_key, service_role_key, vault IDs, all service secrets

### Slack
- [x] Fetch-based client (no SDK)
- [x] `sendSlackAlert()` exported
- [x] PHI boundary documented: only order_id, status, tier, pharmacy slug, error codes
- [x] `buildSlaBreachAlert()` and `buildAdapterFailureAlert()` constructors enforce boundary

### PagerDuty
- [x] Fetch-based client (endpoint: https://events.pagerduty.com/v2/enqueue)
- [x] `triggerPagerDutyIncident()` and `resolvePagerDutyIncident()` exported
- [x] `dedup_key` pattern: `sla-{order_id}-{sla_type}` documented and implemented
- [x] `slaDedupKey()` helper exported

### Env
- [x] `twilioWebhookSecret()` added to `serverEnv`
- [x] All new secret vars in `serverEnv` only (never in `clientEnv`)

## Agent Review Result
**PASS** — All 33 criteria passed. No issues found.

## Commit
`355ec2b` — feat: WO-8 - Third-party SDK integration layer
