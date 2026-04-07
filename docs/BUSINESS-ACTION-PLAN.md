# CompoundIQ — Business Action Plan

**Date:** April 7, 2026
**Owner:** Samuel Shamber
**Status:** 3 parallel tracks ready to execute

---

## Track 1: LegitScript Platform Certification (WO-81)

**Priority:** CRITICAL — blocks payment processing compliance and all advertising
**Timeline:** Start today, approval expected in 2-4 weeks
**Cost:** ~$975 application fee + ~$1,295-$2,150 annual certification

### Step 1 — Prepare Documentation (1-2 hours)

Gather the following before starting the application:

- [ ] **Company registration documents** — Business entity formation (LLC/Corp), EIN, state registration
- [ ] **Principals and officers** — Full legal names, titles, dates of birth for all company principals/owners
- [ ] **Business address** — Registered business address
- [ ] **Website URL** — `https://functional-medicine-infrastructure.vercel.app` (or your production domain if different)
- [ ] **Product/service description** — Use this language: "CompoundIQ is a B2B2C platform that enables clinics to search, price, and route compounded medication prescriptions to licensed compounding pharmacies. The platform facilitates patient payment collection via Stripe Connect and prescription fulfillment via direct API, portal automation, or HIPAA-compliant fax."
- [ ] **Compliance policies** — Any existing HIPAA compliance documentation, privacy policy, terms of service
- [ ] **Payment processor information** — Stripe account details (you'll need your Stripe account ID)

### Step 2 — Submit Application (30 minutes)

1. Go to: **https://www.legitscript.com/certification/healthcare-certification/**
2. Click "Apply for Certification"
3. Select **Healthcare Merchant Certification**
4. Fill in the application form with the documentation gathered in Step 1
5. Pay the application fee (~$975, nonrefundable)
6. Submit

**Tip:** If the standard application asks questions that don't quite fit a B2B2C platform model (they're designed for pharmacies and telehealth providers), select the closest option and add a note explaining your platform model. You're not a pharmacy — you're a marketplace that routes orders to licensed pharmacies.

### Step 3 — Respond to Review Questions (1-2 weeks)

LegitScript will review your application and may come back with questions:

- **Common questions they ask:**
  - How do you verify pharmacy state licensure? → "We maintain a pharmacy_state_licenses database table and filter search results at the query level. Unlicensed pharmacies never appear in results."
  - How do you handle controlled substances? → "DEA-scheduled compounds are flagged at search time and forced to Tier 4 (manual fax) only. They cannot be routed through automated adapter tiers."
  - How do you handle PHI? → "Zero PHI touches Stripe. Row-Level Security on all 17 database tables. HIPAA-adjacent architecture with Supabase Vault for credential encryption."
  - What pharmacies are in your network? → List your pharmacy partners (Strive Pharmacy for POC, planned integrations with ReviveRX, Vios, LifeFile network, etc.)

- [ ] Respond to any follow-up questions within 48 hours (faster response = faster approval)

### Step 4 — Receive Certification

- [ ] Download your LegitScript certification seal
- [ ] Save the certification ID for your records
- [ ] Notify the development team to add the seal to the checkout page and marketing pages

### Contacts

