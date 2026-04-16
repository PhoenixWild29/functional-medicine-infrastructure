# LegitScript Certification — Application Checklist

## Why You Need This

LegitScript certification is the industry standard for legitimacy signaling in the healthcare marketing space. Without it:

- **Google Ads / Meta Ads** block healthcare-adjacent advertising
- **Stripe / Square** may require it for healthcare merchants
- **Pharmacy partners** use it as a trust signal before sharing formularies
- **Clinics** cite it in due diligence before signing LOIs

**Turnaround:** 2-4 weeks from complete submission. Start now, run it in parallel with everything else.

**Cost:**
- Initial application: **$975**
- Annual monitoring: **$1,295–$2,150/year** (based on company category — Healthcare Merchant tier applies)

**Website:** https://www.legitscript.com/certification/healthcare-merchant-certification/

---

## Pre-Application Prep (Before Starting the Form)

Gather these documents first. The application will ask for most of them, and having them in one folder saves hours.

### Business Entity Documents

- [ ] **Articles of Incorporation** (Delaware C-Corp recommended for future fundraising)
- [ ] **EIN confirmation letter** from IRS (CP 575 form)
- [ ] **Operating agreement** or corporate bylaws
- [ ] **Certificate of good standing** from state of incorporation (often free to request online)
- [ ] **Business license** (state/city level, varies by jurisdiction)
- [ ] **DBA filings** if you operate under a trade name
- [ ] **Federal Tax ID** (EIN)

### Ownership / Leadership Documents

