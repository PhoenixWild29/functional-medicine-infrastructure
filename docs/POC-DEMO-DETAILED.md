# CompoundIQ POC Demo — Detailed Walkthrough

**Version:** 1.0 | **Date:** April 3, 2026
**Application:** https://functional-medicine-infrastructure.vercel.app
**Duration:** 30–45 minutes (with discussion)

---

## Pre-Demo Setup (5 minutes before)

1. **Sync credentials:** Run `npm run seed:poc` to ensure all passwords match documented values
2. **Verify health:** Open `https://functional-medicine-infrastructure.vercel.app/api/health` — should return `{"status":"ok"}`
3. **Open browser tabs:** Prepare 3 tabs — one for clinic app, one for ops dashboard, one for patient checkout
4. **Stripe test card ready:** `4242 4242 4242 4242` | Exp: `12/28` | CVC: `123` | ZIP: `78701`
5. **Mobile device (optional):** Have a phone ready to show the checkout page on a real mobile browser

### POC Test Accounts

| Role | Email | Password | Redirects To |
|------|-------|----------|-------------|
| Ops Admin | `ops@compoundiq-poc.com` | `POCAdmin2026!` | `/ops/pipeline` |
| Clinic Admin | `admin@sunrise-clinic.com` | `POCClinic2026!` | `/dashboard` |
| Provider | `dr.chen@sunrise-clinic.com` | `POCProvider2026!` | `/dashboard` |
| Medical Assistant | `ma@sunrise-clinic.com` | `POCMA2026!` | `/dashboard` |

### POC Seed Data

| Entity | Details |
|--------|---------|
| Clinic | Sunrise Functional Medicine |
| Provider | Dr. Sarah Chen, NPI 1234567890, TX license |
| Patient | Alex Demo, DOB 1985-06-15, TX, SMS opt-in |
| Pharmacy | Strive Pharmacy, Tier 4 (Fax), TX licensed |
| Medications | Semaglutide, Tirzepatide, Testosterone, Sermorelin, Naltrexone |

---

## Part 1: The Problem (2 minutes — no demo, just talking)

> "Independent functional medicine clinics prescribe compounding medications at scale but lack the infrastructure to do so profitably. They face three compounding problems:"

**1. Sourcing is manual**
> "Finding which pharmacy is licensed in the patient's state, has the right formulation, at the best wholesale price — that's done with phone calls, spreadsheets, and tribal knowledge. There's no searchable marketplace for compounding pharmacy services."

**2. Margin math is error-prone**
> "Clinics mark up compounded medications but calculate margins manually. No real-time pricing tools, no price locking, no platform fee transparency."

**3. Fulfillment is fax-dependent**
> "The prescription gets faxed. Then you wait. No real-time tracking, no automated escalation when orders stall. Every order requires human intervention at multiple stages."

> "CompoundIQ replaces this with an AI-native system that handles the full lifecycle: search, price, pay, route, track, and deliver. Let me show you."

---

## Part 2: Login & Authentication (3 minutes)

### Show the Login Page

1. Navigate to `https://functional-medicine-infrastructure.vercel.app/login`
2. **Point out:**
   - Dark gradient background with CompoundIQ branding
   - Clean, modern design (Geist font, Tailwind CSS design system)
   - HIPAA badge indicating healthcare-grade security
   - Feature bullet points with checkmarks

> "This is the unified login for all three applications. The system uses role-based access control — where you go after login depends on who you are."

### Demonstrate Role-Based Routing

3. Log in as **Clinic Admin**: `admin@sunrise-clinic.com` / `POCClinic2026!`
4. **Point out:** Redirected to `/dashboard` — the Clinic App

> "Clinic users — admins, providers, medical assistants — all land on the clinic dashboard. They can only see their own clinic's data. Row-Level Security is enforced at the PostgreSQL level, not just application code."

5. Sign out
6. Log in as **Ops Admin**: `ops@compoundiq-poc.com` / `POCAdmin2026!`
7. **Point out:** Redirected to `/ops/pipeline` — the Ops Dashboard (dark mode)

> "Ops admins see a completely different application — the dark-mode operations dashboard. They have cross-clinic visibility for monitoring the entire order pipeline."

8. **RBAC Demo:** While logged in as ops, navigate to `/dashboard`
9. **Point out:** "Access Denied" page — ops cannot see the clinic app

> "The access control works in both directions. Ops can't access clinic data through the clinic app, and clinic users can't access the ops dashboard. This is enforced at every level — middleware, RLS policies, and JWT claims."

10. Sign out

---

## Part 3: The Clinic Workflow (10–15 minutes)

### 3A — Dashboard Overview

