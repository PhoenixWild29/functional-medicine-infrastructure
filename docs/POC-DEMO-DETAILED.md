# CompoundIQ POC Demo — Detailed Walkthrough

**Version:** 2.0 | **Date:** April 9, 2026
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

> **If a password above doesn't work** (credential drift after a Supabase rotation, manual reset, etc.):
>
> 1. **In-app fix:** log in as ops, go to `/ops/demo-tools`, click **Reset Demo Credentials**. All four accounts are forced back to the canonical passwords above.
> 2. **Locked out of ops too:** open the Vercel dashboard → Crons tab → `/api/cron/poc-credential-sync` → **Run Now**. Same effect, no terminal required.
> 3. The cron also runs automatically every day at 5 AM UTC, so drift never persists more than 24 hours unattended.

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

## Part 3: The Clinic Workflow (15–20 minutes)

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
5. Click the **collapse button** (chevron) on the sidebar — show it collapses to icon-only mode, click again to re-expand

> "The sidebar collapses for more screen real estate. The main content area adjusts automatically."

### 3B — Patient & Provider Selection (New in Phase 15)

6. Click **"+ New Prescription"** button
7. **Point out the patient/provider selector page:**
   - Patient search with name filter
   - Provider auto-selected (only one provider in this clinic)
   - "Continue to Pharmacy Search" button (disabled until both selected)

> "The first thing the MA does is select the patient. The patient's shipping state auto-populates for all pharmacy searches — no manual entry. The provider is also selected upfront. Both stay pinned at the top of every screen throughout the flow."

8. Search for **"Alex"** — select **Alex Demo** (TX state badge visible)
9. Note the provider **Dr. Sarah Chen** is auto-selected
10. Click **"Continue to Pharmacy Search"**

### 3C — Quick Actions: Favorites + Protocols (New in Phase 18)

11. **Point out the session banner** at the top — Alex Demo + Dr. Sarah Chen pinned
12. **Point out the Quick Actions Panel** with two tabs: **Favorites** and **Protocols**
13. **Favorites tab** — show the 4+ saved favorites (Semaglutide 0.5mg weekly, Standard TRT, LDN Starter, BPC-157). Note the titration/cycling badges on relevant favorites.

> "Provider favorites let you reorder common prescriptions in one click. No searching, no configuring — just click and go straight to pricing."

14. Click **Protocols tab** — show the protocol templates (Weight Loss Protocol, Mold/MCAS Support)
15. Click **Weight Loss Protocol** to expand — show the 3 medications with phase labels and sig text
16. **Point out** the "Load 3 Medications into Session" button

> "Protocol templates are a market-first feature. One click adds an entire multi-medication protocol to the session. The provider reviews and adjusts per patient before signing."

### 3D — Cascading Prescription Builder (New in Phase 17)

17. Go back to Configure Prescription. Type **"Sema"** in the medication search — select **Semaglutide**
18. **Point out** the cascading dropdown flow: ingredient → salt form (auto-skips if only one) → formulation card (Semaglutide 5mg/mL Injectable)
19. Select the formulation → **Point out the Structured Sig Builder**:
    - Dose amount + unit + frequency dropdowns
    - Timing dropdown (In the morning, At bedtime, etc.)
    - Duration dropdown (For 30 days, Ongoing, etc.)
    - Mode toggles: **Standard** / **Titration** / **Cycling**
20. Set dose: **10 units**, frequency: **Once weekly**, timing: **In the morning**
21. **Point out** the auto-generated sig: "Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly in the morning"

> "The sig generates automatically with full unit conversion — mg, mL, and syringe units for injectables. No manual math. NCPDP-compliant with a 1,000-character limit counter."

22. **Show Titration mode** — click "Titration" toggle. Point out the amber panel with Start/Increment/Interval/Target fields

> "For titration protocols like LDN, the provider sets start dose, increment, interval, and target. The sig generates: 'Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL.' No competitor has this."

23. Click back to **Standard** mode. Select **Strive Pharmacy** in the Pharmacy & Pricing section
24. Select quantity, refills. **Point out the star button** next to "Continue — Set Retail Price"

> "The star saves this configuration as a provider favorite for one-click reorder next time."

25. Click **"Continue — Set Retail Price"**

### 3E — Dynamic Margin Builder + Multi-Prescription

