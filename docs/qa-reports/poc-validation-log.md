# CompoundIQ POC Validation Log — WO-55

Tracks every issue found during the POC end-to-end happy path walk-through.

**Environment:** `https://functional-medicine-infrastructure.vercel.app`
**Date:** 2026-03-29
**Validated by:** Sadaf Shamloo + Claude Code

---

## Pre-flight Checklist

- [x] All migrations applied to Supabase (hosted)
- [x] `npm run build` — passes with no type errors
- [x] `npm run seed:poc` — completed successfully
- [x] All 4 test users can log in
- [ ] `/api/health` — not verified in this session
- [ ] Stripe live webhook delivery — deferred (Stripe configuration not yet finalized)
- [ ] Sentry test event — deferred

---

## Happy Path Steps

### Step 1 — Login as Clinic Admin

**User:** `admin@sunrise-clinic.com`
**Expected:** Redirects to `/dashboard`, shows Sunrise Functional Medicine clinic

| Result | Notes |
|--------|-------|
| ✅ Pass | Login confirmed working after password reset via Supabase admin API |

**Issues found:** Initial password guesses were wrong — confirmed password is `POCAdmin2026!` from seed script.

---

### Step 2 — Create a Prescription

**Actions:**
1. Click "+ New Prescription"
2. Select pharmacy / medication
3. Select Semaglutide from Strive Pharmacy (TX)
4. Set retail price ($210.00, wholesale $150.00)

**Expected:** Prescription wizard completes, reaches Review page

| Result | Notes |
|--------|-------|
| ✅ Pass | Wizard completed successfully. Retail $210, wholesale $150, margin $60. |

**Issues found:** None on this step.

---

### Step 3 — Review & Sign (as Provider/Admin)

**Actions:**
1. Navigate to Review page
2. Draw signature on canvas
3. Click "Sign & Send Payment Link" → confirm dialog

**Expected:** Order transitions to `AWAITING_PAYMENT`; redirects to dashboard

| Result | Notes |
|--------|-------|
| ✅ Pass | Order created and transitioned to AWAITING_PAYMENT. Redirected to dashboard. |

**Issues found (all fixed):**

- **Issue #1 — Sign & Send button stayed greyed out**
  - Root cause: `allChecksPassed` checked `provider_signature` DB hash (only written after signing — circular). Also Vercel was deploying pushes to Preview instead of Production.
  - Fix: Filter `provider_signature` from `allChecksPassed`; use `signatureCaptured` (canvas) instead. Fixed Vercel branch promotion.
  - Files: `src/app/(clinic-app)/new-prescription/review/_components/review-form.tsx`

---

### Step 4 — Patient Checkout Page

**Actions:**
1. Generated checkout URL via script (Twilio disabled, SMS not sent)
2. Navigate to checkout URL
3. Verify Stripe payment form loads

**Expected:** Stripe card form renders with clinic name and $210 amount

| Result | Notes |
|--------|-------|
| ✅ Pass | Checkout page loads with Stripe form showing Card, Bank, Affirm, Klarna options. Clinic name "Sunrise Functional Medicine" and $210.00 shown. No PHI visible. |

**Issues found (all fixed):**

- **Issue #2 — "Unable to load the payment form" error**
  - Root cause 1: `poc_placeholder` Stripe Connect account ID rejected by Stripe API when creating PaymentIntent with `transfer_data.destination`.
  - Root cause 2: Stripe cached the failed idempotency key `checkout-pi-{orderId}`.
  - Root cause 3: `/api/checkout` not in middleware public routes — guest POST was redirected 307 to `/login`.
  - Fixes: Skip Connect routing for `poc_placeholder`; bump idempotency key to `v2`; add `/api/checkout` to public routes in middleware.
  - Files: `src/app/api/checkout/payment-intent/route.ts`, `src/middleware.ts`

---

### Step 5 — Payment Processing Simulation

**Actions:**
1. Simulated `payment_intent.succeeded` webhook via direct DB script
2. `AWAITING_PAYMENT → PAID_PROCESSING` (CAS transition)
3. `PAID_PROCESSING → FAX_QUEUED` (Tier 4 fax branch)

**Expected:** Order advances through pipeline, status history logged

