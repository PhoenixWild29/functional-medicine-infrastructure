# CompoundIQ — Architecture Overview

For the full system architecture diagram and infrastructure stack, see [docs/system-architecture.md](docs/system-architecture.md).

## Three-Application Architecture

The codebase serves three distinct audiences through a single Next.js application using route groups:

| Route Group | Audience | Auth |
|-------------|----------|------|
| `(clinic-app)` | Medical assistants, providers, clinic admins | Supabase Auth (clinic_id + app_role JWT claims) |
| `(ops-dashboard)` | CompoundIQ ops team | Supabase Auth (ops_admin role) |
| `(patient-checkout)` | Patients | Stateless — 72-hour checkout JWT token |

## Authentication Flows

### Clinic and Ops Users (Supabase Auth)

```
/login (public)
  → supabase.auth.signInWithPassword()
  → session cookie set (PKCE)
  → role-aware redirect:
      ops_admin          → /ops/pipeline
      clinic roles       → /dashboard
      no role / unknown  → /unauthorized

/auth/callback (public)
  → exchanges Supabase PKCE code for session
  → redirects to / (root handles role routing)
  → on failure → /login?error=auth_callback_failed

/ (root, server component)
  → no session → /login
  → ops_admin  → /ops/pipeline
  → clinic roles → /dashboard
```

Role claims are stored in `user_metadata.app_role` and `user_metadata.clinic_id`. The middleware (`src/middleware.ts`) enforces role checks on every request. Layouts provide a second layer of defense.

### Patients (Stateless Checkout Token)

```
AWAITING_PAYMENT transition
  → generateCheckoutToken() → 72h JWT (order_id, clinic_id)
  → SMS link: https://app.compoundiq.com/checkout/<token>

/checkout/<token> (Edge Middleware)
  → verifyCheckoutToken()
  → invalid/expired → /checkout/expired
  → valid → forwards x-checkout-order-id header to Server Components
```

No login required. Patients are never issued a Supabase session.

### Public Routes (No Auth Required)

| Route | Why Public |
|-------|-----------|
| `/login` | Entry point — no session yet |
| `/unauthorized` | Needs to render without valid session |
| `/auth/callback` | Cold visit from email verification link |
| `/api/webhooks/*` | External services (Stripe, Twilio, Documo) have no session |
| `/api/cron/*` | Vercel cron triggers use `CRON_SECRET` bearer token, not session cookies |
| `/api/health` | CI/CD health check — no session in deploy pipeline |

## Database Schema (26 tables, 10 enums)

Full ERD: [docs/erd.md](docs/erd.md)

**V1.0 (12 tables):** clinics, providers, patients, pharmacies, pharmacy_state_licenses, catalog, catalog_history, orders, order_status_history, webhook_events, order_sla_deadlines, inbound_fax_queue

**V2.0 (5 tables):** pharmacy_api_configs, pharmacy_portal_configs, adapter_submissions, normalized_catalog, pharmacy_webhook_events

**Additional (4):** sms_log, sms_templates, transfer_failures, disputes

**Incremental (5):** clinic_notifications, ops_alert_queue, circuit_breaker_state, sla_notifications_log, catalog_upload_history

## Four-Tier Adapter Architecture

Pharmacies are integrated at one of four tiers based on technical capability:

| Tier | Method | Latency | Used when |
|------|--------|---------|-----------|
| Tier 1 | Direct REST API | <5s | Pharmacy has CompoundIQ-compatible API |
| Tier 2 | Playwright portal automation | 30–120s | Pharmacy has a web ordering portal |
| Tier 3 | Standardized OpenAPI spec | <10s | Pharmacy implements CompoundIQ spec |
| Tier 4 | Fax via Documo | 1–4h | All pharmacies (universal fallback) |

The routing engine cascades: Tier 1/2/3 failure → Tier 4 fax. The circuit breaker (per pharmacy) opens after 5 failures and blocks Tier 1/2/3 for a 5-minute cooldown.

## Order State Machine (23 statuses)

```
DRAFT
  → AWAITING_PAYMENT (sign + send)
  → PAYMENT_EXPIRED  (72h without payment)

AWAITING_PAYMENT
  → PAID_PROCESSING  (Stripe payment_intent.succeeded)

PAID_PROCESSING
  → SUBMISSION_PENDING (adapter routing initiated)

SUBMISSION_PENDING
  → PHARMACY_ACKNOWLEDGED (pharmacy confirms receipt)
  → SUBMISSION_FAILED     (all tiers exhausted)
  → FAX_QUEUED            (Tier 4 fax sent)

PHARMACY_ACKNOWLEDGED
  → PHARMACY_COMPOUNDING (pharmacy begins work)
  → PHARMACY_REJECTED    (pharmacy rejects order)

PHARMACY_COMPOUNDING
  → PHARMACY_CONFIRMED  (pharmacy confirms completion)

PHARMACY_CONFIRMED
  → SHIPPED              (tracking number assigned)

SHIPPED
  → DELIVERED            (carrier confirms delivery)

... + CANCELLED, FAX_FAILED, REROUTE_PENDING, MANUAL_REVIEW
```

## Webhook Processing

All webhooks (Stripe, Documo, Twilio, pharmacy) share a 7-step pattern:

1. Verify HMAC signature
2. Parse payload with Zod schema
3. Check `external_event_id` for idempotency
4. Insert into `webhook_events`
5. Resolve order
6. Transition status via `casTransition()` (compare-and-swap)
7. Mark `processed_at`

## SLA Engine

8 SLA types monitor order lifecycle. A `sla-check` cron runs every 5 minutes and fires alerts at escalation tiers:

- **Tier 1**: Slack #ops-alerts channel message
- **Tier 2**: Slack DM to on-call (15-min re-fire timer)
- **Tier 3**: PagerDuty critical incident (phone wake-up)

## Multi-Tenant Isolation (RLS)

Every table has Row Level Security (RLS) enabled. The key JWT claim is `user_metadata.clinic_id`. Ops admins get a special `app_role = ops_admin` claim that grants cross-clinic SELECT access.

The server-side Supabase client (`service_role`) bypasses RLS and is used exclusively in API routes and cron jobs — never in client-side code.

## Vault Credential Management

Pharmacy API keys and portal passwords are stored in Supabase Vault (AES-256-GCM). The `pharmacy_api_configs` and `pharmacy_portal_configs` tables store only the UUID reference (`vault_secret_id`, `username_vault_id`, `password_vault_id`). The adapter layer decrypts credentials at runtime via `supabase.rpc('vault.decrypted_secret', ...)`.

## Key Architecture Decisions

**Why Next.js App Router?**
Server Components eliminate API round-trips for data-heavy clinic UI. Edge Middleware handles checkout token validation at the CDN edge without a cold start.

**Why Supabase Vault over BYTEA encryption?**
Vault manages key rotation, audit logging, and access control as a first-class feature. BYTEA encryption requires managing the encryption key in environment variables — a worse security posture.

**Why Stripe Connect Express?**
Express accounts allow clinics to receive disbursements without CompoundIQ holding funds. Each clinic gets its own Stripe account with direct payment flows.

**Why four adapter tiers?**
Each tier trades cost/complexity for speed. Tier 1 is fast but requires pharmacy API investment. Tier 4 fax is universal but slow. The four-tier cascade maximizes automation coverage across the fragmented pharmacy landscape.
