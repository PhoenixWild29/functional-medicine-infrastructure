# Pharmacy Outreach Email Templates

## Prerequisite

**DO NOT SEND THESE UNTIL YOU HAVE A COMMITTED CLINIC.** A cold pharmacy email gets ignored. A pharmacy email with a real clinic name attached converts at ~40%. The whole sequence breaks if you skip the clinic step.

The right sequence:
1. Close a design partner clinic (LOI signed)
2. Ask the clinic: "Which pharmacies do you currently prescribe through?"
3. Ask the clinic: "Can I mention your name when I reach out to them?"
4. **Then** send these emails

---

## Template 1 — Referred by the Clinic (HIGHEST CONVERSION)

**Subject:** [CLINIC NAME] referred me — compounding catalog request

Hi [PHARMACY CONTACT NAME],

[CLINIC NAME] — one of your regular prescribing clinics — suggested I reach out. We're building CompoundIQ, a multi-pharmacy prescription and payment platform for functional medicine practices. [CLINIC NAME] has committed to being one of our first clinics on the platform, and we'd like to make sure they can route their orders to you with no disruption.

The ask is simple: **your current wholesale formulary.** Whatever format is easiest for you:

- PDF catalog (most common, works day one)
- CSV export from your pharmacy management system
- Screenshot of your ordering portal's product list
- Even a few spreadsheet rows for the specific meds [CLINIC NAME] prescribes most: [LIST 3-5 MEDS — e.g. "Semaglutide 5mg/mL, Testosterone Cypionate 200mg/mL, Sermorelin 15mg, LDN 4.5mg capsule"]

**What you get in return:**

- A new prescribing channel — [CLINIC NAME] sends orders through our platform, you fulfill exactly the way you do today (fax, portal, or API)
- Zero integration work required on your end. If you have an API we can connect to it. If not, we send you a clean structured fax — same workflow you have today but with better formatting
- Prescription volume from other functional medicine clinics we onboard, if you want it

**What we handle:**