1. Log in as **Clinic Admin**: `admin@sunrise-clinic.com` / `POCClinic2026!`
2. **Point out the dashboard:**
   - KPI cards at top (Total Orders, Revenue, Pending Payment, Completed)
   - Order table with status badges (colored pills showing order state)
   - Table/Kanban toggle in the top right
3. Click the **Kanban toggle** to show the board view

> "The medical assistant starts their day here. They can see all orders at a glance, filter by status, and switch between table and kanban views."

4. **Point out the sidebar:**
   - Navigation links with icons
   - Active page highlighted
   - User info and role badge at the bottom
5. Click the **collapse button** (chevron) on the sidebar
6. Show the sidebar collapses to icon-only mode
7. Click again to re-expand

> "The sidebar collapses for more screen real estate. The main content area adjusts automatically — no gap or layout shift."

### 3B — New Prescription: Pharmacy Search

8. Click **"+ New Prescription"** button
9. **Point out the 3-step progress indicator** at the top (Select Pharmacy → Set Price → Review & Send)

> "The prescription workflow is a 3-step process designed for sub-30-second completion. Step 1: find the right pharmacy."

10. Select **Patient Shipping State: TX** (Texas)
11. In the medication search field, type **"Sema"**
12. **Point out:** Autocomplete dropdown appears with matching medications

> "The system searches across all pharmacies in the network. But here's the critical part — it only shows pharmacies that hold an active license in the patient's shipping state. An unlicensed pharmacy never appears in results. This is compliance at the query level."

13. Select **Semaglutide** from the autocomplete
14. **Point out the pharmacy result card:**
    - Pharmacy name: Strive Pharmacy
    - Wholesale price: $150.00
    - Integration tier badge: "Fax · ~30 min" (gray pill)
    - Turnaround time
    - Regulatory status (Active)

> "Each pharmacy card shows the wholesale cost, turnaround time, and integration tier. The tier badge tells you how the prescription will be submitted — API for instant delivery, Portal for automated browser submission, or Fax as the universal fallback. The system always uses the highest available tier."

15. Click the **Strive Pharmacy card** to select it

### 3C — Dynamic Margin Builder

16. **Point out the Margin Builder:**
    - Wholesale Cost: $150.00 (locked, read-only)
    - Retail Price to Patient (editable)
    - Quick-action multiplier buttons: 1.5x, 2x, 2.5x, 3x

> "Step 2: set the patient price. The wholesale cost is locked — it can never be changed. The clinic sets the retail price, and the system calculates everything in real time."

17. Click the **2x multiplier button**
18. **Point out the margin calculations update instantly:**
    - Retail Price: $300.00
    - Margin: 50.0%
    - Platform Fee (15%): $22.50
    - Estimated Clinic Margin: $127.50 (in green)

> "The clinic makes $127.50 on this prescription. The platform captures a 15% fee on the margin spread. The patient pays $300. Full transparency — the clinic sees exactly what they earn before they commit."

19. Show the **validation warnings:**
    - Try entering a retail price below $150 — shows error "Retail price must be equal to or greater than wholesale cost"
    - Enter $900 (6x) — shows amber warning about exceeding 5x markup

> "There are guardrails. You can't sell below cost — that's enforced at the database level too, not just the UI. And excessive markups get a soft warning."

20. Set retail back to **$300.00** (2x)
21. Enter Sig: **"Take 0.5mg subcutaneous injection weekly"**
22. **Point out** the character counter on the Sig field

> "The prescription directions are required — minimum 10 characters. This goes on the prescription PDF that gets sent to the pharmacy."

23. Click **"Continue"** or proceed to the review step

### 3D — Provider Signature & Send

24. On the review page, **point out:**
    - Order summary (medication, pharmacy, pricing)
    - Provider signature area

> "Step 3: the provider reviews and digitally signs. The signature is captured as a SHA-256 hash — no third-party e-signature service needed. Once signed, everything is locked: the wholesale price, retail price, medication, pharmacy, provider NPI — all frozen into immutable snapshots."

25. **Sign the order** (click/draw on the signature pad)
26. Click **"Sign & Send Payment Link"**
27. **Point out the confirmation dialog:** Shows amount, patient name, phone number

> "The system runs 6 compliance checks before sending: pharmacy license verification, valid NPI, signature captured, retail >= wholesale, Stripe account active, and DEA scheduling check."

28. Confirm sending
29. **Point out:** Order transitions to "Awaiting Payment"

> "A tokenized JWT payment link was generated with a 72-hour expiry and would normally be sent via Twilio SMS to the patient's phone. For the POC, SMS is disabled but the full flow executes — the order is real, the token is real, the SLA timers are running."

30. **Find the checkout URL** in the order detail (click the order row to open the detail drawer)

> "Three SLA timers just started automatically: a 24-hour reminder, a 48-hour final warning, and a 72-hour auto-expiry. If the patient doesn't pay, the system handles everything — reminders, escalation, and cleanup. The MA's job is done."

