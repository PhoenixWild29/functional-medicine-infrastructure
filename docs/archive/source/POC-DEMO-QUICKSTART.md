# CompoundIQ POC Demo — Quick Start Guide

> # ⛔ ARCHIVED / SUPERSEDED — DO NOT PRESENT FROM THIS DOCUMENT
>
> **Use [`POC-DEMO-DETAILED.md`](./POC-DEMO-DETAILED.md) v2.12 instead.** This Quick Start is from **April 2026** and has not been maintained. It is retained for history only.
>
> **The dangerous item first:**
>
> - 🛑 **This document tells you to pay with a Stripe test card. Do not.** **Production runs on LIVE Stripe keys.** A test card hard-declines on stage; a real card puts through a **real charge with a real Connect payout split**. Every card instruction below has been struck through. In the current demo, **no card is ever entered** — the checkout page is rendered and narrated, and that's the whole beat. See Part 4B of the Detailed doc.
>
> **Other ways this document is now wrong:**
>
> - **Pricing is stale.** It says `$300 retail / $127.50 clinic margin`. Current verified figures are **$190.00 retail / $80.75 clinic margin** on a $95 wholesale at 2×.
> - **"Provider auto-selects" is false.** Sunrise has 4 providers as of v2.9 and the provider is a real selection.
> - **Favorites/Protocols counts are wrong.** It says "Favorites (4+)" and "Protocols (2)". Live: **Favorites (10)**, **Protocols (3)**.
> - **The 5-medication seed is gone.** The catalog is **77 Ingredients · 57 Salt Forms · 167 Formulations · 1,336 Pharmacy Offerings**.
> - **`scripts/get-checkout-url.ts` is obsolete.** The checkout URL comes from the in-app **Copy Payment Link** / **Copy Bundle Payment Link** button in the order drawer. No terminal step.
> - **The EPCS claim contradicts the Detailed doc.** This document says the 2FA modal triggers from the single-Rx favorites flow and not the batch path. The Detailed doc (authoritative) documents EPCS 2FA on the provider signing flow for DEA-scheduled compounds.
> - **The role narration is wrong.** This document narrates the MA's workflow while signed in as clinic_admin. In v2.12 the prescribing flow is genuinely run as `ma@sunrise-clinic.com`, and the MA's inability to sign is a headline beat.
>
> No further updates will be made to this file.

**Version:** 2.1 (ARCHIVED) | **Date:** April 21, 2026
**Duration:** 10–15 minutes
**URL:** https://functional-medicine-infrastructure.vercel.app

> **CI status (as of v2.1):** Every merge to main is backed by 65 passing Playwright E2E tests across Chromium / Firefox / WebKit / mobile Chrome, plus 6 jest unit tests covering the HIPAA idle-timeout state machine. E2E blocks merges — no `continue-on-error` escape hatch.

---

## Before You Start

- Run `npm run seed:poc` (syncs all credentials)
- ~~Stripe test card: `4242 4242 4242 4242` | `12/28` | `123` | `78701`~~ — **REMOVED. Production is on live Stripe keys. No card is entered in this demo.**

---

## Demo Flow (6 Steps)

### Step 1 — Show the Clinic App (2 min)

1. Go to `/login` → log in as `admin@sunrise-clinic.com` / `POCClinic2026!`
2. Show the **dashboard** — KPI cards, order table, kanban toggle
3. Collapse/expand the **sidebar**

**Say:** "This is the medical assistant's workspace. All clinic orders at a glance."

> *(Superseded: run this as `ma@sunrise-clinic.com` — see Detailed doc Part 3A.)*

---

### Step 2 — Multi-Prescription Flow (4 min)

