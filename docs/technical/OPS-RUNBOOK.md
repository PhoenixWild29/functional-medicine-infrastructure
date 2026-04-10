# CompoundIQ — Operations Runbook

**Version:** 1.0 | **Date:** April 5, 2026
**Audience:** CompoundIQ operations team

---

## Overview

This runbook documents standard operating procedures for every operational scenario the ops team may encounter. Each procedure includes: when it triggers, what to do, and how to verify resolution.

**Dashboard URL:** `https://functional-medicine-infrastructure.vercel.app/ops/pipeline`

---

## Daily Operations Checklist

Start of every shift:

- [ ] Log in to Ops Dashboard — check pipeline for orders in error states
- [ ] Check SLA Heatmap — acknowledge any breached SLAs
- [ ] Check Adapter Health — verify all pharmacy integrations are green
- [ ] Check Fax Triage — process any pending inbound faxes
- [ ] Review Slack #ops-alerts — catch up on any overnight alerts
- [ ] Check daily digest (posted at 14:00 UTC / 9:00 AM ET to #ops-daily)

---

## Incident Response Procedures

### 1. Order Stuck in SUBMISSION_FAILED

**Trigger:** Order has been in SUBMISSION_FAILED for more than 15 minutes. Slack alert fired.

**Steps:**
1. Open the order in the Pipeline view, click into the detail drawer
2. Check the **Submissions** tab — what tier was attempted? What was the error?
3. **If error is transient** (timeout, network issue):
   - Click **"Retry Submission"** — the adapter will attempt the same tier again
4. **If error is persistent** (authentication failure, invalid payload):
   - Click **"Force Tier 4 Fax"** — bypasses the failing tier and sends via fax
   - Notify the pharmacy integration team about the API issue
5. **If the pharmacy is down entirely:**
   - Click **"Reroute Pharmacy"** — select an alternative pharmacy (max 2 reroutes per order)
   - If reroute limit reached, escalate to ops manager for manual resolution

**Verification:** Order transitions out of SUBMISSION_FAILED to either SUBMISSION_PENDING (retry), FAX_QUEUED (fax fallback), or REROUTE_PENDING (reroute).

---

### 2. Circuit Breaker Tripped (Pharmacy API Down)

**Trigger:** Slack alert: "Circuit breaker OPEN for [Pharmacy Name]." 3 consecutive submission failures detected.

**Steps:**
1. Open **Adapters** page in Ops Dashboard
2. Find the pharmacy with red health indicator and OPEN circuit state
3. Check the **Recent Failures** section — what errors are occurring?
4. **If the pharmacy is having a temporary outage:**
   - Wait for the 5-minute cooldown. The circuit will auto-transition to HALF_OPEN.
   - In HALF_OPEN, 1 probe order is sent. If it succeeds twice, the circuit closes automatically.
5. **If the pharmacy confirmed their API is down:**
   - Click **"Force All to Fax"** to route all pending orders via Tier 4
   - Contact the pharmacy's technical team for an ETA on resolution
6. **If the circuit keeps tripping** (>1 trip per week):
   - Consider temporarily downgrading the pharmacy to Tier 4 until their API stabilizes
   - File a support ticket with the pharmacy

**Verification:** Circuit breaker returns to CLOSED (green) after 2 consecutive successful probes.

---

### 3. Fax Delivery Failed (FAX_FAILED)

**Trigger:** Order transitions to FAX_FAILED after 3 retry attempts. Slack alert fired.

**Steps:**
1. Open the order detail — check the **Submissions** tab for error messages
2. **Common causes and fixes:**

| Error | Cause | Fix |
|-------|-------|-----|
| Busy signal | Pharmacy fax line occupied | Click **"Retry Fax"** — automatic backoff will space retries |
| No answer | Pharmacy fax machine off or disconnected | Contact pharmacy by phone to verify fax number |
| Invalid number | Fax number in system is wrong | Update `pharmacies.fax_number` in the database, then retry |
| Transmission error | Line quality issue | Retry — usually resolves on subsequent attempts |

3. **If all retries exhausted and pharmacy unreachable:**
   - Click **"Reroute Pharmacy"** to try a different pharmacy
   - If reroute limit reached (2 of 2), contact the clinic to discuss options
   - Last resort: **"Cancel + Refund"** if no pharmacy can fill the order

**Verification:** Order transitions from FAX_FAILED to either FAX_QUEUED (retry), REROUTE_PENDING (reroute), or CANCELLED (cancel).

---

### 4. SLA Breach — Pharmacy Not Responding

**Trigger:** PHARMACY_ACK SLA breached (4+ business hours with no pharmacy acknowledgment). Slack alert at Tier 1.

**Steps:**
1. Open **SLA** page — find the breached SLA and click **"Acknowledge"** to stop escalation
2. Check the order detail:
   - Was the fax delivered successfully? (Check FAX_DELIVERED status)
   - Has the pharmacy sent an inbound fax response? (Check Fax Triage queue)
3. **If fax was delivered but no response:**
   - Call the pharmacy directly to confirm receipt
   - If they received it, ask for an estimated compounding time
   - Update the SLA with resolution notes
4. **If fax delivery is unconfirmed:**
   - Retry the fax: click **"Retry Fax"** on the order
5. **If pharmacy rejects the order by phone:**
   - Update order status to PHARMACY_REJECTED
   - Initiate reroute to an alternative pharmacy

**Verification:** SLA acknowledged and resolved with notes. Order progressing.

---

### 5. Patient Payment Expired (72 Hours)

**Trigger:** Order auto-transitions to PAYMENT_EXPIRED. No Slack alert (this is expected behavior).

**Steps:**
1. No ops action required — this is automatic
2. The patient received 2 SMS reminders (at 24h and 48h) before expiry
3. The order stays in PAYMENT_EXPIRED as a permanent record
4. **If the clinic wants to retry:**
   - The clinic creates a **new order** (the expired one cannot be reopened)
   - A new payment link is generated with a fresh 72-hour window

**Verification:** Order is in PAYMENT_EXPIRED. No further action needed unless clinic requests re-order.

---

### 6. Stripe Dispute (Chargeback)

**Trigger:** `charge.dispute.created` webhook received. Order transitions to DISPUTED. Slack alert to #ops-alerts + email to clinic admin + notify platform legal.

**Steps:**
1. **Immediate (within 1 hour):**
   - Acknowledge the Slack alert
   - Open the order detail — review the dispute reason from Stripe
   - Verify the evidence bundle was auto-assembled:
     - Payment confirmation (Stripe PaymentIntent)
     - Prescription submission proof (adapter submission record)
     - Shipping tracking (if available)
     - Provider signature hash verification
2. **Within 24 hours:**
   - Review the auto-assembled evidence for completeness
   - Add any additional evidence (e.g., patient communication records)
   - Coordinate with the clinic admin — they may have additional context
3. **Within 7 days:**
   - Submit the dispute evidence through Stripe
   - Stripe's dispute resolution window is 7 days — do not miss this deadline

**Outcomes:**
- **Dispute won:** Order returns to DELIVERED
- **Dispute lost:** Order transitions to REFUNDED

**Verification:** Evidence submitted to Stripe within 7 days. Outcome tracked in order record.

---

### 7. Stripe Transfer Failed (Clinic Payout Issue)

**Trigger:** `transfer.failed` webhook received. Slack alert. Order status does NOT change — this is a financial reconciliation issue only.

**Steps:**
1. **Important:** The patient's order is NOT affected. Fulfillment continues normally.
2. Check the failure reason in the transfer_failures log
3. **Common causes:**

| Cause | Fix |
|-------|-----|
| Clinic bank account invalid | Contact clinic admin to update bank info in Stripe Express |
| Stripe account restricted | Contact clinic admin to resolve Stripe requirements |
| Insufficient platform balance | Wait for next settlement cycle (rare) |

4. After 3 failed transfer attempts, escalate to finance ops for manual resolution
5. Contact the clinic admin to inform them of the payout delay

**Verification:** Transfer succeeds on retry or manual resolution.

---

### 8. Inbound Fax Triage

**Trigger:** New inbound fax appears in the Fax Triage queue.

**Steps:**
1. Open the fax in the triage queue
2. Read the OCR text preview (or click **"View Full PDF"** for the complete document)
3. **Identify the pharmacy** — the system auto-matches by fax number. If "Unknown Pharmacy," select manually.
4. **Match to an order** — search by order ID, patient name, or pharmacy name
5. **Select a disposition:**

| Disposition | When to Use | What Happens |
|-------------|-------------|-------------|
| **Acknowledge** | Pharmacy confirmed they received the prescription | Order transitions to PHARMACY_ACKNOWLEDGED |
| **Reject** | Pharmacy says they cannot fill (wrong formulation, out of stock, etc.) | Order transitions to PHARMACY_REJECTED. 2-hour follow-up SLA created. |
| **Query** | Pharmacy needs clarification (unclear Sig, missing info) | Order flagged for follow-up. No state change. |
| **Unrelated** | Fax is not a response to one of our orders (junk fax, wrong number) | Fax archived. No order affected. |

**Verification:** Fax removed from unprocessed queue. Order updated if applicable.

---

### 9. Catalog Price Discrepancy

**Trigger:** During CSV upload preview, items flagged with >10% price change.

**Steps:**
1. Review each flagged item:
   - Red badge = price increase
   - Blue badge = price decrease
2. **If expected** (pharmacy updated their pricing): Proceed with the upload
3. **If unexpected** (data entry error, wrong file): Reject the upload. Request corrected CSV.
4. **If significant increase** (>25%): Contact the pharmacy to confirm before applying
5. After upload, verify the catalog version in the Versions tab

**Note:** Price discrepancy alerts are warnings, not blockers. You can always proceed. Existing orders keep their locked snapshot prices — catalog changes never affect in-flight orders.

**If a bad catalog was uploaded:** Use the **"Rollback"** button within 24 hours to revert.

**Verification:** Catalog version updated. Flagged items reviewed and confirmed.

---

### 10. Application Health Issues

**Trigger:** Sentry error spike, user-reported issues, or health check failure.

**Steps:**
1. Check `https://functional-medicine-infrastructure.vercel.app/api/health`
   - If returns `{"status":"ok"}` — the application is running. Issue may be localized.
   - If returns error or timeout — deployment issue.
2. **If deployment issue:**
   - Go to Vercel dashboard
   - Click **"Rollback"** to restore the previous working deployment (instant)
   - Investigate the failing deployment's build logs
3. **If localized issue (specific page or feature):**
   - Check Sentry for error details
   - Identify the affected page/component
   - Escalate to engineering with: error message, affected URL, steps to reproduce
4. **If database issue:**
   - Check Supabase dashboard for database health
   - Verify RLS policies are active
   - Check if PITR (Point-in-Time Recovery) is needed

**Verification:** Health check returns OK. User-reported issue resolved.

---

## Escalation Matrix

| Severity | Response Time | Who to Contact | Channel |
|----------|-------------|----------------|---------|
| **Critical** — Orders failing, payments broken, site down | 15 minutes | On-call ops lead + engineering | PagerDuty + Slack #ops-alerts |
| **High** — SLA breaches, pharmacy API down, dispute received | 1 hour | Ops team | Slack #ops-alerts |
| **Medium** — Catalog issues, fax triage backlog, transfer failures | 4 hours | Ops team | Slack #ops-alerts |
| **Low** — Feature requests, UI issues, documentation updates | Next business day | Product/Engineering | Slack #eng-feedback |

---

## Key Contacts

| Role | Responsibility |
|------|---------------|
| Ops Lead | Daily pipeline monitoring, SLA management, shift coordination |
| Ops Manager | Escalation point for Tier 2+ SLA breaches, dispute coordination |
| Engineering | Application bugs, deployment issues, infrastructure |
| Finance | Transfer failures, payout reconciliation, dispute evidence |
| Legal | Dispute responses, BAA coordination, compliance questions |
| Clinic Admin | Stripe Connect issues, order questions, patient concerns |

---

*CompoundIQ — Every order monitored. Every deadline enforced. Every exception handled.*
