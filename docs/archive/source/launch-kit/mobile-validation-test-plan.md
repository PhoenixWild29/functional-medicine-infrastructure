# Mobile Validation Test Plan

**Purpose:** End-to-end mobile device validation of all 3 CompoundIQ applications before first real patient transaction.

**Why this exists:** All 6 rounds of Cowork QA ran in desktop browsers (1440px+ viewports). No mobile validation has been performed. Patient checkout is mobile-first by design (patients tap SMS links on phones), so this is the single highest-risk gap before production.

**Time required:** 30-45 minutes first pass. Re-run any time the `/checkout/*` routes, SessionBanner, or mobile-responsive components change.

**Cost:** $0 using your own devices. Optional: BrowserStack or LambdaTest (~$40/mo) if you don't have Android hardware.

---

## Target URL

https://functional-medicine-infrastructure.vercel.app

---

## Device Matrix

Validate on these device + browser combinations. **Priority 1** devices MUST pass before first real order; **Priority 2** are tracked as bugs but don't block.

| Device | Browser | Priority | Coverage |
|--------|---------|----------|----------|
| iPhone (any model 12+) | Safari (default) | **P1** | Patient Checkout, Apple Pay |
| Android phone (any Samsung, Pixel, etc.) | Chrome (default) | **P1** | Patient Checkout, Google Pay |
| iPhone | Chrome iOS | P2 | Checkout rendering sanity |
| iPad | Safari | P2 | Clinic App graceful degradation |

If you don't own one of the devices:
- **Missing Android?** Use BrowserStack live testing (real devices, ~$40/mo, cancel after testing) or borrow from someone
- **Missing iPhone?** Same — BrowserStack has real iPhones
- **No iPad?** Skip P2 iPad row; the clinic app is not designed for iPad and won't block launch

---

## Pre-Test Setup

Before you start testing:

1. Open the live app on your desktop and log in as `admin@sunrise-clinic.com` / `POCClinic2026!`
2. Create a test prescription end-to-end:
   - Select Alex Demo + Sarah Chen → Continue
   - Pick any Favorite OR walk the Cascading Builder with Semaglutide → Strive Pharmacy
   - Click 2x multiplier → sign → Confirm & Send
3. Wait for redirect to `/dashboard?sent=1`
4. Click the most recent order → copy the checkout URL from the order detail drawer
   - (Or run `npx dotenv -e .env.local -- npx tsx scripts/get-checkout-url.ts` if you have the repo locally)
5. You will paste this URL into the mobile browser address bar manually (simulates the SMS tap)

**Expected URL format:** `https://functional-medicine-infrastructure.vercel.app/checkout/<order_uuid>?token=<jwt>`

---

## Test Sections

### PART A — Patient Checkout (iOS Safari) — PRIORITY 1

Open the checkout URL on your iPhone in Safari (default browser).

**A1 — Page Load & Layout:**

- [ ] Page loads without horizontal scroll (all content fits 320-428px viewport)
- [ ] Clinic name "Sunrise Functional Medicine" displays prominently at top
- [ ] Line item "Prescription Service" displays (NOT medication name)
- [ ] Total price matches what was set on desktop ($300.00 expected)
- [ ] Trust signals visible: "256-bit TLS Encryption", "Powered by Stripe"
- [ ] No medication name, dosage, or diagnosis appears anywhere on the page (HIPAA check)
- [ ] Footer reads "Your payment info is encrypted and never stored by CompoundIQ"

**A2 — Form Fields:**

- [ ] Email field renders with iOS keyboard showing @ key
- [ ] Tapping the email field does NOT cause the page to zoom in and get stuck (common iOS bug when font-size < 16px)
- [ ] Tab/Next key progression through form fields works

**A3 — Stripe Payment Element:**

- [ ] Stripe Elements iframe loads (card number, expiry, CVC inputs visible)
- [ ] **Apple Pay button appears at the top of the payment element** (this is the critical check)
- [ ] Card input autocompletes from iCloud Keychain if you have a saved card
- [ ] Typing in card number field works smoothly (no lag, no disappearing digits)

**A4 — Apple Pay Flow:**