26. **Point out the Margin Builder** — Wholesale: $150 (locked), retail price **pre-populated at $210** (1.4× wholesale, from the clinic's 40% default markup), multiplier buttons, Sig field pre-filled
27. Click **2x multiplier** — retail updates to $300, margin 50%, platform fee $22.50, clinic payout $127.50

> "Full transparency. The retail price is pre-filled from the clinic's default markup setting (currently 40%), so the MA never types a number unless they want to override. Clicking 2x bumps it to a higher margin. The clinic sees exactly what they earn before committing. The sig is already pre-filled from the builder."

28. **Point out the three action buttons:**
    - **"Add & Search Another"** — add this prescription and search for another medication
    - **"Review & Send"** — go to batch review with all prescriptions
    - **"Save as Draft — Provider Signs Later"** — save without signing (WO-77)

> "The MA has three choices. They can add more prescriptions for the same patient, go straight to review, or save it as a draft for the provider to sign later."

29. Click **"Add & Search Another"**
30. **Point out** — back on configure page, session banner shows **"1 prescription in this session"**

31. Search for **"Test"** → select **Testosterone** → **Point out DEA Schedule 3 warning banner**
32. Select **Cypionate** salt form → select formulation → set dose + frequency
33. Select Strive Pharmacy, set retail price, click **"Review & Send (2)"**

### 3F — Batch Review, Interaction Alerts & EPCS 2FA (New in Phase 19)

34. **Point out the batch review page:**
    - **Red banner: "Controlled Substance — EPCS 2FA Required"** (Testosterone is DEA Schedule 3)
    - **Drug Interaction Alerts section** — the alerts are dynamic based on the medications in the current session. With Semaglutide + Testosterone (this walkthrough), an INFO-severity alert appears with clinical guidance. With Ketotifen + Ketamine (a different combination), an amber WARNING alert appears. The exact alert text depends on which pairs are seeded in the `drug_interactions` table.
    - Session banner with "2 prescriptions in this session"
    - Two prescription cards with medication, pharmacy, pricing, and sig for each
    - Combined totals (total retail, platform fee, clinic payout)
    - "Remove" link on each card
    - "+ Add Another Prescription" button
    - Single provider signature pad

> "The system automatically detects controlled substances and drug interactions. The red banner tells the provider that 2FA will be required at signing. The interaction alerts show known conflicts with clinical guidance — severity-colored: red for critical, amber for warning, blue for informational."

35. **Sign** on the signature pad
36. Click **"Sign & Send All 2 Prescriptions"** → Click **"Confirm & Send"**
37. **Point out the EPCS 2FA modal** that appears:
    - Red header: "EPCS Two-Factor Authentication Required — DEA 21 CFR 1311"
    - Lists controlled substances with DEA schedule badges
    - QR code for authenticator app setup (first time only)
    - 6-digit code input field
    - "Verify & Sign" button

> "This is DEA-compliant two-factor authentication. The provider scans the QR code with Google Authenticator or Authy on their phone, then enters the 6-digit code. The system verifies the code, logs the event to an immutable audit trail, and only then sends the prescription. No competitor in the compounding pharmacy space has this."

38. **Cancel** the 2FA modal (for demo purposes, or verify with an actual TOTP code)
28. **Point out the confirmation dialog** — total amount, prescription count, patient name, phone
29. Click **"Confirm & Send"** — watch the progress messages
30. Verify redirect to dashboard — both orders visible as "Awaiting Payment"

> "Two orders created, two payment links generated, three SLA timers each — all from one signature. The MA's workflow for a multi-medication visit: 45 seconds."

### 3F — Provider Signature Queue (Draft Flow)

> "Now let me show you the draft flow — where the MA saves a prescription for the provider to sign later."

31. Click **"+ New Prescription"** again
32. Select **Alex Demo** + provider auto-selects → Continue
33. Search **"Sema"** → select **Semaglutide** → select **Strive Pharmacy**
34. Click **2x multiplier**, enter Sig: **"Draft flow demo"**
35. Click **"Save as Draft — Provider Signs Later"**
36. Verify redirect to dashboard — order appears with **"Draft"** status

> "The MA saved this without the provider being present. No signature yet."

37. **Sign out** of clinic admin
38. **Log in as provider:** `dr.chen@sunrise-clinic.com` / `POCProvider2026!`
39. Click the **"Drafts"** tab on the dashboard

> "The Drafts tab lives on the shared dashboard and is visible to both clinic_admin and provider roles — anyone in the clinic can see what's pending signature, not just providers. The provider just happens to be the one who can act on it."
40. Click on the draft order — **point out the amber "Awaiting Provider Signature" banner**
41. Click **"Review & Sign This Prescription"**

> "The provider sees a dedicated sign page with all the details the MA entered — medication, pharmacy, pricing, directions. They just review and sign."

42. **Point out** the sign page: patient info, provider info, prescription details, financial summary, signature pad
43. **Sign** on the pad → Click **"Sign & Send Payment Link"** → Confirm
44. Verify redirect to dashboard — order now shows **"Awaiting Payment"**

> "The MA prepared it, the provider signed it later. Different sessions, different logins, same result. This is how a real clinic works."

45. **Sign out**

### 3G — Get the Checkout URL

46. **Get the patient checkout URL** — In production, the patient receives this via SMS. For the POC demo:

```bash
npx dotenv -e .env.local -- npx tsx scripts/get-checkout-url.ts
```

Copy the URL from the output.

> "In production, the patient gets this link in a text message. They tap it on their phone and land directly on checkout."

---

## Part 4: Patient Checkout (5–7 minutes)

### 4A — Checkout Page

1. Open the **checkout URL** from Step 30 in a new tab (or on a mobile device for extra impact)
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
   - Order table with columns: Order #, Clinic, Status, Tier, SLA, Assigned, Actions

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
    - Quick action button (Disable Adapter)

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
- Row-Level Security on all 33 tables
- Zero PHI in Stripe (metadata contains order_id only)
- Supabase Vault for all pharmacy credentials
- 30-minute session timeout with warning modal
- Supabase Realtime DISABLED (hard HIPAA requirement)
- All data at rest encrypted AES-256

### Technology Stack

> "Built on Next.js 16, Supabase (PostgreSQL 15+), Stripe Connect Express, Twilio, and Documo mFax. Deployed on Vercel serverless. 10 cron jobs handle SLA enforcement, payment expiry, adapter health, and daily ops digest. Everything is atomic — Compare-And-Swap patterns on every state transition prevent race conditions."

---

## Part 7: Q&A / Wrap-Up

### Key Metrics to Mention

| Metric | Value |
|--------|-------|
| Order states | 23-state machine with 47 valid transitions |
| SLA types | 10 enforcement types with 3-tier escalation |
| Database tables | 33 (PostgreSQL with full RLS) + 1 view |
| Cron jobs | 10 Vercel cron jobs |
| Build phases completed | 19 phases, 86 work orders (81 completed, 5 backlog) |
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
