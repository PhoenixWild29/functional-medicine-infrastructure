# CompoundIQ — Pharmacy Integration Guide

**Version:** 1.0 | **Date:** April 5, 2026
**Audience:** Pharmacy technical teams, integration engineers, API developers

---

## Welcome

This guide is for compounding pharmacy technical teams who want to integrate with the CompoundIQ platform. Integration enables your pharmacy to receive structured, error-free prescription orders digitally — replacing faxed prescriptions with real-time API communication.

CompoundIQ supports four integration tiers. This guide covers Tier 1 (Direct REST API) and Tier 3 (Standardized API Specification), which are the recommended integration paths for pharmacies with technical capability.

---

## Integration Tiers — Which One Is Right for You?

| Tier | What You Need | What You Get | Setup Time |
|------|--------------|-------------|-----------|
| **Tier 1 — Direct API** | Your pharmacy already has a REST API | We integrate with your existing API. You receive orders and send status updates via webhooks. | 1–2 weeks |
| **Tier 3 — Our Published Spec** | Your pharmacy can implement an API | You implement our standardized specification. Same benefits as Tier 1 but using a common contract. | 2–4 weeks |
| **Tier 2 — Portal Automation** | Your pharmacy has a web portal (no API) | We automate order submission through your existing portal using headless browser technology. No development work on your end. | 1 week (our side) |
| **Tier 4 — Fax** | No API or portal | We fax prescriptions to your registered fax number. This is the default for all pharmacies. | Immediate |

**If your pharmacy has an existing API** (like ReviveRX, Vios, MediVera, or LifeFile), choose **Tier 1**.
**If your pharmacy wants to build an API**, choose **Tier 3** and implement our published specification.
**If your pharmacy only has a web portal**, we handle **Tier 2** — no work required from your team.

---

## Tier 1 — Integrating Your Existing API

### What We Need From You

1. **API base URL** — The root URL for your REST API (e.g., `https://api.yourpharmacy.com/v1`)
2. **Authentication credentials** — API key, bearer token, or OAuth client credentials
3. **API documentation** — Your endpoint specifications for order submission and status queries
4. **Webhook endpoint on your side** (optional) — If you want to push status updates to us proactively
5. **Test environment** — A sandbox or test mode for integration testing before going live

### What We Provide to You

1. **Webhook receiver endpoint** — `https://app.compoundiq.com/api/webhooks/pharmacy/{your-slug}`
2. **Webhook signing secret** — An HMAC-SHA256 shared secret for verifying webhook authenticity
3. **Order payload format** — The structure of prescription orders we send to your API
4. **Test orders** — Synthetic test prescriptions for validating the integration

### Order Submission Payload

When CompoundIQ submits an order to your API, the payload contains:

```json
{
  "order_id": "uuid",
  "prescription": {
    "medication_name": "Semaglutide",
    "form": "Injectable",
    "dose": "0.5mg/0.5mL",
    "strength": "0.5mg",
    "quantity": 1,
    "sig": "Take 0.5mg subcutaneous injection weekly",
    "refills": 0
  },
  "patient": {
    "first_name": "Alex",
    "last_name": "Demo",
    "date_of_birth": "1985-06-15",
    "phone": "+15125551234",
    "shipping_address": {
      "street": "123 Main St",
      "city": "Austin",
      "state": "TX",
      "zip": "78701"
    }
  },
  "provider": {
    "name": "Dr. Sarah Chen",
    "npi": "1234567890",
    "dea_number": "AC1234567",
    "clinic_name": "Sunrise Functional Medicine"
  },
  "submitted_at": "2026-04-05T14:30:00.000Z"
}
```

### Webhook Events — Status Updates From Your Pharmacy

Send status updates to our webhook endpoint as your pharmacy processes the order. Each webhook must include an HMAC-SHA256 signature for verification.

**Webhook endpoint:** `POST https://app.compoundiq.com/api/webhooks/pharmacy/{your-slug}`

**Required headers:**
```
Content-Type: application/json
X-Pharmacy-Signature: sha256=<HMAC-SHA256 of request body using shared secret>
X-Pharmacy-Event-Id: <unique event ID for idempotency>
```

**Supported event types:**

| Event Type | When to Send | Required Fields |
|-----------|-------------|----------------|
| `order.acknowledged` | You received and accepted the order | order_id, acknowledged_at |
| `order.compounding` | You started compounding | order_id, estimated_completion |
| `order.rejected` | You cannot fill this order | order_id, reason |
| `order.shipped` | You shipped the order | order_id, tracking_number, carrier |
| `order.delivered` | Order was delivered | order_id, delivered_at |