- [ ] Tap Apple Pay button → Face ID / Touch ID prompt appears
- [ ] After biometric auth, payment sheet shows correct clinic name ("Sunrise Functional Medicine") and correct amount ($300.00)
- [ ] Sheet shows "Prescription Service" as the line item (not medication name)
- [ ] Cancel button works and returns to the checkout page without error

**Do NOT complete the Apple Pay transaction during testing unless you want a real $300 charge to your card — the app is in Stripe test mode ONLY if the test Stripe publishable key is active. Verify this with desktop dev tools before tapping Pay.**

If you ARE in test mode, proceed:

- [ ] Tap Pay → biometric confirmation → success animation in Apple Pay sheet → redirect to `/checkout/success/<order_id>`
- [ ] Success page: green checkmark, "Payment Received", amount in green, order reference (first 8 chars of UUID in monospace font)
- [ ] "What Happens Next" card renders with 3 steps
- [ ] No medication name on success page

**A5 — Card Entry (fallback if skipping Apple Pay):**

Use Stripe test card `4242 4242 4242 4242`, expiry `12/28`, CVC `123`, ZIP `78701`.

- [ ] Type in card number field — cursor doesn't jump around
- [ ] Form validation: invalid card number shows inline error, does not crash
- [ ] Submit button is tap-target friendly (min 44×44 px)
- [ ] Pay button submits and shows loading state
- [ ] Redirects to success page on completion

**A6 — Expired Link:**

Navigate to `https://functional-medicine-infrastructure.vercel.app/checkout/expired`

- [ ] Page renders without horizontal scroll
- [ ] Clock icon visible and properly sized
- [ ] "This payment link has expired" message displays
- [ ] Instruction to contact clinic
- [ ] Zero PHI (no order ID, no medication, no patient name)

---

### PART B — Patient Checkout (Android Chrome) — PRIORITY 1

Repeat the full PART A test sequence on an Android phone in Chrome, with one substitution: **Google Pay instead of Apple Pay**.

Key differences to watch for:

- [ ] Google Pay button appears instead of Apple Pay at the top of the Stripe Elements payment area
- [ ] Tapping Google Pay opens the Google Pay sheet
- [ ] Sheet shows correct clinic name and amount
- [ ] Card entry with Stripe test card works the same as iOS
- [ ] Success page renders identically

**Common Android-specific issues to watch for:**

- Form fields zooming on focus (should not happen with properly set viewport)
- Chrome address bar hiding/showing causing layout jumps
- Back button behavior after success (should not re-submit payment)

---

### PART C — Clinic App (iPad Safari) — PRIORITY 2

Open the live app on an iPad in Safari. Log in as `admin@sunrise-clinic.com` / `POCClinic2026!`.

**C1 — Layout:**

- [ ] Sidebar is visible or collapsible without breaking the main content
- [ ] Dashboard KPI cards are readable and not cramped
- [ ] Order table is horizontally scrollable if columns don't fit (should not be clipped)
- [ ] No overlapping text or buttons

**C2 — Core Workflows:**

Walk through the following. Each should complete without a hard crash or missing UI:

- [ ] New Prescription → Patient Search → Select Alex Demo → Continue
- [ ] Favorites tab shows at least one card; tapping a card navigates to the margin page
- [ ] Margin Builder: multiplier buttons are tap-friendly; sig field accepts input
- [ ] Save as Draft: button works, redirect to dashboard happens
- [ ] Drafts tab visible and clickable

**C3 — Known Tolerable Issues (OK if they happen):**

- Narrow viewport causes some text truncation
- Hover-only affordances (like pipeline row Actions menu) replaced by tap
- Virtual keyboard obscures form inputs — scroll into view should handle it

**C4 — NOT tolerable:**

- App refuses to load
- Login form unresponsive
- Cascading Builder dropdowns don't open on tap
- Any flow that blocks the save-as-draft path

---

### PART D — Clinic App (iPhone Safari) — PRIORITY 2

Open the live app on iPhone in Safari. Log in as clinic admin.

Because the clinic app is NOT designed for phone, we're only checking for hard crashes and sign-of-life:

- [ ] Login form renders and accepts input
- [ ] Post-login redirect lands on /dashboard without error
- [ ] Dashboard shows SOMETHING useful (even if cramped)
- [ ] Attempting New Prescription does not crash the app

Log a P2 bug for anything broken here. Does NOT block launch.

