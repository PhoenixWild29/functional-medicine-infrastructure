# CompoundIQ — API Reference

**Version:** 1.0 | **Date:** April 5, 2026
**Base URL:** `https://functional-medicine-infrastructure.vercel.app/api`

---

## Overview

CompoundIQ exposes a RESTful API built on Next.js App Router Route Handlers, deployed as Vercel serverless functions. All endpoints use JSON request/response bodies, return standard HTTP status codes, and follow consistent error envelope formatting.

**Authentication:** Most endpoints require a Supabase Auth JWT (passed as a session cookie). Webhook endpoints use service-specific signature verification. Cron endpoints use CRON_SECRET bearer token.

---

## Error Response Format

All errors return a consistent JSON envelope:

```json
{
  "error": {
    "code": "STATE_TRANSITION_INVALID",
    "message": "Order is not in the expected state",
    "details": "Expected AWAITING_PAYMENT, found PAID_PROCESSING",
    "request_id": "req_abc123",
    "timestamp": "2026-04-05T14:30:00.000Z"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|------------|-------------|
| ORDER_NOT_FOUND | 404 | Order ID does not exist |
| STATE_TRANSITION_INVALID | 409 | CAS failed — order not in expected state |
| PATIENT_NOT_FOUND | 404 | Patient record not found |
| MEDICATION_NOT_FOUND | 404 | Medication not in catalog |
| PHARMACY_NOT_FOUND | 404 | Pharmacy not configured |
| PAYMENT_REQUIRED | 402 | Payment has not been completed |
| CHECKOUT_EXPIRED | 410 | Checkout JWT token has expired (72-hour window) |
| FAX_SEND_FAILED | 502 | Documo fax dispatch failed |
| SMS_SEND_FAILED | 502 | Twilio SMS dispatch failed |
| WEBHOOK_SIGNATURE_INVALID | 401 | Webhook signature verification failed |
| RATE_LIMITED | 429 | Too many requests — check Retry-After header |
| IDEMPOTENCY_CONFLICT | 409 | Duplicate request detected |
| CIRCUIT_BREAKER_OPEN | 503 | Pharmacy integration temporarily unavailable |
| ADAPTER_SUBMISSION_FAILED | 502 | Order submission to pharmacy failed |
| ADAPTER_TIER_EXHAUSTED | 502 | All pharmacy channels exhausted |
| AI_CONFIDENCE_BELOW_THRESHOLD | 422 | Tier 2 portal submission needs manual review |
| PHARMACY_WEBHOOK_INVALID_SIGNATURE | 401 | Pharmacy webhook signature mismatch |

---

## Conventions

- **All timestamps:** ISO 8601 UTC (e.g., `2026-04-05T14:30:00.000Z`)
- **All IDs:** UUID v4
- **All monetary values:** Integer cents in API calls (e.g., `$45.00 = 4500`), NUMERIC(10,2) in database
- **Rate limiting:** 429 responses include `Retry-After` header with seconds to wait
- **Idempotency:** Webhook handlers use event_id for deduplication

---

## Endpoints

### Health Check

```
GET /api/health
```

No authentication required. Used by deployment pipeline.

**Response (200):**
```json
{
  "status": "ok",
  "db": "ok",
  "version": "abc1234"
}
```

---

### Pharmacy Search

#### Search Medications (Autocomplete)

```
GET /api/pharmacy-search/medications?q={query}
```

**Auth:** Supabase JWT (clinic_user)

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| q | string | Yes | Medication name query (min 3 characters) |

**Response (200):**
```json
{
  "medications": [
    {
      "medication_name": "Semaglutide",
      "form": "Injectable",
      "dose": "0.5mg/0.5mL"
    }
  ]
}
```

#### Search Pharmacies

```
GET /api/pharmacy-search?medication={name}&form={form}&dose={dose}&state={state}
```

**Auth:** Supabase JWT (clinic_user)

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| medication | string | Yes | Medication name |
| form | string | No | Dosage form filter |
| dose | string | No | Dose filter |
| state | string | Yes | 2-letter patient shipping state |

**Response (200):**
```json
{
  "results": [
    {
      "catalog_id": "uuid",
      "pharmacy_id": "uuid",
      "pharmacy_name": "Strive Pharmacy",
      "medication_name": "Semaglutide",
      "form": "Injectable",
      "dose": "0.5mg/0.5mL",
      "wholesale_price": 150.00,
      "average_turnaround_days": 5,
      "integration_tier": "TIER_4_FAX",
      "regulatory_status": "ACTIVE",
      "supports_real_time_status": false
    }
  ],
  "count": 1
}
```

Only pharmacies with an active license in the specified state are returned. BANNED pharmacies are excluded entirely.

---

### Orders

#### Create Order

```
POST /api/orders
```

**Auth:** Supabase JWT (clinic_user)

**Body:**
```json
{
  "patient_id": "uuid",
  "provider_id": "uuid",
  "catalog_id": "uuid",
  "pharmacy_id": "uuid",
  "retail_price": 300.00,
  "sig_text": "Take 0.5mg subcutaneous injection weekly"
}
```

**Response (201):**
```json
{
  "order_id": "uuid",
  "status": "DRAFT"
}
```

#### Sign and Send Payment Link

```
POST /api/orders/{orderId}/sign-and-send
```

**Auth:** Supabase JWT (provider or clinic_admin)

**Body:**
```json
{
  "signature_hash": "sha256-hex-string"
}
```

Transitions order from DRAFT to AWAITING_PAYMENT. Generates checkout JWT, dispatches SMS (if TWILIO_ENABLED=true), creates 3 SLA deadlines.

**Response (200):**
```json
{
  "order_id": "uuid",
  "status": "AWAITING_PAYMENT",
  "checkout_url": "https://functional-medicine-infrastructure.vercel.app/checkout/{jwt_token}"
}
```

#### Compliance Check

```
POST /api/orders/compliance-check
```

**Auth:** Supabase JWT (clinic_user)

Runs the 6 pre-dispatch compliance checks without actually sending.

**Body:**
```json
{
  "order_id": "uuid"
}
```

**Response (200):**
```json
{
  "all_passed": true,
  "checks": {
    "pharmacy_license": true,
    "provider_npi": true,
    "provider_signature": true,
    "price_validation": true,
    "stripe_connect_active": true,
    "dea_scheduling": true
  }
}
```

---

### Checkout

#### Create Payment Intent

```
POST /api/checkout/payment-intent
```

**Auth:** Checkout JWT token (from URL)

Creates a Stripe PaymentIntent with Connect fee splitting.

**Body:**
```json
{
  "order_id": "uuid",
  "email": "patient@example.com"
}
```

**Response (200):**
```json
{
  "client_secret": "pi_xxx_secret_xxx",
  "amount": 30000,
  "currency": "usd"
}
```

---

### Webhook Endpoints

All webhook endpoints return HTTP 200 regardless of internal processing result. Failures are handled via the Dead Letter Queue.

#### Stripe Webhooks

```
POST /api/webhooks/stripe
```

**Auth:** Stripe-Signature HMAC-SHA256 header

**Events processed:** payment_intent.succeeded, charge.dispute.created, transfer.failed, account.updated

#### Documo Webhooks

```
POST /api/webhooks/documo
POST /api/webhooks/documo/inbound
```

**Auth:** Documo webhook token verification

**Events:** fax.delivered, fax.failed, fax.received (inbound)

#### Twilio Webhooks

```
POST /api/webhooks/twilio
```

**Auth:** X-Twilio-Signature HMAC-SHA1

**Events:** SMS delivery status (delivered, failed, undelivered)

#### Pharmacy Webhooks

```
POST /api/webhooks/pharmacy/{pharmacySlug}
```

**Auth:** X-Pharmacy-Signature HMAC-SHA256 (per-pharmacy secret from Vault)

**Events:** order.acknowledged, order.compounding, order.rejected, order.shipped, order.delivered

---

### Cron Endpoints

All cron endpoints require `Authorization: Bearer {CRON_SECRET}` header.

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| POST /api/cron/sla-check | */5 * * * * | SLA breach scanning |
| POST /api/cron/sla-refire | */5 * * * * | Re-escalate stalled SLAs |
| POST /api/cron/payment-expiry | */15 * * * * | Auto-expire unpaid orders |
| POST /api/cron/adapter-health-check | */10 * * * * | Circuit breaker health |
| POST /api/cron/submission-reconciliation | */30 * * * * | Detect stuck submissions |
| POST /api/cron/portal-status-poll | */30 * * * * | Tier 2 status polling |
| POST /api/cron/fax-retry | */5 * * * * | Fax retry with backoff |
| POST /api/cron/screenshot-cleanup | 0 * * * * | Tier 2 screenshot cleanup |
| POST /api/cron/daily-digest | 0 14 * * * | Daily ops digest to Slack |
| GET /api/cron/poc-credential-sync | 0 5 * * * | Reset POC demo accounts to canonical passwords |

---

### Ops Endpoints

All ops endpoints require Supabase JWT with `app_role = 'ops_admin'`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/ops/pipeline | GET | List all orders with filters |
| /api/ops/orders/{id}/detail | GET | Full order detail with history |
| /api/ops/orders/{id}/action | POST | Order actions (retry, reroute, cancel, add tracking) |
| /api/ops/sla | GET | List SLA deadlines with breach status |
| /api/ops/sla/acknowledge | POST | Acknowledge an SLA breach |
| /api/ops/adapters | GET | Pharmacy adapter health status |
| /api/ops/adapters/{pharmacyId}/action | POST | Adapter actions (disable, force fax, health check) |
| /api/ops/fax | GET | Inbound fax triage queue |
| /api/ops/fax/{faxId}/action | POST | Fax disposition (acknowledge, reject, query, unrelated) |
| /api/ops/catalog | GET | Catalog items with search |
| /api/ops/catalog/upload | POST | CSV catalog upload |
| /api/ops/catalog/item | POST | Manual catalog item entry |
| /api/ops/catalog/rollback | POST | Rollback catalog to previous version |
| /api/ops/catalog/sync/{pharmacyId} | POST | Trigger API catalog sync |

---

### Rate Limits

| Endpoint Category | Limit | Scope |
|------------------|-------|-------|
| /api/orders, /api/catalog, /api/pharmacy-search | 100 req/min | Per clinic_id |
| /api/checkout/* | 10 req/min | Per IP |
| /api/clinics/*/onboard | 5 req/min | Per IP |
| /api/ops/adapters/* | 20 req/min | Per ops_admin |
| /api/webhooks/* | No limit | N/A (rejecting causes data loss) |
| /api/cron/* | No limit | Server-only |

All 429 responses include `Retry-After` header.

---

*CompoundIQ API — All endpoints serverless. All state transitions atomic. All webhooks idempotent.*
