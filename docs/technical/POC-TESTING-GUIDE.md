# CompoundIQ — POC Testing Guide

**Prepared for:** Associate Review
**Date:** March 30, 2026
**App:** CompoundIQ — Functional Medicine Prescription Platform

---

## Overview

CompoundIQ is a prescription management platform that connects functional medicine clinics with compounding pharmacies. It has three distinct surfaces to test:

1. **Clinic App** — where clinic staff manage prescriptions and orders
2. **Ops Dashboard** — internal operations tool for CompoundIQ staff
3. **Patient Checkout** — public-facing payment page patients receive via SMS

---

## App URL

**https://functional-medicine-infrastructure.vercel.app**

---

## Login Accounts

All accounts below are pre-configured test accounts for the POC environment.

### Clinic App Accounts
*(Login at the main URL above)*

| Role | Email | Password | What they can do |
|------|-------|----------|-----------------|
| **Clinic Admin** | `admin@sunrise-clinic.com` | `POCClinic2026!` | Full access — orders, settings, Stripe setup |
| **Provider (Doctor)** | `dr.chen@sunrise-clinic.com` | `POCProvider2026!` | Create prescriptions, view orders |
| **Medical Assistant** | `ma@sunrise-clinic.com` | `POCMA2026!` | View orders, assist with prescriptions |

### Ops Dashboard Account
*(Same URL — this role automatically redirects to the ops dashboard)*

| Role | Email | Password | What they can do |
|------|-------|----------|-----------------|
| **Ops Admin** | `ops@compoundiq-poc.com` | `POCAdmin2026!` | Full pipeline, SLA, adapter, fax, catalog views |

---

## Stripe Test Card Numbers

The checkout uses Stripe in **test mode** — no real charges are made. Use these card numbers in the payment form:

| Scenario | Card Number | Exp | CVC |
|----------|------------|-----|-----|
| **Successful payment** | `4242 4242 4242 4242` | Any future date (e.g. 12/28) | Any 3 digits |
| **Card declined** | `4000 0000 0000 0002` | Any future date | Any 3 digits |
| **Insufficient funds** | `4000 0000 0000 9995` | Any future date | Any 3 digits |
| **Requires authentication (3DS)** | `4000 0025 0000 3155` | Any future date | Any 3 digits |

For ZIP code (if prompted): use any 5-digit number (e.g. `90210`).

---

## Surface 1 — Clinic App

**Login as:** `admin@sunrise-clinic.com` / `POCClinic2026!`

### Navigation
The app has a sidebar on the left with three sections:
- **Dashboard** — order management
- **New Prescription** — 3-step wizard to create orders
- **Settings** — clinic profile and Stripe setup

The sidebar collapses to an icon-only rail on tablet. On mobile it becomes a hamburger menu.

---

### Dashboard (`/dashboard`)

**What to check:**
- Orders table loads with all active orders
- **Status filter tabs** at the top: All / Drafts / Awaiting Payment / Submitting / Processing / Shipped / Errors — clicking each filters the table
- **Table view vs Kanban view** toggle (top right) — switches between a table and a card-based kanban board
- **Kanban drag:** cards can be dragged between columns; dropping opens the order detail drawer
- **Clicking any row** opens a slide-out drawer on the right with full order details
- **"+ New Prescription"** button — if Stripe is not yet connected, it appears disabled with a tooltip explaining why
- Orders refresh automatically every 30 seconds in the background (no manual refresh needed)
- If you switch to the Errors tab and there are no errors, you should see an empty state with a "Clear filters" link

**Order status badge colors** (colorblind-safe — always dot + text label, never color alone):
- Blue = payment pending states
- Amber = processing/in-progress
- Green = shipped/delivered
- Red = errors

---

### New Prescription Flow (`/new-prescription`)

The flow has a 3-step progress indicator (Patient & Provider → Add Prescriptions → Review & Send).

**Step 0 — Select Patient & Provider** (`/new-prescription`)
- Search for a patient by name, DOB, or phone
- Select the prescribing provider (auto-selects if only one in the clinic)
- Both stay pinned in a session banner at the top of all subsequent screens
- Patient's shipping state auto-populates for pharmacy search

**Step 1 — Find Medication & Pharmacy** (`/new-prescription/search`)
- Shipping state already filled from the patient record
- Type a medication name in the search box (e.g. "Semaglutide", "Tirzepatide")
- Results appear with pharmacy name, tier badge, price, and turnaround time
- Select a pharmacy to proceed to pricing

