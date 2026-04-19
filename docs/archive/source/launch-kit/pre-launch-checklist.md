# CompoundIQ Pre-Launch Checklist

**Purpose:** Track every non-product task that must be complete before the first real patient transaction can flow through the platform. The app works. The demo is tight. These are the *business and operational* bases that block actual revenue.

**Owner:** [YOUR NAME]
**Last updated:** 2026-04-16
**Target first-real-order date:** [FILL IN]

---

## Status Dashboard

| Bucket | Items | Completed | In Progress | Not Started |
|--------|-------|-----------|-------------|-------------|
| 1. Business & Legal | 8 | 0 | 0 | 8 |
| 2. Public Web Presence | 5 | 0 | 0 | 5 |
| 3. Production Readiness | 8 | 0 | 0 | 8 |
| 4. 60-Day Nice-to-Haves | 8 | 0 | 0 | 8 |
| **Total** | **29** | **0** | **0** | **29** |

Update this table as you work. At a glance you see how close you are to launch-ready.

---

## Critical Path — Order of Operations

These items block each other. Do them in this order:

1. **Entity + EIN + bank account** (blocks everything financial)
2. **BAA request emails** (take 1-2 weeks each — start immediately, finish later)
3. **Insurance quotes** (LegitScript asks; some BAAs require)
4. **Marketing website + privacy/ToS** (blocks LegitScript review, blocks credible outreach)
5. **Stripe Connect platform application** (1-3 week approval window — start early)
6. **LegitScript application** (2-4 week turnaround — use outputs from 1-4 above)
7. **Twilio A2P 10DLC registration** (1-3 week carrier review — independent track)
8. **Documo production account** (days, not weeks)
9. **Monitoring/alerting wired to real phone** (30 minutes once Sentry/PagerDuty keys are in hand)

Everything else runs in parallel or is post-launch polish.

---

## Bucket 1: Business & Legal Foundation

These items block LegitScript, Stripe Connect platform approval, and any real money movement. Get them done first.

### 1.1 Form the Business Entity

- [ ] **Status:** Not started
- **What:** File as Delaware C-Corporation (recommended for future fundraising and standard SAFE/equity instruments). Alternative: LLC if staying solo indefinitely, but C-Corp is much easier to fundraise into.
- **Why:** Required for business banking, Stripe Connect platform, BAAs, and any investor/angel round. SAFEs specifically require a C-Corp.
- **How:** Use Stripe Atlas ($500), Clerky ($99 + filing fees), or a startup-specialized lawyer ($2-4K). Atlas is simplest for pre-revenue founders.
- **Cost:** $500-$4,000 depending on path
- **Timeline:** 5-10 business days
- **Dependencies:** None
- **Deliverables:** Certificate of Incorporation, Bylaws, Stock Purchase Agreement (founder shares), 83(b) election filed with IRS within 30 days of stock issuance
- **Notes:** ___

### 1.2 Obtain EIN (Employer Identification Number)