---

## Part 4: Patient Checkout (5–7 minutes)

### 4A — Checkout Page

1. Open the **checkout URL** in a new tab (or on a mobile device for extra impact)
2. **Point out:**
   - Clinic branding: "Sunrise Functional Medicine" displayed prominently
   - Generic line item: "Prescription Service" — NOT the medication name
   - Total: $300.00
   - Stripe Elements payment form (card, Apple Pay, Google Pay options)
   - Email field (required for receipt)
   - Trust signals: "256-bit TLS Encryption", "Powered by Stripe"
   - Footer: "Your payment info is encrypted and never stored by CompoundIQ"

> "This is what the patient sees. No login, no app download, no account creation. They tapped a link in a text message and landed here. Notice — no medication name anywhere. HIPAA compliance means zero Protected Health Information touches Stripe or appears on any patient-facing surface."

3. **Point out the white-labeling:**

> "The patient sees their clinic's name and branding. They don't know CompoundIQ exists. This is a branded checkout experience for the clinic."

### 4B — Complete Payment

4. Enter email: `test@example.com`
5. Enter Stripe test card: `4242 4242 4242 4242` | Exp: `12/28` | CVC: `123` | ZIP: `78701`
6. Click **"Pay $300.00"**
7. Wait for the success page

### 4C — Success Page

8. **Point out:**
   - Animated green checkmark (CSS-only draw animation)
   - "Payment Received" heading
   - Amount in green
   - Order reference: `#213881c7` (first 8 chars of UUID, monospace font)
   - "What Happens Next" card with 3-step progress:
     - Payment confirmed (check)
     - Prescription sent to pharmacy (pending)
     - Pharmacy will contact you — "Within 3–7 business days" (Tier 4 fax timing)

> "The patient gets immediate confirmation with clear next-step expectations. The messaging adapts to the pharmacy's integration tier — API-connected pharmacies show '24–48 hours' because they have real-time status. Fax pharmacies show the longer timeline. No false promises."

9. **Point out:** No medication name on the success page either

> "Still zero PHI. The patient knows their payment went through and roughly when to expect their medication. That's all they need."

### 4D — Expired Link Page (Optional)

10. Navigate to `https://functional-medicine-infrastructure.vercel.app/checkout/expired`
11. **Point out:**
    - Clock icon, friendly message
    - "Payment links expire after 72 hours for security"
    - Instructions to contact clinic
    - No order details revealed

> "If a patient waits too long, they see this. No PHI exposed. The clinic can reissue a new order — the expired one stays as a permanent record."

---

## Part 5: Ops Dashboard (7–10 minutes)

### 5A — Pipeline View

1. Open a new tab, navigate to `https://functional-medicine-infrastructure.vercel.app/login`
2. Log in as **Ops Admin**: `ops@compoundiq-poc.com` / `POCAdmin2026!`
3. **Point out the dark-mode dashboard:**
   - Pipeline stage groups in the left sidebar (Payment, Submission, Pharmacy, Shipping, Errors)
   - Each stage has a count badge
   - Order table with columns: Order #, Clinic, Patient, Medication, Status, Tier, SLA, Age

> "This is the operations nerve center. Every order across every clinic is visible here. The dark theme is intentional — ops teams monitor this all day, and dark mode reduces eye strain."

4. **Point out an order row:**
   - Status badge (colored)
   - SLA countdown or overdue indicator
   - Tier icon (Fax)
   - Claim button

> "Each order shows its SLA status. If an order is overdue, it shows in red with the exact hours overdue. Ops can claim orders to prevent duplicate work."

5. **Show the filter bar:**
   - Filter by Clinic, Pharmacy, Tier, Date range
   - Show the "Clear Filters" button

> "Multi-dimensional filtering lets ops isolate specific issues — show me all Tier 4 fax orders from this week, or all orders from a specific clinic."

6. **Click an order** to open the detail drawer
7. **Point out the tabs:** Detail, History, Submissions, SLA

> "Full drill-down into any order. The History tab shows every state transition with timestamps and who triggered it. The Submissions tab shows every adapter attempt. The SLA tab shows all deadline tracking."

### 5B — SLA Heatmap

8. Click **"SLA"** in the sidebar
9. **Point out:**
   - Filter pills (All Active, Breached, etc.)
   - SLA breach cards with countdown timers
   - Escalation tier indicators
   - Acknowledge button

> "The SLA engine runs every 5 minutes. When a deadline is breached, it appears here with a countdown to the next escalation. Three tiers: Slack alert, DM to ops lead, PagerDuty page. Acknowledging stops the escalation — it tells the system 'I'm on it.'"

### 5C — Adapter Health Monitor