- LegitScript support: certification@legitscript.com
- Enterprise program inquiries: enterprise@legitscript.com (mention you're a platform/marketplace, not a single merchant — this may qualify you for the Enterprise Certification program with faster processing)

---

## Track 2: Pharmacy Catalog Data Acquisition (WO-79)

**Priority:** HIGH — the platform needs real medication data to be useful
**Timeline:** Start outreach today, data flowing in 1-2 weeks
**Cost:** $0 (your time only)

### Who to Contact

Contact pharmacies in this priority order:

| # | Pharmacy | Why Priority | What to Ask For |
|---|----------|-------------|----------------|
| 1 | **Any pharmacy your design partner clinics currently use** | They already have a relationship | "Can you share the price list you already have?" |
| 2 | **Strive Pharmacy** | Already in our system as seed data | Full formulary + real wholesale pricing |
| 3 | **Empower Pharmacy** | Largest compounder, LifeFile network | Formulary + pricing (or LifeFile API access) |
| 4 | **Belmar Pharmacy** | Major player, LifeFile network | Same |
| 5 | **ReviveRX** | Has REST API | Formulary + API documentation |
| 6 | **Vios Compounding** | Has REST API | Formulary + API documentation |
| 7 | **Olympia / DrScript** | Major functional med pharmacy | Formulary + pricing |
| 8 | **Wells / WellsPx3** | Major functional med pharmacy | Formulary + pricing |

### What to Send Them

Two files are ready to share (in your `docs/` folder):

1. **CATALOG-DATA-GUIDE.pdf** — Explains the CSV format, what each column means, and how to submit
2. **catalog-csv-template.csv** — Pre-filled template with 20 sample entries they can use as a reference

### Email Template — For Pharmacy Partners

```
Subject: CompoundIQ — Catalog Data Request for Platform Integration

Hi [Contact Name],

We're building CompoundIQ, a platform that connects functional medicine 
clinics with compounding pharmacies for streamlined prescription ordering, 
pricing, and fulfillment.

We'd like to add [Pharmacy Name]'s formulary to our platform so clinics 
can search your medications, compare pricing, and route prescriptions to 
you digitally — replacing the manual fax process.

Could you share your current formulary and wholesale pricing in CSV 
format? I've attached:
- A CSV template with the format we need (20 sample entries included)
- A data guide explaining each column

If you already have a price list in Excel/PDF format, we can convert it 
on our end — just send whatever you have.

We'd also need:
- The states you're currently licensed to ship to
- Your preferred fax number (for initial order delivery)
- A technical contact if you have an API we can integrate with

Happy to jump on a quick call if you'd prefer to discuss.

Best,
[Your Name]
CompoundIQ
```

### Email Template — For Design Partner Clinics

```
Subject: Quick ask — can you share your pharmacy price lists?

Hi [Clinic Contact],

As we build out CompoundIQ, we need real pharmacy catalog data to 
populate the search engine. You already have price lists from the 
compounding pharmacies you order from — could you share whatever 
you have? PDFs, spreadsheets, anything works.

This will let us get your current pharmacies into the system so when 
you start using the platform, your familiar pharmacies appear in 
search results with real pricing.

No special format needed — just send what you have and we'll 
convert it.

Thanks!
[Your Name]
```

### Step-by-Step Process

1. **Day 1 (today):**
   - [ ] Send the clinic email to your design partner clinic(s) — they can share what they already have
   - [ ] Send the pharmacy email to your top 3 pharmacy contacts with the CSV template + data guide attached

2. **Days 2-5:**
   - [ ] Follow up on any responses
   - [ ] Convert any PDF/Excel price lists into CSV format matching the template
   - [ ] Upload CSVs via the ops dashboard: log in as ops admin → Catalog → drag-and-drop upload

3. **Days 5-10:**
   - [ ] Follow up with non-respondents
   - [ ] Upload additional catalogs as they arrive
   - [ ] Verify search results show real pharmacies with real pricing
   - [ ] Enter pharmacy state licenses for each pharmacy (so state-filtered search works)

4. **Day 10+:**
   - [ ] Aim for at least 3 pharmacies with real catalog data
   - [ ] Test the full order flow with a real pharmacy and real medication

### How to Upload a Catalog

1. Log in: `https://functional-medicine-infrastructure.vercel.app/login`
   - Email: `ops@compoundiq-poc.com`
   - Password: `POCAdmin2026!`
2. Click **"Catalog"** in the sidebar
3. Drag the CSV file into the upload area (or click to browse)
4. Review the preview — check for validation errors
5. Click **"Confirm Upload"**
6. Verify items appear in the catalog table

### How to Add a New Pharmacy

This currently requires database access (Supabase dashboard). For each new pharmacy:

1. Add a record to the `pharmacies` table:
   - name, slug, fax_number, phone, state, integration_tier (TIER_4_FAX for most initially)
   - regulatory_status: ACTIVE
2. Add records to `pharmacy_state_licenses` for each state they're licensed in:
   - pharmacy_id, state_code, license_number, expiry_date
3. Upload their catalog CSV via the ops dashboard

**Note for development team:** We should build a pharmacy onboarding form in the ops dashboard so this doesn't require direct database access. This is part of the Clinic Onboarding Playbook workflow.

---

## Track 3: Compliance Sign-Off (WO-67)

**Priority:** MEDIUM — should be done before production deployment
**Timeline:** 1-2 days once you connect with the compliance officer
**Cost:** $0 (or whatever the compliance officer's time costs)

### What to Do

1. **Share the security audit document:**
   - File: `docs/security-audit.md` in the project repository
   - This covers the remediation of 14 npm vulnerabilities (10 high, 4 low) → 0 remaining
   - Includes PHI handling notes, BAA coverage section, and HIPAA hardening changes

2. **Ask the compliance officer to review:**
   - PHI handling across all 3 applications (clinic, ops, checkout)
   - BAA coverage matrix (which services have BAAs)
   - Sentry Auth/Cookie header redaction
   - Row-Level Security enforcement on all 17 tables
   - Zero-PHI policy for Stripe metadata

3. **Get sign-off:**
   - The compliance officer fills in their name and date in the sign-off table at line 117 of `docs/security-audit.md`:
   ```
   | Compliance Officer | [Name] | [Date] |
   ```

4. **Commit the signed document** back to the repository

### Who Is the Compliance Officer?

If you don't have a dedicated compliance officer yet, options:
- A healthcare attorney familiar with HIPAA
- A HIPAA compliance consultant (many offer one-time reviews for $500-$2,000)
- Your LegitScript certification process may surface compliance requirements that need a qualified reviewer

---

## Summary — What to Do This Week

| Day | Track 1 (LegitScript) | Track 2 (Catalog Data) | Track 3 (Compliance) |
|-----|----------------------|----------------------|---------------------|
| **Mon** | Gather documentation | Email design partner clinics + top 3 pharmacies | Identify compliance reviewer |
| **Tue** | Submit application ($975) | Follow up on responses | Share security-audit.md |
| **Wed** | — (waiting for review) | Convert any received price lists to CSV | — (waiting for review) |
| **Thu** | Answer any LegitScript questions | Upload first real catalog via ops dashboard | — |
| **Fri** | — | Upload additional catalogs | Receive sign-off |

**All three tracks run in parallel. None require code changes. None block each other.**

---

## After This Week — What Opens Up

Once you have real catalog data (Track 2) and LegitScript certification (Track 1):

| What Unlocks | Work Order |
|-------------|-----------|
| Real pharmacy search results for demos and beta clinics | WO-79 complete |
| Payment processing compliance for production | WO-81 Phase A complete |
| Google/Meta advertising for customer acquisition | WO-81 Phase A complete |
| HSA/FSA gateway integration | WO-76 (needs real orders) |
| LegitScript pharmacy verification badges | WO-81 Phase B |
| Product API catalog validation | WO-81 Phase C |

Meanwhile, the development team can build WO-80 (Multi-Script Patient Sessions) and WO-77 (Provider Signature Queue) in parallel — these don't need real catalog data.

---

*CompoundIQ — Three tracks. Zero blockers. Start today.*
