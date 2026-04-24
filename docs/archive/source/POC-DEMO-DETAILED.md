# CompoundIQ POC Demo — Detailed Walkthrough

**Version:** 2.4 | **Date:** April 23, 2026
**Application:** https://functional-medicine-infrastructure.vercel.app
**Duration:** 30–45 minutes (with discussion)

> **What's new in v2.4 (2026-04-23):** This walkthrough is now a **live-demo script** — the presenter uses the app the way a real user would, and the investor sees whatever the app genuinely produces as a result of those actions. Prior versions asked the presenter to pre-stage specific visual states via a backstage `/ops/demo-tools` page right before the demo started; that pre-staging is gone. The demo no longer depends on clicking refresh buttons, setting timestamps, or forcing any screen into a specific colour state. Where earlier revisions predicted exact card counts, exact colours, or exact timestamp values on the Ops screens, those predictions have been replaced with descriptions of what each screen *is* — the specific state at demo time reflects the real activity the presenter creates during the walkthrough.

---

## Pre-Demo Setup

Three one-time items before demo day — no backstage pages, no state-staging, nothing to click "10 minutes before the demo."

1. **Authenticator app on your phone.** The EPCS-controlled-substance signing step in Part 3F uses standard TOTP two-factor authentication per DEA 21 CFR 1311. The demo provider (Dr. Chen) has a TOTP secret already configured server-side. You need the same secret loaded into a TOTP app on your phone so you can enter the rolling 6-digit code during the signing step. Any TOTP app works (Google Authenticator, 1Password, Authy, Bitwarden). See the **Authenticator Setup** subsection below for the exact secret values.
2. **Open browser tabs.** Prepare 3 tabs so you can switch roles quickly during the demo — one for the clinic app, one for the ops dashboard, one for the patient checkout link.
3. **Stripe test card ready.** `4242 4242 4242 4242` | Exp: `12/28` | CVC: `123` | ZIP: `78701`. You'll type this into the real checkout page in Part 4B.

**Optional:** a phone in your other hand to show the checkout page on a real mobile browser.

### Authenticator Setup (one-time, before demo day)

Dr. Sarah Chen's EPCS TOTP secret is pre-enrolled server-side so the signing flow skips first-time QR enrollment. To enter the rolling 6-digit code during the demo, load the same secret into a TOTP app on your phone once:

| Field | Value |
|-------|-------|
| Account label | `CompoundIQ Demo — Sarah Chen` |
| Issuer        | `CompoundIQ POC` |
| Secret (Base32) | `KBWXKJSXT4XFKUGUZKI2OYCNNYPUCVBH` |
| Algorithm     | `SHA-1` (default) |
| Digits        | `6` (default) |
| Period        | `30 seconds` (default) |
| `otpauth://` URI | `otpauth://totp/CompoundIQ%20Demo%20-%20Sarah%20Chen?secret=KBWXKJSXT4XFKUGUZKI2OYCNNYPUCVBH&issuer=CompoundIQ%20POC` |

Most authenticator apps accept either a QR scan of the `otpauth://` URI (generate one from a QR generator of your choice) or manual entry of the Base32 secret. Two devices recommended — a primary phone + a desktop TOTP client (e.g. 1Password, Bitwarden) — so a phone battery surprise doesn't block the demo. Verify by comparing codes across apps before the demo starts.

> **Clock drift note:** TOTP codes are clock-sensitive. If your phone's clock drifts more than ~30 seconds from the server, codes will be rejected. Make sure the phone's clock is set to automatic network time.

### POC Test Accounts

| Role | Email | Password | Redirects To |
|------|-------|----------|-------------|
| Ops Admin | `ops@compoundiq-poc.com` | `POCAdmin2026!` | `/ops/pipeline` |
| Clinic Admin | `admin@sunrise-clinic.com` | `POCClinic2026!` | `/dashboard` |
| Provider | `dr.chen@sunrise-clinic.com` | `POCProvider2026!` | `/dashboard` |
| Medical Assistant | `ma@sunrise-clinic.com` | `POCMA2026!` | `/dashboard` |

### POC Seed Data (reference — what the app is pre-configured with)