- HIPAA-compliant patient payment collection via Stripe
- Prescription routing, tracking, and status updates
- DEA EPCS 2FA for controlled substances (Testosterone, etc.)
- State licensing compliance (we only route orders to pharmacies licensed in the patient's state)

Could you send over the catalog this week? Or if it's easier, 15-minute call to walk through what we need?

Thanks,
[YOUR NAME]
[TITLE], CompoundIQ
[EMAIL] · [PHONE]

P.S. Live demo if you're curious: https://functional-medicine-infrastructure.vercel.app

---

## Template 2 — LifeFile Network Pharmacies (Empower, Belmar, UCP, Strive)

**Subject:** CompoundIQ — LifeFile API integration inquiry

Hi [CONTACT NAME],

We're building CompoundIQ, a multi-pharmacy routing platform for functional medicine clinics. We have [N] clinics committed to launch and we're mapping our pharmacy integrations.

Because [PHARMACY NAME] uses LifeFile/ePowerRx (as do Empower, Belmar, and UCP — the four largest 503A networks), a LifeFile API integration on our end unlocks your entire network simultaneously. This is the single highest-leverage technical integration in the space.

Two questions:

1. **Catalog data:** Can you send us your current wholesale formulary (PDF, CSV, or LifeFile export) so we can populate our catalog for our design partner clinics?
2. **API access:** Is LifeFile API credentials something we can negotiate access to — either directly with LifeFile/ePowerRx or through you as the dispensing pharmacy?

Even without API access, we can route orders to you via clean structured fax (Documo mFax, HIPAA-compliant) from day one. The API integration is the speed upgrade, not the gating item.

Happy to jump on a 15-minute call to walk through the platform and what a partnership would look like.

Thanks,
[YOUR NAME]
CompoundIQ
[EMAIL] · [PHONE]

Demo: https://functional-medicine-infrastructure.vercel.app

---

## Template 3 — Cold Pharmacy Outreach (Only if No Referrals Available)

**Subject:** New prescribing channel for [PHARMACY NAME] — 503A compounding

Hi [CONTACT NAME],

CompoundIQ is the multi-pharmacy prescription + payment platform for functional medicine practices. We route compounded prescriptions from clinic MAs to their preferred compounding pharmacy, handle HIPAA-compliant patient checkout, and track fulfillment end-to-end.

We're onboarding our first cohort of functional medicine clinics (focus: BHRT, GLP-1s, peptides, LDN). I'd like [PHARMACY NAME] on our pharmacy network so our clinics can prescribe your compounds.

Two asks:

1. **Your wholesale formulary** — PDF, CSV, or however you maintain it. Needed to populate our search results for clinic MAs.
2. **A 15-minute call** — to explain the integration options (API, portal automation, or fax) and state licensing coverage.

On your end: zero technical work required to receive orders (we can fax structured PDFs to your existing fax line). If you have an API, we can integrate for faster routing.

Your existing clinic relationships stay yours. We're infrastructure, not a marketplace that steals customers.

Best,
[YOUR NAME]
CompoundIQ
[EMAIL] · [PHONE]

---

## Follow-Up Sequence

**4 business days, no response — Follow-Up 1:**

> Hi [NAME] — checking in on my note below. Even just a PDF catalog dropped in reply would let us get started. Happy to handle everything else async. No call needed unless it's useful on your end.

**7 days after Follow-Up 1 — Follow-Up 2:**

> Last one. If this isn't a fit I understand — can you point me to whoever manages pharmacy partnerships / new prescriber onboarding on your team?

**If no response after Follow-Up 2:** mark the pharmacy "Deferred" in your tracker. Circle back in 90 days with progress updates ("we're now live with 5 clinics routing $X/mo, would love to revisit adding you").

---

## Target List Template

| Pharmacy | Contact Name | Contact Title | Email | Phone | Tier (1-4) | Clinic Referral | Sent Date | Template # | Response | Catalog Received | Status |
|----------|--------------|---------------|-------|-------|------------|-----------------|-----------|-----------|----------|------------------|--------|
| | | | | | | | | | | | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |

**Tier 1 (API):** ReviveRX, Vios, MediVera, LifeFile network (Empower, Belmar, UCP, Strive), Precision
**Tier 2 (Portal):** Olympia/DrScript, Wells/WellsPx3
**Tier 4 (Fax):** Everyone else

**Goal:** 3-5 catalogs received in Week 2-3 (covering the medications your design partner clinics actually prescribe).

---

## Catalog Data You Actually Need

When a pharmacy sends you their catalog, these are the fields your system needs. Send this list in your reply to any pharmacy that asks "what format do you need":

| Field | Required | Example |
|-------|----------|---------|
| Medication name | Yes | Semaglutide |
| Form | Yes | Injectable Solution |
| Dose / Concentration | Yes | 5mg/mL |
| Package size / Quantity | Yes | 5mL vial |
| Wholesale price (to clinic) | Yes | $150.00 |
| Supply duration (days) | Optional | 30 |
| Pharmacy SKU / NDC | Optional | SEMA-5MG-5ML |
| DEA schedule (if applicable) | Yes | 3 (for Testosterone, Ketamine) |
| Available states | Yes | All states where pharmacy is licensed |
| Refills allowed | Optional | Up to 5 |

We can handle any format they send (PDF, CSV, XLSX, even photos of a printed catalog). The ops team at CompoundIQ normalizes it into the app.

---

## What NOT to Promise

- ❌ "You'll get N orders per month" — you don't know this yet
- ❌ "We'll drive patients to you" — we drive clinic workflow, patients follow from the clinic
- ❌ "Exclusive access to our clinics" — we are a marketplace, not an exclusive partnership
- ❌ "Integration in 2 weeks" — Tier 1 API takes longer than that; Tier 4 fax is instant
- ❌ Specific revenue projections — these hurt you when they don't hit

## What TO Promise

- ✅ Clean, structured orders (no handwritten faxes)
- ✅ State licensing compliance on every order (we don't route to pharmacies without a license in the patient's state)
- ✅ DEA EPCS 2FA for Schedule II-V (21 CFR 1311 compliant)
- ✅ Patient payment handled by us (they don't chase payment from you)
- ✅ No cost to the pharmacy — we charge the clinic, not you
- ✅ Their existing clinic relationships remain their own