---

### PART E — Ops Dashboard (iPhone Safari) — PRIORITY 2

Open the live app on iPhone in Safari. Log in as `ops@compoundiq-poc.com` / `POCAdmin2026!`.

- [ ] Login lands on /ops/pipeline without crash
- [ ] At least one order row is visible even if the table is horizontally scrollable
- [ ] Tabs (Pipeline, SLA, Adapters, Fax Queue, Catalog, Demo Tools) render
- [ ] /ops/demo-tools page: credential table is legible, Reset Credentials button is tappable (do NOT tap it during testing)

Same P2 rule: log bugs, don't block.

---

## Results Template

Copy this into a new file when you run the test. Save as `mobile-validation-results-<DATE>.md` in `docs/qa-reports/`.

```
# Mobile Validation Results — <DATE>

**Tester:** <YOUR NAME>
**Devices used:**
- iPhone: <model>, iOS <version>
- Android: <model>, Android <version>, Chrome <version>
- iPad: <model>, iPadOS <version> (optional)

**Commit tested:** <git short sha at time of test>
**Live deployment:** https://functional-medicine-infrastructure.vercel.app

## Summary Table

| Section | Device | Priority | Result |
|---------|--------|----------|--------|
| A — Patient Checkout | iPhone Safari | P1 | PASS / FAIL / N/A |
| B — Patient Checkout | Android Chrome | P1 | PASS / FAIL / N/A |
| C — Clinic App | iPad Safari | P2 | PASS / DEGRADED / FAIL |
| D — Clinic App | iPhone Safari | P2 | PASS / DEGRADED / FAIL |
| E — Ops Dashboard | iPhone Safari | P2 | PASS / DEGRADED / FAIL |

## Issues Found

| ID | Priority | Device | Section | Description | Screenshot/Video |
|----|----------|--------|---------|-------------|------------------|
| M1 | | | | | |
| M2 | | | | | |

## Go / No-Go Recommendation

<PASS — ready for first real order OR FAIL — patient checkout blocker on <device> must be fixed>

## Notes

<anything non-obvious, edge cases observed, recommendations>
```

---

## Common Bugs to Watch For

From industry experience with mobile payment flows on Next.js + Stripe Elements:

1. **iOS Safari viewport zoom on input focus** — happens when font-size on an input is less than 16px. Fix: bump form input font-size to 16px minimum.
2. **Apple Pay button missing** — happens when the site is not served over HTTPS OR the Stripe key is for the wrong account. All our checkout URLs are on `functional-medicine-infrastructure.vercel.app` so this should be fine.
3. **Google Pay button missing** — Chrome requires a verified Payment Request manifest (Stripe handles this automatically for Stripe Checkout; for custom Stripe Elements integrations, the Payment Request button component needs to be correctly mounted).
4. **Form input keyboard covers submit button** — iOS Safari's keyboard floats over content. Fix: scroll-into-view on focus, or sticky submit button with `position: fixed; bottom: 0`.
5. **Success page does not render on redirect** — happens when the Next.js middleware redirects in a way that Safari blocks due to third-party cookies. Our middleware is same-origin so unlikely.
6. **Signature pad on iOS does not accept touch drags** — `react-signature-canvas` has had this issue; fix is `pointerEvents: 'auto'` explicitly. We don't need this for checkout (signing is desktop-only) but worth knowing for future clinic-app-mobile work.

---

## What To Do If You Find a P1 Failure

1. Screenshot / video the failure on the device
2. Note the EXACT reproduction steps
3. Log as a new work order: `WO-MOB-<n>: <short description>`
4. Block the first real order until the WO is closed
5. Add a regression test (even a manual one in this doc) for the next mobile validation pass

---

## Automation Future State (NOT for first pass)

Post-launch (60+ days), consider automating this with:

- **Playwright mobile emulation** in CI — covers viewport/layout, but NOT Apple Pay / Google Pay
- **BrowserStack Automate** — real devices in CI, ~$150/mo for cloud devices
- **Percy or Chromatic** — visual regression on mobile viewports

For now: manual testing every time the checkout flow changes. It's 30 minutes. It will catch 95% of what automation would.

---

## Version History

- v1.0 — 2026-04-19 — Initial plan created after mobile gap flagged during pre-launch review