| Result | Notes |
|--------|-------|
| ✅ Pass | All transitions succeeded. Status history logged at each step. |

**Issues found:** None — pipeline logic correct.

---

### Step 6 — Clinic Dashboard Shows Order

**Actions:**
1. Login to clinic dashboard
2. Check orders list

**Expected:** Order visible with correct status

| Result | Notes |
|--------|-------|
| ✅ Pass | Order shows: Demo, Alex / Semaglutide / FAX_QUEUED / Strive Pharmacy T4 Fax |

**Issues found (all fixed):**

- **Issue #3 — Dashboard orders list showed "No prescriptions yet" despite order existing**
  - Root cause: All RLS policies used `auth.jwt() ->> 'clinic_id'` — this reads from the top-level JWT but `clinic_id` is nested inside `user_metadata`. Always returned NULL → no rows visible to browser client. Server-side service client bypassed RLS so revenue summary showed correct data.
  - Fix: Updated all 13 affected RLS policies to use `auth.jwt() -> 'user_metadata' ->> 'clinic_id'`.
  - Files: `supabase/migrations/20260329000001_fix_rls_jwt_user_metadata_path.sql`, `supabase/migrations/20260329000002_fix_all_rls_jwt_user_metadata_path.sql`

---

### Step 7 — Ops Dashboard

**Actions:**
1. Login as `ops@compoundiq-poc.com`
2. Navigate to `/ops` pipeline view

**Expected:** Order visible with FAX_QUEUED status, Strive Pharmacy T4 Fax, SLA timer

| Result | Notes |
|--------|-------|
| ✅ Pass | Pipeline shows order: 6413ca63 / Fax Queued / Sunrise Functional Medicine / Strive Pharmacy T4 Fax / SLA 7h / Cancel + Claim actions visible |

**Issues found:** None.

---

### Step 8 — Audit Trail

| Result | Notes |
|--------|-------|
| ☐ Not tested | Deferred — order drawer audit trail not verified in this session |

---

## Bug Log Summary

| # | Step | Issue | Root Cause | Fix | Status |
|---|------|-------|-----------|-----|--------|
| 1 | Sign & Send | Button always greyed out | Circular dependency: DB signature hash checked before signing | Filter provider_signature from allChecksPassed | ✅ Fixed |
| 2 | Checkout | Payment form failed to load | 3 causes: poc_placeholder Stripe account, cached idempotency key, middleware blocking guest API | 3 targeted fixes | ✅ Fixed |
| 3 | Dashboard | Orders list empty | All RLS policies used wrong JWT path (top-level vs user_metadata) | Updated all 13 RLS policies | ✅ Fixed |

### Known Risk Areas — Status

| # | Area | Status |
|---|------|--------|
| 1 | Pharmacy search | ✅ Verified OK |
| 2 | Sign & Send | ✅ Fixed (Issue #1) |
| 3 | Checkout page | ✅ Fixed (Issue #2) |
| 4 | Stripe webhook | ⏸ Deferred — simulated via DB script |
| 5 | Routing engine | ✅ Verified OK (via simulation) |
| 6 | Fax submission | ⏸ Deferred — DOCUMO_ENABLED=false |
| 7 | Ops pipeline | ✅ Verified OK |

---

## Final Acceptance Checklist

- [x] Order transitions: DRAFT → AWAITING_PAYMENT → PAID_PROCESSING → FAX_QUEUED
- [x] Clinic dashboard shows order with correct status
- [x] Ops pipeline shows order with SLA timer and actions
- [x] Checkout page shows clinic name, correct price, no medication name (no PHI)
- [x] Clinic admin and ops admin login and reach correct destination
- [ ] Stripe live webhook end-to-end — deferred pending Stripe test key setup
- [ ] Documo fax delivery — deferred (DOCUMO_ENABLED=false)
- [ ] All 4 user roles verified (provider and MA roles not individually tested)
- [ ] Audit trail drawer verified

**Overall result:** ✅ PASS (core pipeline) — POC validated and demonstrable. Three deferred items are non-blocking for POC demo.

---

## Sign-off

| Role | Name | Date |
|------|------|------|
| Developer | Claude Code | 2026-03-29 |
| Reviewer | Sadaf Shamloo | 2026-03-29 |