**Step 2 — Margin & Pricing** (`/new-prescription/margin`)
- Wholesale cost locked and read-only. Quick multiplier buttons (1.5x, 2x, 2.5x, 3x)
- Real-time margin calculation: margin %, platform fee, est. clinic margin
- Enter prescription directions (Sig) — minimum 10 characters
- Three action buttons:
  - **"Add & Search Another"** — saves this prescription and returns to Step 1 for another medication
  - **"Review & Send"** — proceeds to batch review with all prescriptions in the session
  - **"Save as Draft"** — creates the order without signing, for the provider to sign later from the dashboard

**Step 3 — Batch Review & Sign** (`/new-prescription/review`)
- All prescriptions in the session displayed with medication, pharmacy, pricing, and sig
- Combined totals: total retail, total platform fee, total est. clinic margin
- Single provider signature pad — one signature covers all prescriptions
- "Sign & Send All" sends payment links for every prescription

**Provider Signature Queue** (`/new-prescription/sign/[orderId]`)
- When an MA saves a draft, the order appears on the dashboard "Drafts" tab
- Clicking a draft order shows an amber "Awaiting Provider Signature" banner
- Provider clicks "Review & Sign" → dedicated sign page with pre-populated details
- Provider signs and sends — order transitions from Draft to Awaiting Payment

---

### Settings (`/settings`)

Two-column layout with a sticky left navigation:
- **Stripe Connect** — connect your clinic's Stripe account to receive payouts
- **Clinic Profile** — update clinic name, phone, email
- **Notifications** — coming soon placeholder

---

### Role Differences

| Feature | Clinic Admin | Provider | Medical Assistant |
|---------|-------------|----------|-------------------|
| View orders | ✅ | ✅ | ✅ |
| Create prescriptions | ✅ | ✅ | ❌ |
| Access settings | ✅ | ❌ | ❌ |
| Stripe setup | ✅ | ❌ | ❌ |

Try logging in as each role to see the access differences.

---

## Surface 2 — Ops Dashboard

**Login as:** `ops@compoundiq-poc.com` / `POCAdmin2026!`

The ops dashboard is styled in **dark mode** (intentional — designed for high-density internal use). It has 5 tabs across the top navigation bar:

---

### Pipeline (`/ops/pipeline`)

The main order operations view. High-density table showing all active orders across all clinics.

**What to check:**
- Left sidebar shows **status groups** (Payment, Submission, Pharmacy, Shipping, Errors/Terminal) with order counts — clicking a group filters the table
- **SLA column urgency indicators:**
  - Gray/muted text = >4 hours remaining (no urgency)
  - Amber text + clock icon = 1–4 hours remaining
  - Red text + clock icon = under 1 hour
  - **OVERDUE** in red bold + ⚠ icon = past deadline; the entire row also gets a red left border and subtle red background tint
- **"Updated Xs ago"** counter in the top-right updates live every second
- **Filter bar** at top: filter by clinic, pharmacy, integration tier, and date range
- **Checkboxes** on rows enable bulk actions (e.g. "Retry Fax All" for a batch of failed fax orders)
- Clicking an order ID opens a detail drawer with quick actions: Retry, Reroute, Add Tracking, Cancel, Claim/Release

---

### SLA (`/ops/sla`)

Heatmap of all active SLA deadlines.

**What to check:**
- Cards are color-coded: green (on track), yellow (approaching), red (breached), blue (cascade attempted)
- Each card shows a **progress bar** — the fill represents how much of the SLA window remains, color-coded by urgency (not just percentage — a 24h SLA at 60% is different urgency than a 2h SLA at 60%)
- Filter tabs at top: All Active / Breached / by tier / Cascade / etc.
- "Acknowledge" button appears on breached or escalated-approaching cards
- **Shift Handoff Report** button (top right) — expands a summary with breach counts, fax delivery rate, and adapter success rates by tier

---

### Adapters (`/ops/adapters`)

Health status of all pharmacy integration adapters.

**What to check:**
- Each pharmacy card shows plain English status: **Online** / **Degraded** / **Offline** (not technical "CLOSED/HALF_OPEN/OPEN")
- **Success Rate (24h)** metric on each card
- Circuit breaker state badge on each card
- 24-hour hourly bar chart (CSS-only, no library) showing submission history
- Filters: by tier, by status (Healthy/Degraded/Critical), by circuit breaker state
- Quick actions: **Disable Adapter**, **Force Tier 4**, **Close Circuit** — these use a two-step confirmation (click once to arm, click again to confirm) to prevent accidental actions

