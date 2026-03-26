# CompoundIQ POC Validation Log — WO-55

Tracks every issue found during the POC end-to-end happy path walk-through.
Update this file in real time as each step is executed.

**Environment:** `https://<vercel-url>`
**Date:** ___________
**Validated by:** ___________

---

## Pre-flight Checklist

- [ ] `supabase db push` — all migrations applied, no errors
- [ ] `npm run build` — passes with no type errors
- [ ] `npm run seed:poc` — completed successfully
- [ ] All 4 test users can log in
- [ ] `/api/health` returns `{"status":"ok","db":"ok"}`
- [ ] Stripe test webhook delivery confirmed
- [ ] Sentry receives a test event with no PHI

---

## Happy Path Steps

### Step 1 — Login as Medical Assistant

**User:** `ma@sunrise-clinic.com`
**Expected:** Redirects to `/dashboard`, shows Sunrise Functional Medicine clinic

| Result | Notes |
|--------|-------|
| ☐ Pass / ☐ Fail | |

**Issues found:** _none_

---

### Step 2 — Create a Prescription

**Actions:**
1. Click "New Prescription"
2. Search pharmacy by state "TX"
3. Select Semaglutide 0.5mg/0.5mL from Strive Pharmacy
4. Click "Continue"

**Expected:** Strive Pharmacy appears in results with available medications

| Result | Notes |
|--------|-------|
| ☐ Pass / ☐ Fail | |

**Issues found:** _none_

---

### Step 3 — Set Margin

**Actions:**
1. Review wholesale ($150.00)
2. Set retail price to $250.00

**Expected:** Margin builder shows correct split and compliance check passes

| Result | Notes |
|--------|-------|
| ☐ Pass / ☐ Fail | |

**Issues found:** _none_

---

### Step 4 — Review & Sign (as Provider)

**Actions:**
1. Log out; log in as `dr.chen@sunrise-clinic.com`
2. Navigate to the pending order
3. Draw signature on canvas
4. Enter sig text and patient details (use seed patient: **Alex Demo**, DOB **1985-06-15**, phone **+15125550199**, state **TX**)
5. Click "Sign & Send"

**Expected:** Order transitions to `AWAITING_PAYMENT`; SMS payment link logged to console (or sent if Twilio enabled)

| Result | Notes |
|--------|-------|
| ☐ Pass / ☐ Fail | |

**Checkout token location** (if TWILIO_ENABLED=false): Query `orders` table for `checkout_token` where `order_id = <id>`

**Issues found:** _none_

---

### Step 5 — Patient Checkout

**Actions:**
1. Navigate to `https://<vercel-url>/checkout/<token>`
2. Verify page shows Sunrise Functional Medicine branding, $250.00, no medication name
3. Enter Stripe test card: `4242 4242 4242 4242` / exp `12/30` / CVC `123` / ZIP `10001`
4. Click "Pay"

**Expected:** Payment confirmed; order advances to `PAID_PROCESSING`

| Result | Notes |
|--------|-------|
| ☐ Pass / ☐ Fail | |

**Issues found:** _none_

---

### Step 6 — Adapter Routing

**Expected:**
- Routing engine fires, selects Tier 4 fax (Strive Pharmacy)
- Fax sent (or logged to console if DOCUMO_ENABLED=false)
- Order advances to `FAX_QUEUED`

| Result | Notes |
|--------|-------|
| ☐ Pass / ☐ Fail | |

**If DOCUMO_ENABLED=false:** Check Vercel function logs for `[tier4-fax] DOCUMO_ENABLED=false — fax suppressed` message.

**Issues found:** _none_

---

### Step 7 — Ops Monitoring

**Actions:**
1. Log out; log in as `ops@compoundiq-poc.com`
2. Navigate to `/ops/pipeline`
3. Navigate to `/ops/sla`
4. Navigate to `/ops/adapters`

**Expected:**
- Pipeline: order from Step 2 visible with correct status
- SLA: deadlines visible for the order
- Adapters: Strive Pharmacy shows healthy status

| Result | Notes |
|--------|-------|
| ☐ Pass / ☐ Fail | |

**Issues found:** _none_

---

### Step 8 — Audit Trail

**Actions:**
1. Open the order detail drawer in the pipeline
2. Check Status History tab
3. Check Submissions tab

**Expected:**
- Status history tab shows all transitions with timestamps
- Submissions tab shows the Tier 4 fax attempt

| Result | Notes |
|--------|-------|
| ☐ Pass / ☐ Fail | |

**Issues found:** _none_

---

## Bug Log

> Document every failure here. For each: step number, error observed, root cause, fix applied.
> If a **Known Risk Area** below is confirmed as a failure, open a numbered issue block for it in the Issues section that follows.

### Known Risk Areas (pre-populated from WO-55 spec)

These are the most likely integration failure points based on code review:

| # | Area | Risk | Likely Cause | Status |
|---|------|------|--------------|--------|
| 1 | Pharmacy search | No results | Catalog not seeded or state-license join failing | ☐ Verified OK / ☐ Issue found |
| 2 | Sign & Send | 500 error | Stripe PI creation before Connect account linked to clinic | ☐ Verified OK / ☐ Issue found |
| 3 | Checkout page | Blank / error | Stripe publishable key missing or wrong env var name | ☐ Verified OK / ☐ Issue found |
| 4 | Stripe webhook | Not received | Webhook endpoint not registered or wrong secret | ☐ Verified OK / ☐ Issue found |
| 5 | Routing engine | Not triggered | `submit` cron not firing or PAID_PROCESSING transition not calling adapter | ☐ Verified OK / ☐ Issue found |
| 6 | Fax submission | Error | Documo API key missing — should fall back gracefully | ☐ Verified OK / ☐ Issue found |
| 7 | Ops pipeline | Empty | RLS policy blocking ops_admin cross-clinic SELECT | ☐ Verified OK / ☐ Issue found |

---

### Issue #1 — _[Title]_

**Step:** ___
**Observed:** ___
**Expected:** ___
**Root cause:** ___
**Fix applied:** ___
**Files changed:** ___
**Re-test result:** ☐ Pass / ☐ Fail

---

_(Copy the block above for each additional issue found)_

---

## Final Acceptance Checklist

- [ ] All 8 steps complete without error (with Tier 4 fax or console fallback)
- [ ] Order transitions: DRAFT → AWAITING_PAYMENT → PAID_PROCESSING → FAX_QUEUED
- [ ] Ops admin can see the order in the pipeline view
- [ ] Checkout page shows clinic name, correct price, no medication name
- [ ] All 4 user roles log in and reach correct destination (MA → `/dashboard`, Provider → `/dashboard`, Ops → `/ops/pipeline`, Patient → unauthenticated checkout URL)
- [ ] This log documents every issue found and fix applied

**Overall result:** ☐ PASS — POC validated and demonstrable / ☐ FAIL — blocking issues remain

---

## Sign-off

| Role | Name | Date |
|------|------|------|
| Developer | | |
| Reviewer | | |