**Example webhook payload:**
```json
{
  "event_type": "order.acknowledged",
  "event_id": "evt_abc123",
  "order_id": "uuid-from-submission",
  "data": {
    "acknowledged_at": "2026-04-05T14:35:00.000Z",
    "estimated_completion": "2026-04-08T17:00:00.000Z"
  }
}
```

### Signature Verification

We verify every incoming webhook using HMAC-SHA256:

1. We compute `HMAC-SHA256(request_body, shared_secret)`
2. We compare the result to the `X-Pharmacy-Signature` header value
3. If they don't match, the webhook is rejected with HTTP 401

**Important:** Use timing-safe comparison to prevent timing attacks.

### Circuit Breaker Behavior

If your API returns errors on 3 consecutive submissions, our circuit breaker opens and we temporarily stop sending orders to your pharmacy. Here's what happens:

1. **3 consecutive failures** — Circuit opens. New orders cascade to fax (Tier 4).
2. **5-minute cooldown** — After 5 minutes, we send 1 test order to check recovery.
3. **2 consecutive successes** — Circuit closes. Normal order flow resumes.

Our ops team is notified immediately when a circuit breaker trips. We will contact your team to coordinate resolution.

---

## Tier 3 — Implementing Our Standardized Specification

If your pharmacy doesn't have an existing API but wants to build one, implement our standardized specification. This gives you the same real-time integration benefits as Tier 1.

### Endpoints You Need to Implement

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST /orders` | Receive a new prescription order | Accept the order payload (same format as Tier 1 above) |
| `GET /orders/{order_id}` | Return current order status | We poll this if webhooks are not configured |
| `POST /orders/{order_id}/cancel` | Cancel a pending order | We send this if the clinic cancels before fulfillment |
| `GET /health` | Health check | We ping this every 10 minutes to monitor your API status |

### Response Format

All responses should use this envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

On error:
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "INVALID_STATE",
    "message": "Order has already been shipped"
  }
}
```

### Authentication

Your API should accept a Bearer token in the Authorization header:
```
Authorization: Bearer <token-we-provide>
```

We store your API credentials in an encrypted vault (AES-256-GCM). They are never logged, never stored in plain text, and never included in error messages.

### Webhooks (Recommended)

While we can poll your `/orders/{id}` endpoint for status updates, webhooks are strongly recommended for real-time updates. The webhook format is the same as Tier 1 (see above).

---

## Testing Your Integration

### Sandbox Environment

We provide a staging environment for integration testing:
- **Staging URL:** `https://staging.compoundiq.com`
- **Test webhook endpoint:** `https://staging.compoundiq.com/api/webhooks/pharmacy/{your-slug}`
- **Test orders** use synthetic patient data — no real PHI

### Validation Checklist

Before going live, both teams should verify:

- [ ] Order submission succeeds (HTTP 200/201 response)
- [ ] Order acknowledgment webhook fires and is received by CompoundIQ
- [ ] Order rejection webhook fires with a reason code
- [ ] Shipping webhook fires with tracking number
- [ ] Webhook signature verification passes
- [ ] Circuit breaker trips and recovers correctly (simulate 3 failures, then recovery)
- [ ] Duplicate webhook delivery is handled (same event_id sent twice — only processed once)
- [ ] Error responses include meaningful codes and messages

### Go-Live Checklist

- [ ] Production API credentials stored in CompoundIQ Vault
- [ ] Production webhook signing secret exchanged securely
- [ ] IP allowlisting configured (optional but recommended)
- [ ] Rate limits agreed upon (default: 60 requests/minute)
- [ ] Escalation contacts exchanged (technical + operations)
- [ ] Monitoring configured on both sides

---

## Data Privacy & Compliance

### What Data We Send

Order payloads contain patient PHI (name, DOB, address, prescription details). This data is necessary for you to fill the prescription. By integrating, your pharmacy agrees to handle this data in accordance with HIPAA requirements.

### What We Expect

- All API endpoints must use HTTPS (TLS 1.2+)
- Patient data must not be logged in plain text on your end
- Webhook payloads should contain the minimum PHI necessary for the event
- Credentials must be rotated at minimum every 180 days

### Business Associate Agreement

A Business Associate Agreement (BAA) is required before production data flows between our systems. Our legal team will coordinate this as part of the onboarding process.

---

## Support & Contacts

| Need | Contact |
|------|---------|
| Integration technical support | integration@compoundiq.com |
| API credentials and secrets | security@compoundiq.com |
| Operations escalation | ops@compoundiq.com |
| BAA and legal | legal@compoundiq.com |

---

*CompoundIQ — Structured orders. Real-time tracking. No more faxes.*
