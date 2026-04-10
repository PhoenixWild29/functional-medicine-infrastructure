# Event Sequencing — WO-18 (REQ-IEL-007)

## Overview

CompoundIQ uses a dual ledger for event tracking:
- **`webhook_events`** — Stripe, Documo (outbound fax), and Twilio events
- **`pharmacy_webhook_events`** — per-pharmacy API events (Tier 1 / Tier 3)

Every event is idempotent: duplicate deliveries are detected via UNIQUE constraints before any state transitions occur.

---

## Tier 1 Happy Path (API Pharmacy)

```
Patient pays → Stripe webhook (payment_intent.succeeded)
    │
    ├─ CAS: AWAITING_PAYMENT → PAID_PROCESSING
    ├─ Stripe Connect transfer initiated (non-fatal if fails)
    └─ Tier branching: PAID_PROCESSING → SUBMISSION_PENDING
           │
           └─ Adapter submits order to pharmacy API (FRD 4)
                  │
                  └─ Pharmacy responds with external_reference_id
                         │
                         └─ order.confirmed webhook (pharmacy → platform)
                                │
                                ├─ CAS: SUBMISSION_PENDING → PHARMACY_ACKNOWLEDGED
                                ├─ Resolve SUBMISSION SLA
                                └─ Create PHARMACY_CONFIRMATION SLA (4h)
                                       │
                                       └─ order.compounding webhook
                                              │
                                              ├─ CAS: PHARMACY_ACKNOWLEDGED → PHARMACY_COMPOUNDING
                                              └─ Resolve PHARMACY_CONFIRMATION SLA
                                                     │
                                                     └─ order.shipped webhook
                                                            │
                                                            ├─ Cascade intermediate states if needed
                                                            ├─ CAS: READY_TO_SHIP → SHIPPED
                                                            ├─ Write tracking_number + carrier
                                                            ├─ Resolve SHIPPING SLA
                                                            └─ Log SMS intent (shipping_notification)
```

### Tier 1 Idempotency Chain
| Event | Idempotency Key | Table |
|-------|----------------|-------|
| payment_intent.succeeded | Stripe event.id (evt_xxx) | webhook_events.external_event_id |
| order.confirmed | Pharmacy event_id | pharmacy_webhook_events (pharmacy_id, event_id) |
| order.compounding | Pharmacy event_id | pharmacy_webhook_events (pharmacy_id, event_id) |
| order.shipped | Pharmacy event_id | pharmacy_webhook_events (pharmacy_id, event_id) |

---

## Tier 4 Happy Path (Fax Pharmacy)

```
Patient pays → Stripe webhook (payment_intent.succeeded)
    │
    ├─ CAS: AWAITING_PAYMENT → PAID_PROCESSING
    ├─ Stripe Connect transfer initiated
    └─ Tier branching: PAID_PROCESSING → FAX_QUEUED
           │
           └─ Tier 4 adapter sends fax via Documo (FRD 4)
                  │ stores documo_fax_id on orders
                  │
                  └─ fax.queued webhook (Documo → platform)
                         │
                         └─ Confirm documo_fax_id → order mapping (no state change)
                                │
                                └─ fax.delivered webhook
                                       │
                                       ├─ CAS: FAX_QUEUED → FAX_DELIVERED
                                       ├─ Resolve FAX_DELIVERY SLA
                                       └─ Create PHARMACY_ACKNOWLEDGE SLA (4h)
                                              │
                                              └─ Ops confirms pharmacy received
                                                     │ (manual step — fax received)
                                                     └─ CAS: FAX_DELIVERED → PHARMACY_ACKNOWLEDGED
                                                            └─ (continues as Tier 1 from here)
```

### Tier 4 Failure Path (fax.failed with retry)
```
fax.failed webhook (1st) → Log warning, no state change (retry cron handles resend)
fax.failed webhook (2nd) → Log warning, no state change
fax.failed webhook (3rd) → CAS: FAX_QUEUED → FAX_FAILED + Slack critical alert
                               └─ Ops must reroute or refund
```

### Tier 4 Idempotency Chain
| Event | Idempotency Key | Table |
|-------|----------------|-------|
| payment_intent.succeeded | Stripe event.id (evt_xxx) | webhook_events.external_event_id |
| fax.queued | Documo event.id | webhook_events.external_event_id |
| fax.delivered | Documo event.id | webhook_events.external_event_id |
| fax.failed | Documo event.id | webhook_events.external_event_id |
| fax.received (inbound) | documo_fax_id | inbound_fax_queue.documo_fax_id |

---

## DLQ (Dead Letter Queue)

Events enter the DLQ when `error IS NOT NULL AND retry_count > 3 AND processed_at IS NULL`.

| View | Source |
|------|--------|
| `webhook_dead_letter_queue` | Stripe, Documo, Twilio |
| `pharmacy_webhook_dead_letter_queue` | Per-pharmacy API |

DLQ entries are surfaced in:
1. The daily digest (M-03: DLQ count by source)
2. The ops dashboard (FRD 3)
3. DB-level alert triggers T-06 and T-07 → `ops_alert_queue`

---

## Orphaned Submission Detection

The submission-reconciliation cron (every 30 min) flags `adapter_submissions` with:
- `status = 'PENDING'`
- `created_at < now() - 15 minutes`

These indicate the pharmacy did not send an `order.confirmed` webhook within the SLA window.
Ops is alerted via Slack #ops-alerts and the `ops_alert_queue` table.