10. Click **"Adapters"** in the sidebar
11. **Point out:**
    - Per-pharmacy health card (Strive Pharmacy)
    - Health indicator (traffic light)
    - Circuit breaker state
    - Submission success rate chart
    - Quick action buttons (Disable Adapter, Force Fax, Health Check)

> "Every pharmacy integration is monitored. If a pharmacy's API starts failing, the circuit breaker opens after 3 consecutive failures and auto-cascades to the next tier. The ops team can see exactly what's happening and take manual action if needed."

### 5D — Fax Triage Queue

12. Click **"Fax"** in the sidebar
13. **Point out:**
    - Status filter pills (All, Received, Matched, Unmatched, Processed, Archived)
    - Queue metrics
    - Empty state if no faxes pending

> "Tier 4 pharmacies respond via fax. Inbound faxes land here with OCR text preview. Ops matches the fax to an order and assigns a disposition — Acknowledge, Reject, Query, or Unrelated. Tier 1 and 2 pharmacies skip this entirely because their responses come via API."

### 5E — Catalog Manager

14. Click **"Catalog"** in the sidebar
15. **Point out:**
    - Medication table with columns (Medication, Form, Dose, Wholesale, Retail, Status)
    - CSV upload drag-and-drop area
    - Manual entry form
    - Tabs: Catalog, Versions, Normalized, API Sync

> "The medication catalog is the pricing foundation. Catalogs come in via CSV upload, API sync, or manual entry. Every change is versioned. Price changes over 10% get flagged for review. And the normalized view lets you compare the same medication across pharmacies."

---

## Part 6: Architecture Highlights (3–5 minutes, no demo)

### The 4-Tier Pharmacy Adapter

> "The key innovation is the Pharmacy Adapter Layer. Instead of forcing every pharmacy onto one integration method, we meet them where they are:"

| Tier | Method | Speed | Coverage |
|------|--------|-------|----------|
| Tier 1 | Direct REST API | Instant | ~25% of pharmacies |
| Tier 2 | Portal Automation (Playwright) | ~5 min | ~20% |
| Tier 3 | Standardized API Spec | Instant | Future 30%+ |
| Tier 4 | Fax Fallback | ~30 min | Universal |

> "The routing is deterministic — always use the highest available tier. If it fails, cascade down. Fax is always the fallback. A single LifeFile API integration unlocks Empower, Belmar, UCP, and Strive — the largest pharmacy network in the country."

### Security & Compliance

> "HIPAA compliance is enforced at the infrastructure level, not just application code:"
- Row-Level Security on all 17 tables
- Zero PHI in Stripe (metadata contains order_id only)
- Supabase Vault for all pharmacy credentials
- 30-minute session timeout with warning modal
- Supabase Realtime DISABLED (hard HIPAA requirement)
- All data at rest encrypted AES-256

### Technology Stack

> "Built on Next.js 16, Supabase (PostgreSQL 15+), Stripe Connect Express, Twilio, and Documo mFax. Deployed on Vercel serverless. 9 cron jobs handle SLA enforcement, payment expiry, adapter health, and daily ops digest. Everything is atomic — Compare-And-Swap patterns on every state transition prevent race conditions."

---

## Part 7: Q&A / Wrap-Up

### Key Metrics to Mention

| Metric | Value |
|--------|-------|
| Order states | 23-state machine with 47 valid transitions |
| SLA types | 10 enforcement types with 3-tier escalation |
| Database tables | 17 (PostgreSQL with full RLS) |
| Cron jobs | 9 Vercel cron jobs |
| Build phases completed | 13 phases, 75 work orders |
| Hard constraints | 16 non-negotiable rules |
| Test coverage | 21/21 QA checks pass (Cowork validated) |

### Common Questions

**Q: How do you handle controlled substances?**
> "DEA-scheduled compounds are explicitly excluded from the adapter layer. They're flagged at search time and forced to Tier 4 (manual fax) only."

**Q: What about patient data privacy?**
> "Zero PHI touches Stripe. The checkout page shows 'Prescription Service' — never the medication name. SMS messages contain only the patient's first name and a URL. Row-Level Security ensures clinics can never see each other's data."

**Q: What's the revenue model?**
> "Per-transaction platform fee. The spread between wholesale and retail is split: clinic keeps their margin, platform captures 15% of the spread. Stripe processing fees come out of the platform's portion."

**Q: How long to integrate a new pharmacy?**
> "Tier 4 (fax) works immediately — just add the fax number. Tier 1 (API) requires their REST endpoint and credentials. Tier 2 (portal) requires Playwright selectors for their web portal. Tier 3 is our published spec that pharmacies can adopt."

---

## Post-Demo Checklist

- [ ] Answer all questions
- [ ] Share POC URL if appropriate
- [ ] Note any feedback or feature requests
- [ ] Schedule follow-up if interest