- [ ] **Beneficial ownership disclosure** — anyone owning 25%+ of the company
- [ ] **Key personnel bios** — founders, officers, medical advisors if any
- [ ] **Government-issued ID** for all beneficial owners (driver's license or passport)
- [ ] **Background disclosures** — any regulatory actions, felonies, license suspensions in last 10 years (answer truthfully — LegitScript does independent verification)

### Website / Platform Documentation

- [ ] **Public-facing website URL** (domain live with SSL, professional presentation)
- [ ] **Privacy Policy** on the website (HIPAA-compliant, mentions PHI handling)
- [ ] **Terms of Service** on the website
- [ ] **Contact information** — real address, phone number, support email
- [ ] **About page** — explains what CompoundIQ does in plain language
- [ ] **Screenshots of the platform** — clinic app, ops dashboard, patient checkout

### Compliance / Security Documentation

- [ ] **HIPAA compliance statement** — reference our `docs/technical/security-audit.md`
- [ ] **BAA documentation** — Business Associate Agreements with Supabase, Stripe, Twilio, Documo, Vercel, Sentry. Start requesting these NOW; some take 1-2 weeks
- [ ] **Data encryption statement** — AES-256 at rest, TLS 1.2+ in transit (all documented in our architecture docs)
- [ ] **Access control policies** — Row-Level Security on all 33 tables (documented)
- [ ] **Incident response plan** — what happens if there's a breach
- [ ] **Employee/contractor confidentiality agreements** if you have any team members

### Financial / Banking

- [ ] **Bank account** in the business's name
- [ ] **Payment processor agreement** — Stripe Connect Express agreement
- [ ] **Proof of business banking relationship** (voided check or bank letter)
- [ ] **Recent bank statement** (may be requested)

### Healthcare-Specific Documents

- [ ] **Description of services** — clearly state you are a B2B2C infrastructure/routing platform, not a pharmacy, not a prescriber, not a telehealth service
- [ ] **Pharmacy partner letter(s) of intent** (if you have any signed — helps but not required)
- [ ] **Clinic partner letter(s) of intent** (same — helps but not required)
- [ ] **Provider verification process** — how you confirm providers have active licenses (we use NPI + DEA number validation)
- [ ] **State-by-state licensing strategy** — our `pharmacy_state_licenses` table filters orders to compliant routes
- [ ] **Controlled substance handling** — document our EPCS 2FA implementation (21 CFR 1311 compliant)

### Insurance

- [ ] **General liability insurance** ($1M minimum typical) — if you don't have it, get a quote from Hiscox, Next Insurance, or Chubb. Usually $500-$2,000/year for a pre-revenue startup
- [ ] **Cyber liability insurance** (strongly recommended for HealthTech) — Coalition, Resilience, or Beazley. $1,500-$5,000/year
- [ ] **Professional liability / E&O** (if you provide advice — probably not applicable since you're infrastructure)

---

## Application Submission Steps

### Step 1: Create LegitScript Account

1. Go to https://www.legitscript.com/certification/healthcare-merchant-certification/
2. Click "Apply for Certification"
3. Select **"Healthcare Merchant"** category (not "Pharmacy" — you are not a pharmacy; you are a B2B infrastructure platform that routes prescriptions)
4. Create account with your founder email

### Step 2: Complete the Application Form

Typical sections (may vary):

1. **Business Information** — legal name, DBA, address, phone, email
2. **Ownership & Leadership** — beneficial owners, officers, directors
3. **Services Offered** — detailed description; use this language:

   > "CompoundIQ is a B2B2C infrastructure platform that connects licensed functional medicine clinics with licensed compounding pharmacies. We do not dispense medications, do not provide medical advice, do not prescribe medications, and do not hold a pharmacy license. We provide: (1) pharmacy search and comparison filtered by state licensing, (2) prescription routing via API, portal automation, or HIPAA-compliant fax, (3) HIPAA-compliant patient payment collection via Stripe Connect with zero PHI in payment metadata, (4) DEA 21 CFR 1311-compliant EPCS two-factor authentication for controlled substances, and (5) order tracking and audit trails. All prescribing decisions are made solely by licensed providers at our clinic partners. All dispensing is done solely by licensed compounding pharmacies."

4. **Compliance & Regulatory** — HIPAA, state licensing, DEA compliance
5. **Website / Platform URL** — the public marketing site
6. **Ownership documents upload**
7. **Payment** — $975 credit card

### Step 3: Respond to LegitScript Reviewer Questions

Within 3-7 business days, a reviewer will email with follow-up questions. Common ones:

- "Confirm you are not a pharmacy and not dispensing"
- "Provide evidence of HIPAA-compliant architecture"
- "Provide list of US states you operate in"
- "Provide pharmacy partner agreements" (even a verbal commitment + email thread helps)
- "Provide clinic partner agreements"

**Response time matters.** Reply within 24 hours with thorough answers to keep the application moving. Every delay on your side adds a week to the timeline.

### Step 4: Remediation (If Flagged)

If LegitScript flags anything, they will tell you specifically what needs to change. Typical fixes:

- Add a disclosure to your website
- Strengthen the Privacy Policy
- Provide additional BAA documentation
- Add a "How It Works" page that clarifies the infrastructure role

Fix quickly and resubmit the specific section. Most applications need 1-2 rounds of remediation.

### Step 5: Approval

Once approved, you receive:

- **LegitScript Certification Seal** (embed on your website + marketing materials)
- **Listing in LegitScript's Certified Merchants database**
- **Unblock on Google Ads, Meta Ads healthcare campaigns**
- **Trust signal for partner negotiations**

---

## Post-Approval Requirements

### Annual Monitoring Fee

- **$1,295/year** for Healthcare Merchant (standard tier)
- **$2,150/year** if you expand into pharmacy services or telehealth later
- Auto-renews; set a calendar reminder

### Ongoing Compliance

- [ ] Keep beneficial ownership information current (notify within 30 days of changes)
- [ ] Keep business licenses current
- [ ] Maintain BAAs with all subprocessors
- [ ] Report any regulatory actions within 10 days
- [ ] Respond to any LegitScript inquiries within 5 business days

### Display Requirements

- [ ] Embed LegitScript seal on your homepage footer
- [ ] Include seal in Google Ads / Meta Ads landing pages
- [ ] Reference certification in pharmacy and clinic pitch materials

---

## Timeline Tracker

| Step | Target Date | Completed | Notes |
|------|-------------|-----------|-------|
| Gather all pre-application documents | Week 1, Day 3 | | |
| Create LegitScript account + start form | Week 1, Day 4 | | |
| Submit complete application + payment | Week 1, Day 5 | | |
| Reviewer first response | Week 1-2 | | |
| Respond to reviewer questions | Within 24h of their email | | |
| Remediation round 1 (if needed) | Week 2-3 | | |
| Approval | Week 3-4 | | Target: end of week 4 |
| Embed seal on website | Day 1 of approval | | |
| Calendar annual renewal reminder | Day 1 of approval | | |

---

## Common Gotchas

1. **Don't call yourself a pharmacy.** You are infrastructure. Pharmacies have different (stricter) certification requirements. Be crystal clear in every field that you are a B2B2C platform, not a dispensing pharmacy.

2. **BAAs take time.** Start requesting BAAs from Supabase, Stripe, Twilio, Documo, Vercel, and Sentry TODAY. Some vendors (Stripe especially) require a formal request and a few business days. If you try to get these during the application review window, you'll stall for 1-2 weeks.

3. **Insurance proof matters.** Reviewers often ask for proof of general liability + cyber insurance. If you don't have these yet, get quotes this week. Even a binder confirmation (before the policy officially starts) usually satisfies the reviewer.

4. **Don't exaggerate.** LegitScript does independent verification. If you say "we have 10 pharmacy partners" and they call 3 of them, those 3 better confirm. Stick to what's true.

5. **Website must be live and professional.** If your marketing site is a Vercel default landing page or a "coming soon" splash, LegitScript will defer the application until you have a real site. Spend a weekend on this if needed — use a template like Framer, Webflow, or even plain Next.js marketing site.

6. **Annual fee is not pro-rated.** If you get certified in March, you pay the full $1,295 for that calendar year. Budget accordingly.

---

## Templates for Common Reviewer Questions

### "Confirm you are not a pharmacy"

> CompoundIQ Inc. is a B2B2C infrastructure platform, not a pharmacy. We do not: (a) hold a pharmacy license in any state, (b) physically compound or dispense any medication, (c) employ pharmacists, (d) maintain inventory, (e) ship medications to patients. All compounding and dispensing is performed by independent licensed compounding pharmacies. Our role is limited to (i) providing clinics with a search interface to compare licensed pharmacies, (ii) routing signed prescriptions from clinics to pharmacies via API/portal/fax, (iii) collecting patient payment via Stripe Connect, and (iv) providing order tracking. All prescribing decisions are made by licensed clinicians at our clinic partners; we do not influence, recommend, or override clinical decisions.

### "Describe your HIPAA compliance posture"

> CompoundIQ implements HIPAA-adjacent controls throughout the platform: (1) all PHI at rest is AES-256 encrypted via Supabase-managed encryption, (2) all data in transit uses TLS 1.2+, (3) Row-Level Security policies restrict PHI access to authorized users on all 33 database tables, (4) pharmacy credentials are stored in Supabase Vault with AES-256-GCM encryption, (5) zero PHI is transmitted to Stripe — payment metadata contains only an internal order_id, (6) SMS messages to patients contain only the patient's first name and a URL; no medication names or clinical information, (7) our error monitoring (Sentry) scrubs all PHI before transmission via beforeSend hooks, (8) Supabase Realtime is disabled to prevent PHI leaks via WebSocket, (9) immutable audit trails are maintained for all order state transitions and EPCS signing events. BAAs are in place with all subprocessors: [LIST].

### "List all states you operate in"

> CompoundIQ routes prescriptions to pharmacies licensed in the patient's state. Our platform enforces state licensing compliance at the database level via a pharmacy_state_licenses table — orders cannot be routed to pharmacies without an active license in the patient's shipping state. Current pharmacy coverage: [LIST STATES BASED ON YOUR CURRENT PHARMACY PARTNERS]. Clinics operate in their home states and must hold state-appropriate licenses for their prescribing providers.

---

## Documents That Already Exist in Our Repo (Link from Application)

Leverage the work we've already done — these docs directly answer LegitScript questions:

- `docs/technical/security-audit.md` — security posture
- `docs/SYSTEM-ARCHITECTURE-OVERVIEW.md` — HIPAA architecture
- `docs/PHARMACY-INTEGRATION-GUIDE.md` — pharmacy relationships
- `docs/BUSINESS-ACTION-PLAN.md` — compliance track status
- `docs/CLINIC-ONBOARDING-PLAYBOOK.md` — clinic verification process
- `docs/technical/DATA-DICTIONARY.md` — data model and RLS

---

## Status Tracker

| Item | Status | Date |
|------|--------|------|
| Articles of Incorporation filed | | |
| EIN obtained | | |
| Business bank account opened | | |
| General liability insurance quoted | | |
| Cyber liability insurance quoted | | |
| BAA requested from Supabase | | |
| BAA requested from Stripe | | |
| BAA requested from Twilio | | |
| BAA requested from Documo | | |
| BAA requested from Vercel | | |
| BAA requested from Sentry | | |
| Privacy Policy published on marketing site | | |
| Terms of Service published on marketing site | | |
| LegitScript account created | | |
| Application form completed | | |
| Application payment submitted ($975) | | |
| Reviewer initial contact | | |
| Reviewer questions answered | | |
| Remediation round 1 (if needed) | | |
| **LegitScript certified** | | |
| Seal embedded on website | | |
| Annual renewal calendar reminder set | | |