- [ ] **Status:** Not started
- **What:** Federal tax ID for the business. Apply on irs.gov.
- **Why:** Required for business bank account, Stripe, payroll (if any), all vendor BAAs.
- **How:** irs.gov → Apply for EIN Online. Takes 15 minutes, instant approval during business hours.
- **Cost:** Free
- **Timeline:** Same day (if within 7am-10pm ET)
- **Dependencies:** Entity formed (1.1)
- **Deliverables:** CP 575 confirmation letter (save PDF — you'll need it 10+ times)
- **Notes:** ___

### 1.3 Open Business Bank Account

- [ ] **Status:** Not started
- **What:** Dedicated business checking + savings. Mercury and Brex are the startup standards.
- **Why:** Stripe Connect payouts, BAAs, and basic financial hygiene (never commingle personal and business funds — pierces the corporate veil).
- **How:** Mercury (mercury.com) or Brex (brex.com). Both are free and support online-only onboarding.
- **Cost:** $0 (free checking for startups)
- **Timeline:** 1-3 business days
- **Dependencies:** Entity + EIN (1.1, 1.2)
- **Deliverables:** Account number + routing number, debit card, online banking access
- **Notes:** Request a voided check PDF — needed for Stripe payout configuration

### 1.4 General Liability Insurance

- [ ] **Status:** Not started
- **What:** $1M liability coverage — industry standard minimum.
- **Why:** LegitScript asks. Some vendor BAAs require. Protects against slip-and-fall-style claims.
- **How:** Hiscox (hiscox.com), Next Insurance (nextinsurance.com), or Chubb. Online quote in 10 minutes.
- **Cost:** $500-$1,500/year for pre-revenue tech startup
- **Timeline:** Same day quote; binder same day; policy 1-3 days
- **Dependencies:** Entity (1.1)
- **Deliverables:** Certificate of Insurance (COI) PDF — attach to LegitScript app
- **Notes:** ___

### 1.5 Cyber Liability Insurance

- [ ] **Status:** Not started
- **What:** Coverage for data breaches, ransomware, PHI incidents.
- **Why:** Strongly recommended for any HealthTech touching PHI. Required by some enterprise clinic partners in future contracts.
- **How:** Coalition (coalitioninc.com), Resilience (resilience.com), or Beazley. Coalition is startup-friendly.
- **Cost:** $1,500-$5,000/year
- **Timeline:** 1-2 weeks (they'll ask security questions)
- **Dependencies:** Entity (1.1), basic security posture documentation (link to docs/technical/security-audit from archive)
- **Deliverables:** Policy PDF
- **Notes:** Ask about "waiting period" and "retroactive coverage" — both matter for HIPAA

### 1.6 BAA Requests — Send in Parallel, All 6 Today

Send email requests TODAY so BAAs land by the time LegitScript asks. Each vendor has a specific process:

- [ ] **Supabase BAA** — Email `security@supabase.com`. Requires Team plan ($599/mo) or Enterprise. Timeline: 3-5 business days.
- [ ] **Stripe BAA** — Dashboard → Settings → Business details → Request HIPAA BAA. Timeline: 5-10 business days.
- [ ] **Twilio BAA** — https://www.twilio.com/docs/glossary/what-is-hipaa → contact sales. Requires paid account. Timeline: 5-10 business days.
- [ ] **Documo BAA** — Email `support@documo.com`. Included on their HIPAA-eligible plan. Timeline: 2-5 business days.
- [ ] **Vercel BAA** — Requires Enterprise plan. Email `sales@vercel.com`. Timeline: 7-14 business days. *This is the most likely bottleneck.*
- [ ] **Sentry BAA** — Business plan or higher. Email `compliance@sentry.io`. Timeline: 3-7 business days.

**Cost:** Most BAAs require paid/enterprise tiers. Budget ~$800-$1,500/mo additional across all 6 vendors once BAAs are in place.

**Notes:** ___

### 1.7 Founder Stock Issuance + 83(b) Election

- [ ] **Status:** Not started
- **What:** Issue yourself founder shares (typically 8-10M shares at $0.0001/share) and file 83(b) election with IRS within 30 days.
- **Why:** Locks in cheap tax basis. Miss the 30-day window and you can owe huge taxes later as the company appreciates.
- **How:** Stripe Atlas / Clerky handles this automatically. If you used a lawyer, they should have handled it. If you formed your own entity manually, file 83(b) immediately.
- **Cost:** Included in entity formation services
- **Timeline:** Must file 83(b) within 30 days of stock purchase — NO EXCEPTIONS
- **Dependencies:** Entity formed (1.1)
- **Deliverables:** Stock certificate, 83(b) election mailed certified to IRS, copy kept in company records
- **Notes:** This is the single easiest way to lose tens of thousands of dollars to the IRS. Don't skip or delay.

### 1.8 Accounting Software + Bookkeeper

- [ ] **Status:** Not started
- **What:** QuickBooks Online ($30/mo) or Xero ($15/mo), or Bench.co ($249/mo for managed bookkeeping).
- **Why:** Investors will ask for books. LegitScript doesn't require it, but you'll need monthly financials by the time you raise.
- **How:** Pick one, connect bank account + Stripe, chart of accounts pre-built for SaaS.
- **Cost:** $15-$249/mo
- **Timeline:** 1 hour setup
- **Dependencies:** Bank account (1.3)
- **Notes:** Bench.co is worth it if you hate bookkeeping. QBO if you want to DIY.

---

## Bucket 2: Public Web Presence

When a clinic or pharmacy Googles "CompoundIQ" after getting your cold email, they should find a legitimate business — not a Vercel default page or nothing at all. This is the highest-leverage item in the whole checklist.

### 2.1 Marketing Website

- [ ] **Status:** Not started
- **What:** A 1-3 page professional marketing site at `compoundiq.com` (or whatever domain you pick).
- **Required pages:**
  - Home: 3-sentence pitch, 2-3 product screenshots, "Request a Demo" button
  - How It Works: the 3-tier flow (clinic → patient → pharmacy)
  - About: team + contact info (email + phone)
  - Privacy Policy (see 2.3)
  - Terms of Service (see 2.4)
- **Why:** LegitScript requires a live professional site. Cold outreach conversion drops ~50% without one. Design partner clinics do due diligence.
- **How:** Three options:
  1. **Framer** (framer.com) — drag-and-drop, 1-2 weekend hours, ~$20/mo
  2. **Webflow** — more powerful but steeper learning curve, ~$18/mo
  3. **Next.js landing page** — matches existing stack, more work but more control
- **Cost:** $15-$20/mo + domain
- **Timeline:** 1-2 weekends
- **Dependencies:** Domain (2.2)
- **Notes:** ___

### 2.2 Domain Name + Professional Email

- [ ] **Status:** Not started
- **What:** Register `compoundiq.com` (if available) or alternate. Set up Google Workspace for professional email.
- **Why:** `@compoundiq.com` converts 3-5× better than `@gmail.com` on cold outreach. LegitScript expects a professional domain.
- **How:** 
  - Domain: Namecheap or Cloudflare Registrar (cheaper than GoDaddy)
  - Email: Google Workspace Business Starter ($6/mo/user)
- **Cost:** ~$12/year domain + $6/mo/user email
- **Timeline:** 1 hour total
- **Dependencies:** None
- **Notes:** Also set up `founders@`, `support@`, `legal@`, `security@` aliases that all forward to you. Partners check these.

### 2.3 Privacy Policy

- [ ] **Status:** Not started
- **What:** HIPAA-compliant privacy policy covering PHI handling.
- **Why:** LegitScript, clinic LOIs, BAA counterparties all ask.
- **How:** 
  - DIY with Termly (termly.io) — generate in 15 min, ~$10/mo
  - Iubenda (iubenda.com) — similar
  - Lawyer-drafted — $500-$2,000 one-time
  - Reference: our existing `docs/archive/source/technical/security-audit.md` has much of the substance
- **Cost:** $10/mo (tool) or $500-$2,000 (lawyer)
- **Timeline:** 30 min (tool) or 1 week (lawyer)
- **Dependencies:** Marketing site to host it on
- **Notes:** ___

### 2.4 Terms of Service

- [ ] **Status:** Not started
- **What:** Terms of use for the platform.
- **Why:** Required for LegitScript. Required in every clinic LOI. Required for Stripe Connect platform application.
- **How:** Same tools as 2.3. Reference our existing platform architecture when specifying limitations of liability (we are infrastructure, not a pharmacy, not a prescriber).
- **Cost:** Included with 2.3
- **Timeline:** Included with 2.3
- **Dependencies:** 2.3
- **Notes:** ___

### 2.5 Public Contact Methods

- [ ] **Status:** Not started
- **What:** Real phone number + physical address on the site.
- **Why:** LegitScript verifies these. Clinics expect them. "Contact us" forms alone don't count.
- **How:**
  - Phone: Google Voice (free) or OpenPhone ($15/mo) forwarding to your mobile
  - Address: Virtual office (Regus, iPostal1) ~$10-30/mo OR your home address if comfortable
- **Cost:** $0-$45/mo
- **Timeline:** Same day
- **Notes:** Don't use a PO Box — most B2B counterparties reject those.

---

## Bucket 3: Production Readiness

Items required before the first real prescription can flow through the platform with a real patient paying a real pharmacy.

### 3.1 Stripe Connect Platform Application

- [ ] **Status:** Not started
- **What:** Apply to be a Stripe Connect Express platform (not just a standard merchant).
- **Why:** Required to move money between patients, platform, and clinic payouts. Different (stricter) review process than a standard Stripe account.
- **How:** Stripe dashboard → Connect → Apply to be a platform. Requires detailed business description, website, expected volume, KYC documentation.
- **Cost:** Free; standard Stripe processing fees (2.9% + $0.30) apply
- **Timeline:** 1-3 weeks (sometimes faster)
- **Dependencies:** Entity (1.1), EIN (1.2), bank account (1.3), marketing site (2.1), BAA requested (1.6)
- **Notes:** Write the business description carefully. Emphasize: you are a B2B2C infrastructure platform, you do not handle prescriptions, you move payment only.

### 3.2 Twilio A2P 10DLC Registration

- [ ] **Status:** Not started
- **What:** Register your brand + SMS campaign with US mobile carriers (mandatory since 2023 for all A2P messaging).
- **Why:** Without registration, your SMS checkout links will be throttled or blocked by carriers. Patients won't get the text.
- **How:** Twilio dashboard → Messaging → Compliance → A2P 10DLC. Brand registration ($44 one-time), campaign registration ($10/mo per campaign).
- **Cost:** ~$54 first year, $10/mo ongoing
- **Timeline:** 1-3 weeks (TCR review is slow)
- **Dependencies:** Entity (1.1), professional email domain (2.2), HIPAA BAA (1.6) if messaging contains PHI
- **Notes:** Our current SMS contains only first name + URL — no PHI. Still needs registration.

### 3.3 Documo Production Account + Dedicated Fax Number

- [ ] **Status:** Not started
- **What:** Upgrade Documo to production tier with HIPAA BAA, provision a dedicated outbound fax number.
- **Why:** Current setup is test-tier. Real pharmacy submissions need a real fax number + HIPAA coverage.
- **How:** Documo dashboard → Upgrade plan → Request BAA + fax number provisioning.
- **Cost:** $30-$150/mo depending on volume tier
- **Timeline:** 1-3 business days
- **Dependencies:** BAA (1.6)
- **Notes:** ___

### 3.4 LegitScript Certification

- [ ] **Status:** Not started
- **What:** Healthcare Merchant certification.
- **Why:** Required to run healthcare-adjacent Google/Meta ads, expected by clinics and pharmacies during due diligence, sometimes required by Stripe for healthcare merchants.
- **How:** Full checklist in [`legitscript-application-checklist.md`](legitscript-application-checklist.md) — follow that doc step-by-step.
- **Cost:** $975 application + $1,295/year monitoring
- **Timeline:** 2-4 weeks from complete submission
- **Dependencies:** Entity, EIN, insurance, BAAs, marketing site, privacy policy, ToS (1.1–2.4)
- **Notes:** Everything else in Bucket 1 and 2 must be done first.

### 3.5 Monitoring + Alerting Wired to a Real Phone

- [ ] **Status:** Not started
- **What:** Sentry alerting + PagerDuty (or Opsgenie) configured to actually page someone when critical errors or cron failures occur.
- **Why:** Right now errors silently log. In production, a cron failure at 2am must wake someone up.
- **How:**
  - Sentry: configure Issue Alerts for high-severity errors to fire Slack + PagerDuty
  - PagerDuty: free tier covers 5 users; set up on-call schedule (just you to start)
  - Test end-to-end: trigger a fake error and confirm your phone actually buzzes
- **Cost:** Free tier works until ~5 responders
- **Timeline:** 2-4 hours setup + 30 min end-to-end test
- **Dependencies:** None
- **Notes:** CLAUDE.md already references PagerDuty routing key. Confirm it's wired to a real account.

### 3.6 Supabase Point-in-Time Recovery + Scheduled Backups

- [ ] **Status:** Not started
- **What:** Enable PITR in Supabase project settings.
- **Why:** If the database is corrupted or a bad migration runs, PITR lets you rewind to any point in the last 7 days. Without it, you have only daily snapshots.
- **How:** Supabase dashboard → Database → Backups → Enable Point-in-Time Recovery. Requires Team plan ($599/mo).
- **Cost:** Included in Team plan (which you need for BAA anyway)
- **Timeline:** 1 click
- **Dependencies:** Team plan subscription (part of 1.6 BAA upgrade)
- **Notes:** Also configure Weekly Physical Backups if available.

### 3.7 Support Inbox + Response Process

- [ ] **Status:** Not started
- **What:** `support@compoundiq.com` email with a defined response SLA (e.g. 4 business hours for design partners).
- **Why:** When a design partner clinic emails needing help, it must land somewhere and get a reply fast.
- **How:** 
  - Set up the alias to forward to you
  - For scale later: Front, Help Scout, or Zendesk (all have startup tiers ~$15-30/user/mo)
- **Cost:** $0 initially; $15-30/user/mo at scale
- **Timeline:** 15 min setup
- **Dependencies:** Professional email (2.2)
- **Notes:** Design Partner Agreement promises 2-hour response for critical issues — actually plan to honor this.

### 3.8 Mobile Device Validation

- [ ] **Status:** Not started
- **What:** End-to-end patient checkout flow tested on a real iPhone (Safari) and a real Android phone (Chrome). Clinic app and ops dashboard tested on iPad Safari and iPhone Safari for graceful degradation.
- **Why:** Patient checkout is mobile-first by design — patients receive SMS and tap the link on their phone. If Apple Pay / Google Pay doesn't render correctly on real iOS Safari or Android Chrome, the first real transaction fails silently. Zero rounds of Cowork QA ran on mobile; this is the single highest-risk validation gap before first production order.
- **How:** Follow the full test plan in [`mobile-validation-test-plan.md`](mobile-validation-test-plan.md) — 30-minute execution with your phone + your wife's phone, covers all 3 applications on 4 device/browser combinations.
- **Cost:** $0 (own devices) or ~$40/mo (BrowserStack / LambdaTest if no Android available)
- **Timeline:** 30-45 min first pass; re-run whenever frontend changes ship to /checkout/* or any mobile-responsive component
- **Dependencies:** Live deployment (already met)
- **Notes:** Patient checkout is the blocking gate. Clinic app and ops dashboard failures on mobile are logged as Priority 2 bugs, not launch blockers.

---

## Bucket 4: 60-Day Nice-to-Haves

Worth doing within 2 months of first real order. Not blockers, but high-leverage.

### 4.1 Status Page

- [ ] **Status:** Not started
- **What:** Public-facing status page showing platform uptime by component.
- **Why:** Pharmacy partners and clinics will ask. Enterprises expect it.
- **How:** statuspage.io (Atlassian, $0-$79/mo), Instatus (free tier), or self-hosted with Upptime (free GitHub-based).
- **Cost:** $0-$79/mo
- **Timeline:** 2-4 hours
- **Notes:** ___

### 4.2 Recorded Demo Video

- [ ] **Status:** Not started
- **What:** 5-8 minute Loom walking through the clinic workflow + patient checkout.
- **Why:** For clinics who can't take a live meeting. Embeds in emails and the marketing site.
- **How:** Loom (loom.com, free tier works). Follow POC-DEMO-QUICKSTART for a tight 5-minute version.
- **Cost:** $0 (free tier) or $15/mo (Pro)
- **Timeline:** 2-3 hours with retakes
- **Notes:** Keep it under 8 minutes. Longer videos don't get watched.

### 4.3 CRM (Customer Relationship Management)

- [ ] **Status:** Not started
- **What:** Track every clinic and pharmacy in your pipeline with contact history, next action, and status.
- **Why:** By the time you have 15 clinic leads, you'll lose track without one.
- **How:** HubSpot Free, Pipedrive ($14/user/mo), Attio (modern alternative, $29/user/mo), or even a well-structured Airtable/Notion base.
- **Cost:** $0-$29/user/mo
- **Timeline:** 1-2 hours setup
- **Notes:** HubSpot Free is plenty for <100 contacts.

### 4.4 Advisory Board (Informal)

- [ ] **Status:** Not started
- **What:** 2-3 advisors who can make intros + give advice in exchange for 0.25-0.5% common stock each (2-year vest).
- **Why:** Credibility signal for investors. Warm intros to clinics and pharmacies.
- **How:** Identify 3-5 targets (functional medicine thought leaders, pharmacy operators, healthcare exits). Offer FAST ("Founder Advisor Standard Template" by Founder Institute — free standard doc).
- **Cost:** ~0.75-1.5% total equity pool; legal costs to paper the FAST agreements ~$500
- **Timeline:** 1-2 months to close 2-3 advisors
- **Notes:** Don't give equity until they've actually helped (intro made, meeting taken). Lagging advisors with equity is the #1 cap table regret.

### 4.5 Design Partner Case Study Plan

- [ ] **Status:** Not started
- **What:** Written case study with 1-2 design partners after 60-90 days of real use.
- **Why:** Most important marketing asset for next wave of clinic outreach.
- **How:** Interview → draft → clinic approves → publish on marketing site + pitch deck.
- **Cost:** $0
- **Timeline:** 2 weeks from first interview
- **Dependencies:** At least one design partner with 30+ days of real usage
- **Notes:** ___

### 4.6 TCPA Compliance for SMS

- [ ] **Status:** Not started
- **What:** Documented opt-in flow + opt-out handling for all patient SMS.
- **Why:** TCPA violations = $500-$1,500 per message statutory damages. Trial lawyers scan for this.
- **How:**
  - Opt-in: captured during patient record creation in the clinic app (store timestamp + source)
  - Opt-out: "Reply STOP to opt out" in every message; honor within 10 min
  - Compliance doc: short internal memo documenting the process
- **Cost:** $0
- **Timeline:** 2-4 hours of work
- **Dependencies:** Twilio A2P 10DLC (3.2)
- **Notes:** Check src/lib for existing opt-out handling — we may already have this.

### 4.7 Data Retention + Deletion Policy

- [ ] **Status:** Not started
- **What:** Written policy for how long PHI is retained and how deletion requests are handled.
- **Why:** HIPAA requires it. Clinic BAAs will reference it. Patients in some states (CA via CMIA, many others) can request deletion.
- **How:** Short internal policy doc. Reference our existing soft-delete pattern (all tables have `deleted_at`) and order_status_history immutable audit.
- **Cost:** $0 (DIY) or $500 (lawyer-reviewed)
- **Timeline:** 2-4 hours
- **Notes:** ___

### 4.8 Founder Employment Agreement + IP Assignment

- [ ] **Status:** Not started
- **What:** Employment agreement between you and the company, with IP assignment clause ensuring all code/IP you've written belongs to the C-Corp.
- **Why:** Without this, investors will refuse to fund. Any IP that predates the IP assignment is ambiguous.
- **How:** Stripe Atlas includes this. Lawyer can paper it for $500-1K. Clerky also includes.
- **Cost:** Usually included in entity formation package
- **Timeline:** 1 hour to review and sign
- **Dependencies:** Entity (1.1)
- **Notes:** Date the IP assignment as early as possible — ideally the same day as incorporation.

---

## Suggested 4-Week Sprint Plan

### Week 1 (Parallel Tracks)

**Track A — Business Foundation (you do this):**
- Day 1: File Delaware C-Corp via Stripe Atlas
- Day 2: Apply for EIN on irs.gov
- Day 2: Open Mercury business bank account
- Day 2: Get insurance quotes (Hiscox + Coalition)
- Day 3: Register domain (compoundiq.com), set up Google Workspace
- Day 3: Send BAA request emails to all 6 vendors (template below)

**Track B — Marketing Site (weekend project):**
- Day 6 (Saturday): Build 3-page Framer site
- Day 7 (Sunday): Generate Privacy Policy + ToS via Termly, add to site

**Track C — Outreach (from launch-kit/clinic-outreach-email):**
- Day 1-5: Email 5-8 warm clinic contacts (launch-kit/clinic-outreach-email.docx)

### Week 2

- LegitScript application submitted (using outputs from Week 1)
- Stripe Connect platform application submitted
- Twilio A2P 10DLC brand registration started
- Insurance policies in force
- Demo calls with clinics booked

### Week 3

- 1-2 design partner LOIs signed (launch-kit/design-partner-agreement.docx)
- Pharmacy outreach begins to their named pharmacies (launch-kit/pharmacy-outreach-email.docx)
- BAAs arriving — file each as it lands
- Documo production account provisioned
- Monitoring/alerting end-to-end test complete

### Week 4

- LegitScript reviewer questions answered (reply within 24h)
- Stripe Connect platform approved (optimistically)
- First pharmacy catalog loaded
- First test prescription run end-to-end with a design partner (may still be test-mode)
- Sentry + PagerDuty paging confirmed working

### Week 5-8 (Post-Launch Polish)

- LegitScript approved → seal embedded on marketing site
- Nice-to-haves from Bucket 4 as time permits
- First real production transaction with real patient + real money
- Case study interviews scheduled

---

## BAA Request Email Template

Paste this template, customize the vendor name, send to all 6 vendors in Week 1:

> **Subject:** HIPAA BAA request — CompoundIQ Inc.
>
> Hello [Vendor] team,
>
> CompoundIQ Inc. is a B2B2C infrastructure platform connecting functional medicine clinics with compounding pharmacies. We currently use [Vendor] in our production stack and are preparing for launch with our first design partner clinics.
>
> Protected Health Information (PHI) will flow through our application, and we are implementing HIPAA-adjacent controls throughout: AES-256 encryption at rest, TLS 1.2+ in transit, Row-Level Security on all database tables, zero-PHI in payment processor metadata, PHI-scrubbed error monitoring, and immutable audit trails.
>
> To complete our compliance posture, we need a Business Associate Agreement with [Vendor]. Could you send your BAA template, confirm the required plan/tier, and let us know the typical turnaround time for execution?
>
> Our account email is [YOUR EMAIL], and our incorporation details can be provided on request.
>
> Thank you,
> [YOUR NAME]
> Founder, CompoundIQ Inc.
> [YOUR PROFESSIONAL EMAIL]

---

## Vendor Contact Directory

| Vendor | Purpose | Contact | BAA Request Sent | BAA Received | Notes |
|--------|---------|---------|------------------|--------------|-------|
| Supabase | Database + Auth | security@supabase.com | | | Team plan required |
| Stripe | Payments + Connect | Dashboard → HIPAA request | | | Platform + BAA |
| Twilio | SMS | Sales contact | | | Plus A2P registration |
| Documo | Fax | support@documo.com | | | Production tier |
| Vercel | Hosting | sales@vercel.com | | | Enterprise required — slowest |
| Sentry | Error monitoring | compliance@sentry.io | | | Business plan+ |
| Mercury | Banking | Not HIPAA-scoped | N/A | N/A | No BAA needed |

---

## Budget Summary

### One-Time Costs

| Item | Cost |
|------|------|
| Entity formation (Stripe Atlas) | $500 |
| LegitScript application | $975 |
| Twilio A2P 10DLC brand registration | $44 |
| Privacy Policy + ToS (Termly 1 yr) | $120 |
| Marketing site setup (Framer) | $0 (first month free) |
| Domain (compoundiq.com) | $12/yr |
| **One-time total** | **~$1,651** |

### Recurring Monthly Costs (post-BAAs, production tier)

| Item | Monthly |
|------|---------|
| Supabase Team plan | $599 |
| Vercel Enterprise | TBD (contact sales) |
| Sentry Business | ~$80 |
| Twilio (base + campaign) | $10 + usage |
| Documo production | $30-$150 |
| Google Workspace | $6/user |
| Mercury banking | $0 |
| Framer site | $20 |
| **Recurring total** | **~$750-$900+/mo** |

### Annual Costs

| Item | Annual |
|------|--------|
| General liability insurance | $500-$1,500 |
| Cyber liability insurance | $1,500-$5,000 |
| LegitScript monitoring | $1,295 |
| Domain renewal | $12 |
| **Annual total** | **~$3,300-$7,800** |

### Runway Implications

At ~$900/mo recurring + $1,651 one-time + $3,300/yr annual = roughly **$15-$20K for the first 12 months** of pre-revenue infrastructure and compliance costs. Fits comfortably in either $250K or $500K angel round scenarios from the Investment Memo.

---

## Status Update Log

Add entries here weekly to track progress:

| Date | Items Completed This Week | Blockers | Next Week's Focus |
|------|---------------------------|----------|-------------------|
| 2026-04-16 | Doc created | None yet | Entity, EIN, BAA emails |
| | | | |
| | | | |
| | | | |

---

## Open Questions to Decide

- [ ] Which entity formation service? (Stripe Atlas vs Clerky vs lawyer)
- [ ] Mercury vs Brex for banking?
- [ ] Framer vs Webflow vs custom Next.js marketing site?
- [ ] Domain name if compoundiq.com is taken — alternatives?
- [ ] Who is the emergency contact / on-call number for PagerDuty?
- [ ] Founder equity split (if co-founder involved)?
- [ ] Advisory pool size (0.5% or 1% total)?