| Entity | Details |
|--------|---------|
| Clinic | Sunrise Functional Medicine |
| Provider | Sarah Chen, NPI 1234567890, TX license |
| Patient | Alex Demo, DOB 1985-06-15, TX, SMS opt-in |
| Pharmacies | 5 configured across all 4 tiers — Strive (Tier 4 Fax), Quick Rx + Express Digital Rx (Tier 1 API), Portal Plus (Tier 2 Portal), Hybrid Labs (Tier 3 Hybrid) |
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
   - Navigation icons for Dashboard / New Prescription / Settings
   - Active page highlighted
   - Sign-out control at the bottom

> "The sidebar gives quick access to the core clinic flows."

### 3B — Patient & Provider Selection (New in Phase 15)

6. Click **"+ New Prescription"** button
7. **Point out the patient/provider selector page:**
   - Patient search with name filter
   - Provider auto-selected (only one provider in this clinic)
   - "Continue to Pharmacy Search" button (disabled until both selected)

> "The first thing the MA does is select the patient. The patient's shipping state auto-populates for all pharmacy searches — no manual entry. The provider is also selected upfront. Both stay pinned at the top of every screen throughout the flow."

8. Search for **"Alex"** — select **Alex Demo** (TX state badge visible)
9. Note the provider **Sarah Chen** is auto-selected
10. Click **"Continue to Pharmacy Search"**

### 3C — Quick Actions: Favorites + Protocols (New in Phase 18)

11. **Point out the session banner** at the top — Alex Demo + Sarah Chen pinned
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

22. **Show Titration mode** — click "Titration" toggle. Point out the amber panel with Start at / Increase by / Every / Up to fields

> "For titration protocols like LDN, the provider sets start dose, increment, interval, and target. The sig generates: 'Take 0.1mL by mouth at bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL.' No competitor has this."

23. Click back to **Standard** mode. Select **Strive Pharmacy** in the Pharmacy & Pricing section
24. Select quantity, refills. **Point out the star button** next to "Continue — Set Retail Price"

> "The star saves this configuration as a provider favorite for one-click reorder next time."

25. Click **"Continue — Set Retail Price"**

### 3E — Dynamic Margin Builder + Multi-Prescription