1. Click **"+ New Prescription"**
2. Select **Alex Demo** as patient → provider auto-selects → Continue *(superseded: the provider is a real selection from 4 providers)*
3. **Show Quick Actions Panel** — Favorites tab (4+ saved configs) and Protocols tab (2 templates) *(superseded: Favorites (10), Protocols (3))*. Click a favorite like "Semaglutide 0.5mg weekly" for one-click load, OR:
4. Search **Sema** → Select **Semaglutide** → cascading dropdowns: salt form → formulation → dose/frequency/timing
5. **Point out the Structured Sig Builder** — auto-generated sig with unit conversion. Show Titration/Cycling mode toggles.
6. Select **Strive Pharmacy** → quantity → Click **"Continue — Set Retail Price"**
7. Click **2x multiplier** → show margin math (~~$300 retail, $127.50 est. clinic margin~~ → superseded: **$190.00 retail, $80.75 est. clinic margin**). Sig is pre-filled.
8. Click **"Add & Search Another"**
9. Search **Test** → Select **Testosterone** → **Point out DEA Schedule 3 warning** → Cypionate → formulation → dose/frequency → Strive → set price → Click **"Review & Send (2)"**
10. Show **batch review**: DEA schedule badges on controlled substance cards, drug interaction alerts (if applicable), 2 prescription cards, combined totals, single signature pad
11. **Sign** → **"Confirm & Send"** → orders submit and redirect to dashboard

> ~~**EPCS 2FA Tip:** The EPCS 2FA modal (QR code + 6-digit TOTP) triggers from the single-Rx favorites flow with a controlled substance, not the batch path.~~ — **Contradicts the Detailed doc. Follow POC-DEMO-DETAILED.md v2.12 Part 3H.**

**Say:** "Cascading dropdowns, structured sig builder, provider favorites, DEA-compliant 2FA. Patient selected first. Two prescriptions. One signature. 45 seconds for a multi-medication visit."

### Step 2B — Draft Flow (2 min)

1. Click **"+ New Prescription"** → Select Alex Demo → Continue
2. Search **Sema** → Select pharmacy → 2x multiplier → Enter Sig
3. Click **"Save as Draft — Provider Signs Later"** → redirects to dashboard
4. Show **"Drafts" tab** — the draft order is visible *(note: the Drafts tab is count-conditional and only appears once a draft exists)*
5. **Sign out** → Log in as provider: `dr.chen@sunrise-clinic.com` / `POCProvider2026!`
6. Click **Drafts** tab → Click draft → Click amber **"Review & Sign"** button
7. Review details → **Sign** → Confirm → order moves to "Awaiting Payment"

**Say:** "The MA saves it. The provider signs it later. Different sessions, different logins. This is how real clinics work."

8. ~~**Get the checkout URL** — In a separate terminal, run `npx dotenv -e .env.local -- npx tsx scripts/get-checkout-url.ts`~~ — **OBSOLETE.** Use the in-app **Copy Payment Link** button in the order drawer (or **Copy Bundle Payment Link** for a bundled pair). No terminal step.

---

### Step 3 — Patient Checkout (2 min)

1. Open the **checkout URL** from Step 2.8 in a new tab
2. Show: **clinic branding**, generic line item ("Prescription Service" — no medication name), ~~$300 total~~ *(superseded: $190.00, or $286.00 for the bundled pair)*
3. ~~Pay with test card: `4242 4242 4242 4242`~~ — 🛑 **DO NOT. Production is on LIVE Stripe keys.** Render the page, narrate it, stop. See Detailed doc Part 4B.
4. ~~Show the **success page**~~ — **Not reachable without a real payment. Describe only.** See Detailed doc Part 4C.

**Say:** "No login, no app, no account. Tap a link, pay, done. Zero PHI on any screen — Stripe never sees the medication name."

---

### Step 4 — Ops Dashboard (3 min)

1. New tab → log in as `ops@compoundiq-poc.com` / `POCAdmin2026!`
2. Show the **dark-mode pipeline** — the order you just created should appear
3. Click into the order → show **Detail, History, Submissions, SLA tabs**
4. Navigate to **SLA** → show breach tracking *(superseded: the page currently reads "0 SLA deadlines — All SLAs are on track or resolved". See Detailed doc Part 5B.)*
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
| Clinic | Sunrise Functional Medicine *(superseded: 2 clinics — + Blue Cedar Integrative Health)* |
| Pharmacy | Strive Pharmacy (Tier 4 Fax, TX) *(superseded: 5 pharmacies across all 4 tiers)* |
| Patient | Alex Demo (TX) *(superseded: 10 patients across 9 states)* |
| Medications | ~~Semaglutide, Tirzepatide, Testosterone, Sermorelin, Naltrexone~~ *(superseded: 77 ingredients · 57 salt forms · 167 formulations · 1,336 pharmacy offerings)* |
| Payment card | **NONE. Production is on live Stripe keys — no card is entered in this demo.** |
