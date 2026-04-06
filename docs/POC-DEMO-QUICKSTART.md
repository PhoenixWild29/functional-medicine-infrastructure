# CompoundIQ POC Demo — Quick Start Guide

**Duration:** 10–15 minutes
**URL:** https://functional-medicine-infrastructure.vercel.app

---

## Before You Start

- Run `npm run seed:poc` (syncs all credentials)
- Stripe test card: `4242 4242 4242 4242` | `12/28` | `123` | `78701`

---

## Demo Flow (6 Steps)

### Step 1 — Show the Clinic App (2 min)

1. Go to `/login` → log in as `admin@sunrise-clinic.com` / `POCClinic2026!`
2. Show the **dashboard** — KPI cards, order table, kanban toggle
3. Collapse/expand the **sidebar**

**Say:** "This is the medical assistant's workspace. All clinic orders at a glance."

---

### Step 2 — Create an Order (3 min)

1. Click **"+ New Prescription"**
2. State: **TX** → Search: **Sema** → Select **Semaglutide**
3. Show the **pharmacy card** (Strive Pharmacy, $150, Fax tier badge)
4. Select pharmacy → Click **2x multiplier**
5. Show the **margin math**: $300 retail, 50% margin, $22.50 platform fee, $127.50 clinic payout
6. Enter Sig: `Take 0.5mg weekly` → Continue to review
7. **Sign** → **Send Payment Link** → Confirm

**Say:** "30 seconds: search, price, sign, send. The patient gets a payment link via SMS. Three SLA timers start automatically."

8. **Get the checkout URL** — In a separate terminal, run:
```bash
npx dotenv -e .env.local -- npx tsx scripts/get-checkout-url.ts
```
Copy the URL from the output. (In production, the patient receives this via text message.)

---

### Step 3 — Patient Checkout (2 min)

1. Open the **checkout URL** from Step 2.8 in a new tab
2. Show: **clinic branding**, generic line item ("Prescription Service" — no medication name), $300 total
3. Pay with test card: `4242 4242 4242 4242`
4. Show the **success page**: animated checkmark, order reference `#xxxxx`, "Within 3–7 business days"

**Say:** "No login, no app, no account. Tap a link, pay, done. Zero PHI on any screen — Stripe never sees the medication name."

---

### Step 4 — Ops Dashboard (3 min)

1. New tab → log in as `ops@compoundiq-poc.com` / `POCAdmin2026!`
2. Show the **dark-mode pipeline** — the order you just created should appear
3. Click into the order → show **Detail, History, Submissions, SLA tabs**
4. Navigate to **SLA** → show breach tracking
5. Navigate to **Adapters** → show pharmacy health monitoring
6. Navigate to **Fax** → show the triage queue
7. Navigate to **Catalog** → show medication management

**Say:** "Every order across every clinic in one view. SLA enforcement runs automatically every 5 minutes. Circuit breakers protect against pharmacy API failures."

---

### Step 5 — Security Demo (1 min)

1. While logged in as ops, go to `/dashboard`
2. Show **"Access Denied"** — ops can't see the clinic app
3. Log in as clinic admin, go to `/ops/pipeline`
4. Show **"Access Denied"** — clinic can't see ops dashboard

**Say:** "Row-Level Security at the database level. Not just UI hiding — the data physically cannot cross boundaries."

---

### Step 6 — The Pitch (1 min)

**Say:**
> "CompoundIQ replaces phone calls, spreadsheets, and fax machines with an intelligent platform that handles the full prescription lifecycle. The clinic earns margin on every fill. The pharmacy gets structured, error-free orders. The patient gets a seamless checkout via text message. And the 4-tier adapter layer means we meet every pharmacy where they are — API, portal, spec, or fax."

---

## Quick Reference

| Account | Email | Password |
|---------|-------|----------|
| Ops | `ops@compoundiq-poc.com` | `POCAdmin2026!` |
| Clinic Admin | `admin@sunrise-clinic.com` | `POCClinic2026!` |
| Provider | `dr.chen@sunrise-clinic.com` | `POCProvider2026!` |
| MA | `ma@sunrise-clinic.com` | `POCMA2026!` |

| Seed Data | |
|-----------|---|
| Clinic | Sunrise Functional Medicine |
| Pharmacy | Strive Pharmacy (Tier 4 Fax, TX) |
| Patient | Alex Demo (TX) |
| Medications | Semaglutide, Tirzepatide, Testosterone, Sermorelin, Naltrexone |
| Stripe Test Card | `4242 4242 4242 4242` / `12/28` / `123` |