26. **Point out the Margin Builder** — Wholesale: $150 (locked), retail price **pre-populated at $210** (1.4× wholesale, from the clinic's 40% default markup), multiplier buttons, Sig field pre-filled
27. Click **2x multiplier** — retail updates to $300, margin 50%, platform fee $22.50, est. clinic margin $127.50

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
    - **Controlled Substance banner** at the top when any prescription in the session is DEA-scheduled (appears because Testosterone is Schedule 3)
    - **Drug Interaction Alerts section** — alerts are dynamic based on the medications in the current session. With Semaglutide + Testosterone (this walkthrough), an INFO-severity alert appears with clinical guidance. With different pairings (e.g. Ketotifen + Ketamine), a WARNING-severity alert appears instead. The alert text comes from the drug-interactions knowledge base.
    - Session banner showing the prescription count
    - One prescription card per medication with pharmacy, pricing, and sig
    - Combined totals (total retail, platform fee, total clinic payout)
    - "Remove" link on each card
    - "+ Add Another Prescription" button
    - Single provider signature pad

> "The system automatically detects drug interactions and surfaces them with clinical guidance — severity-coloured: red for critical, amber for warning, blue for informational. DEA-scheduled compounds trigger the red banner and force the EPCS 2FA step before signing."

35. **Sign** on the signature pad
36. Click **"Sign & Send All 2 Prescriptions"** → Click **"Confirm & Send"** — watch the progress messages. (The EPCS 2FA modal surfaces here because Testosterone is Schedule 3 — enter the 6-digit code from your authenticator app.)
37. Navigate back to the dashboard to see the resulting orders — both should appear as "Awaiting Payment"

> **EPCS 2FA Demo Tip:** The EPCS 2FA modal (6-digit TOTP input, DEA 21 CFR 1311 citation) triggers on the batch Review & Send flow whenever any DEA-scheduled compound is present in the current prescription session. Because Steps 31–36 already added Testosterone (Schedule 3) to the session, clicking "Sign & Send All Prescriptions" → "Confirm & Send" will surface the modal with the red "EPCS Two-Factor Authentication Required" header, a Schedule badge, and "Verify & Sign" / "Cancel" buttons. Read the current 6-digit code from your authenticator app (the one you loaded via the Authenticator Setup subsection before demo day) and enter it.

> "Two orders created, two payment links generated, three SLA timers each — all from one signature. The MA's workflow for a multi-medication visit: 45 seconds."

### 3F — Provider Signature Queue (Draft Flow)

> "Now let me show you the draft flow — where the MA saves a prescription for the provider to sign later."

38. Click **"+ New Prescription"** again
39. Select **Alex Demo** + provider auto-selects → Continue
40. Search **"Sema"** → select **Semaglutide** → select **Strive Pharmacy**
41. Click **2x multiplier**, enter Sig: **"Draft flow demo"**
42. Click **"Save as Draft — Provider Signs Later"**
43. Navigate back to the dashboard — the new order appears with **"Draft"** status

> "The MA saved this without the provider being present. No signature yet."

44. **Sign out** of clinic admin
45. **Log in as provider:** `dr.chen@sunrise-clinic.com` / `POCProvider2026!`
46. Click the **"Drafts"** tab on the dashboard

> "The Drafts tab lives on the shared dashboard and is visible to both clinic_admin and provider roles — anyone in the clinic can see what's pending signature, not just providers. The provider just happens to be the one who can act on it."
47. Click on the draft order — **point out the amber "Awaiting Provider Signature" banner**
48. Click **"Review & Sign This Prescription"**

> "The provider sees a dedicated sign page with all the details the MA entered — medication, pharmacy, pricing, directions. They just review and sign."

49. **Point out** the sign page: patient info, provider info, prescription details, financial summary, signature pad
50. **Sign** on the pad → Click **"Sign & Send Payment Link"** → Confirm
51. Verify redirect to dashboard — order now shows **"Awaiting Payment"**

> "The MA prepared it, the provider signed it later. Different sessions, different logins, same result. This is how a real clinic works."

52. **Sign out**

### 3G — Get the Checkout URL (in-app, no terminal)

53. **Copy the patient checkout URL** — still logged in as the provider (or switch back to the clinic admin), on the clinic dashboard:
    a. Click any order showing **"Awaiting Payment"** to open the order drawer
    b. Click the emerald **"Copy Payment Link"** button — the checkout URL is now on your clipboard

> "In production, the patient gets this link in a text message when the order is signed. They tap it on their phone and land directly on checkout. In a live clinic we'd never copy-paste the link — we're doing that here only because this is a demo. If the link ever expires, the same button changes to **Regenerate Payment Link** and mints a fresh 72-hour URL in one click."

---

## Part 4: Patient Checkout (5–7 minutes)

### 4A — Checkout Page

1. Paste the **checkout URL** copied in Step 53 into a new tab (or into a mobile browser for extra impact)
2. **Point out:**
   - Clinic branding: "Sunrise Functional Medicine" displayed prominently
   - Generic line item: "Prescription Service" — NOT the medication name
   - Total: $300.00
   - **Email field** ("Email for receipt") — required, above the Stripe payment form. Stripe auto-emails a branded receipt to this address when the charge succeeds.
   - Stripe Elements payment form below (card + whichever wallet options the patient's device supports — e.g., Apple Pay in Safari on iOS, Google Pay in Chrome on Android, Cash App Pay, Bank, Affirm, Amazon Pay)
   - Trust signals: "256-bit TLS Encryption", "Powered by Stripe"
   - Footer: "Your payment info is encrypted and never stored by CompoundIQ"

> "This is what the patient sees. No login, no app download, no account creation. They tapped a link in a text message and landed here. Notice — no medication name anywhere. HIPAA compliance means zero Protected Health Information touches Stripe or appears on any patient-facing surface."

3. **Point out the white-labeling:**

> "The patient sees their clinic's name and branding. They don't know CompoundIQ exists. This is a branded checkout experience for the clinic."

### 4B — Complete Payment

4. Enter email in the **"Email for receipt"** field: `test@example.com` (Stripe will email the branded receipt here)
5. Enter Stripe test card in the Stripe Elements form below: `4242 4242 4242 4242` | Exp: `12/28` | CVC: `123` | ZIP: `78701`
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
   - Pipeline stage groups in the left sidebar (Payment, Submission, Pharmacy, Shipping, Errors / Terminal)
   - Each stage has a count badge
   - Order table with columns: Order, Status, Clinic, Pharmacy / Tier, SLA, Assigned, Actions

> "This is the operations nerve center. Every order across every clinic is visible here. The dark theme is intentional — ops teams monitor this all day, and dark mode reduces eye strain."

4. **Point out an order row:**
   - Status badge (colored)
   - SLA countdown or overdue indicator
   - Tier icon (Fax)
   - Claim button

> "Each order shows its SLA status. If an order is overdue, it shows in red with the exact hours overdue. Ops can claim orders to prevent duplicate work."

5. **Show the filter bar:**
   - Filter by Clinic, Pharmacy, Tier, Date range
   - Filters reset by selecting "All" in each dropdown

> "Multi-dimensional filtering lets ops isolate specific issues — show me all Tier 4 fax orders from this week, or all orders from a specific clinic."

6. **Click an order** to open the detail drawer
7. **Point out the tabs:** Detail, History, Submissions, Sla

> "Full drill-down into any order. The History tab shows every state transition with timestamps and who triggered it. The Submissions tab shows every adapter attempt. The SLA tab shows all deadline tracking."

### 5B — SLA Heatmap

8. Click **"SLA"** in the top nav
9. **Point out:**
   - Filter pills (All Active, Breached, etc.)
   - SLA breach cards with countdown timers
   - Escalation tier indicators
   - Acknowledge button

> "The SLA engine runs every 5 minutes. When a deadline is breached, it appears here with a countdown to the next escalation. Three tiers: Slack alert, DM to ops lead, PagerDuty page. Acknowledging stops the escalation — it tells the system 'I'm on it.'"

### 5C — Adapter Health Monitor

10. Click **"Adapters"** in the top nav
11. **Point out what the page is:** a card for every configured pharmacy across all 4 integration tiers (Tier 1 API, Tier 2 Portal, Tier 3 Hybrid, Tier 4 Fax). Each card shows:
    - A traffic-light health indicator (green / yellow / red for Degraded or Critical / slate for Idle)
    - Circuit breaker state (CLOSED / HALF_OPEN / OPEN)
    - 24-hour submission success rate + total submission count + failure count
    - p50 / p95 / p99 latency percentiles
    - A 24-hour submissions bar chart (green bars for successes, pink for failures)
    - "Last success" relative timestamp
    - Quick-action buttons (Disable Adapter, Force Tier 4)

> "Every pharmacy integration is monitored in real time. The card's colour reflects what that pharmacy has actually been doing in the last 24 hours — 95%+ success with recent activity is green, degraded performance shifts to yellow, and a circuit-breaker-open state flips it red. A pharmacy we've configured but haven't routed traffic through yet shows **Idle** — neutral slate — instead of falsely flashing Critical. What you see on the grid right now reflects today's real submission activity."

> **Narrator cue:** whatever card is coloured however is fine. The page's value is that it reports reality — green pharmacies are healthy, yellow pharmacies are ones ops should look at, red pharmacies need intervention, and the circuit breaker auto-cascades traffic to the next-highest tier when something's down. Narrate the colours you see in front of you and explain what each state means.

### 5D — Fax Triage Queue

13. Click **"Fax Queue"** in the top nav
14. **Point out what the page is:**
    - Status filter pills across the top (All, Received, Matched, Unmatched, Processed, Archived)
    - Queue metrics in the header (`X new`, `Y unmatched`, total count)
    - A list of inbound fax rows — each one shows status, from-number, page count, relative received-at timestamp, matched pharmacy/order if any
    - Click any row to open a triage detail panel on the right with the available actions

> "Tier 4 pharmacies respond via fax. Inbound faxes land here with an OCR text preview. The system attempts to auto-match each inbound fax to an open order. When it succeeds, the fax moves to Matched. When it can't, the fax sits in Unmatched until a human decides what to do with it — the right-hand triage panel gives ops the tools to manually match the fax to an order or archive it. Tier 1 and 2 pharmacies skip this entire page because their responses come back via API, not fax."

> **Narrator cue:** whatever rows you see (including none) is what the queue genuinely contains today. The page's value is that it gives ops a single place to resolve fax-borne pharmacy responses — narrate whatever's in front of you.

### 5E — Catalog Manager

16. Click **"Catalog"** in the sidebar
17. **Point out:**
    - Medication table with columns (Medication, Form, Dose, Wholesale, Retail, Status, Pharmacy, PA)
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
| Build phases completed | 19 phases, 87 work orders (all merged; WO-87 formulation support in prod) |
| Hard constraints | 16 non-negotiable rules |
| Test coverage | 65 Playwright E2E tests (all browsers) + 87 jest unit tests. CI gates every merge. |

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