---

### Fax Queue (`/ops/fax`)

Inbound fax triage.

**What to check:**
- Table shows incoming faxes with status badges (Received / Matched / Unmatched / Processed / Archived)
- Clicking a row opens a detail pane on the right
- Empty state shows an inbox icon with "No faxes in queue — All caught up ✓"
- Filter buttons at top by status

---

### Catalog (`/ops/catalog`)

Medication catalog management.

**What to check:**
- Tabs: Catalog / Version History / Normalized View / Sync Status
- CSV upload zone (drag & drop or click to browse)
- Price discrepancy alerts (>10% change flagged in amber)
- Sync status per pharmacy

---

## Surface 3 — Patient Checkout

Patients receive a payment link via SMS. The checkout URL format is:

```
https://functional-medicine-infrastructure.vercel.app/checkout/[token]
```

**To test this flow:**
1. Log in as Clinic Admin or Provider
2. Create a new prescription through the wizard and submit it
3. The patient receives an SMS with a checkout link — for testing, check the order detail drawer which shows the payment link
4. Open that link in a new browser window (no login required — this is the patient-facing page)

### What to check on the checkout page:
- **Sticky header** at top with CompoundIQ logo and clinic name
- **Order summary card** showing "Prescription Service", clinic name, and amount due
- **Stripe payment form** loads with card, Apple Pay, and Google Pay options
- **Pay button** shows "Pay $X.XX" with the actual amount — minimum 48px height for mobile touch
- **Trust badges** at bottom: 🔒 256-bit TLS Encryption + ⚡ Powered by Stripe
  - Note: No HIPAA badge is shown (intentional — legal requirement until formal audit)
- Use Stripe test card `4242 4242 4242 4242` for a successful payment
- Use `4000 0000 0000 0002` to test a declined card — you should see an inline error message and be able to retry without leaving the page

### Success Page (`/checkout/success`)
After a successful payment:
- Animated green checkmark
- "Payment Received" with amount
- 3-step "What Happens Next" list:
  1. ✓ Payment confirmed
  2. ⏳ Prescription sent to pharmacy (within a few minutes)
  3. ⏳ Pharmacy will contact you (within 24–48h or 3–7 business days depending on pharmacy tier)
- Order reference number in monospace font (for patient records)
- Clinic phone/email contact if available

### Expired Link Page (`/checkout/expired`)
To test: navigate to `/checkout/expired` directly
- Amber clock icon (informational tone, not alarming red)
- "This payment link has expired" heading
- Calm instructional copy directing patient to contact their clinic

---

## Key Things to Look For

These are the main improvements from the most recent build sprint:

### Visual Design
- [ ] Consistent Geist font across all surfaces
- [ ] Proper dark mode on ops dashboard only — clinic app and checkout remain light
- [ ] Color tokens are consistent (primary blue `#2563EB` matches across all buttons and accents)
- [ ] All status badges use dot + text label (never color alone — colorblind accessible)

### Mobile / Responsive
- [ ] Clinic app sidebar collapses to icon-rail at tablet width, hamburger at mobile
- [ ] Checkout page Pay button is full-width and easily tappable
- [ ] No horizontal scroll at any screen width on checkout

### Loading States
- [ ] All data tables show skeleton loading rows on first load (before data arrives)
- [ ] Checkout shows skeleton before Stripe payment form loads
- [ ] SLA heatmap shows skeleton on initial load

### Error States
- [ ] Dashboard shows "Connection lost — displaying cached data" banner if polling fails, with Retry button
- [ ] Checkout shows specific message for declined cards vs generic errors
- [ ] Ops pipeline shows error banner with Retry if pipeline fetch fails

---

## Notes for Your Review

- **Test data:** The POC environment has pre-seeded orders in various states. You should see orders across all status lanes without needing to create new ones first.
- **Stripe test mode:** All payments are simulated — no real money moves.
- **SMS in test mode:** In the POC environment, SMS messages go to a test sink (they are logged but not delivered to real phone numbers). You can access payment links directly from the order detail drawer.
- **Data persistence:** The POC database is shared — anything created during testing will be visible to all testers.
- **Browser support:** Chrome or Safari recommended. The checkout Apple Pay button only appears on Safari/iOS.

---

*For questions or issues, contact the development team.*
