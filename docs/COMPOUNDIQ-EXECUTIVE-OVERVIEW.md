# CompoundIQ — Executive Overview

**"Expedia for Compounding Pharmacies"**

---

## What Is CompoundIQ?

CompoundIQ is a platform that connects functional medicine clinics with compounding pharmacies. It handles everything from finding the right pharmacy to collecting patient payment to tracking the prescription through delivery — replacing what is currently a manual, phone-and-fax-driven process.

Think of it as the infrastructure layer that sits between the clinic and the pharmacy, making the entire ordering process faster, more transparent, and more profitable for everyone involved.

---

## The Problem We Solve

Functional medicine clinics prescribe compounded medications every day, but the process of actually getting those prescriptions filled is broken:

### Finding the Right Pharmacy Is a Guessing Game

When a patient needs a compounded medication, the medical assistant has to manually research which pharmacies carry the right formulation, are licensed in the patient's state, offer competitive pricing, and can deliver quickly. This happens through phone calls, PDF price lists, and personal relationships. There is no searchable database, no comparison tool, and no way to verify state licensing in real time.

**What CompoundIQ does:** Our sourcing engine lets the medical assistant search all pharmacies instantly, filtered by the patient's state. Only pharmacies with active licenses in that state appear in results — illegal out-of-state dispensing is prevented automatically at the system level, not by human memory.

### Clinics Leave Money on the Table

Most clinics mark up compounded medications (a legal and common practice in functional medicine), but they calculate margins manually. The medical assistant looks up a wholesale cost, picks a retail price, and does the math on paper or in their head. There are no tools to visualize margin in real time, no safeguards against selling below cost, and no transparency into platform fees.

**What CompoundIQ does:** Our margin builder shows the wholesale cost (locked and read-only), lets the clinic set their retail price with one-click multiplier buttons (1.5x, 2x, 2.5x, 3x), and instantly calculates the margin percentage, platform fee, and estimated clinic payout. A database-level constraint prevents selling below cost. The clinic sees exactly what they earn before committing.

### Payment Collection Is Disconnected from the Prescription

Patients typically pay by calling the clinic with a credit card number, paying at the front desk, or being told to pay the pharmacy directly. None of these methods are connected to the prescription. This creates delays, cart abandonment with no follow-up, and compliance risk from non-PCI-compliant payment handling.

**What CompoundIQ does:** After the provider signs the prescription, the system generates a secure payment link and sends it to the patient via text message. The patient taps the link on their phone, sees a clean checkout page branded with their clinic's name, enters their card (or uses Apple Pay / Google Pay), and pays. No login, no app download, no account creation. The payment automatically splits three ways — the clinic gets their payout, the platform captures its fee, and it all happens in a single transaction.

### Fulfillment Is a Black Box

Today, prescriptions are faxed to the pharmacy. Then everyone waits. There is no confirmation the fax was received, no tracking of when compounding starts, no automated alerts when things stall, and no visibility for the patient. If something goes wrong, the clinic finds out when the patient calls to ask where their medication is.

**What CompoundIQ does:** Our system routes prescriptions through the best available channel for each pharmacy. Some pharmacies have modern APIs and get instant digital delivery. Others have web portals that our system fills out automatically. The rest get fax — but even fax is tracked, with automatic retries and escalation if delivery fails. Every step is monitored by our SLA engine, which automatically alerts the operations team when deadlines are missed.

---

## How It Works — The User Experience

### For the Medical Assistant (30 seconds per prescription)

1. **Select patient & provider** — Search for the patient by name. The provider auto-selects if the clinic has only one. Both stay pinned at the top of every screen.
2. **Search** — The patient's shipping state auto-fills. Search for the medication. See all licensed pharmacies with pricing.
3. **Price** — Select a pharmacy, set the markup with one click. See the margin instantly.
4. **Add more or send** — "Add & Search Another" to add more prescriptions for the same patient, or "Review & Send" to batch review everything. For a 3-medication visit, this takes about 45 seconds total.
5. **Or save as draft** — If the provider isn't available, the MA saves the prescription as a draft. The provider logs in later, reviews from the Drafts tab, and signs with one tap.
6. **Sign & send** — The provider signs once — a single signature covers all prescriptions in the session. Payment links fire automatically.
7. **Done** — SMS reminders at 24 and 48 hours if the patient hasn't paid. Auto-cancellation at 72 hours. No follow-up needed.

### For the Patient (60 seconds)

1. **Receive a text** — "Hi Alex, Dr. Chen at Sunrise Functional Medicine has finalized your custom prescription. Tap here to pay."
2. **Tap the link** — Opens in their phone's browser. No app, no login.
3. **See the checkout** — Clinic name and logo. "Prescription Service — $300.00." No medication details shown (privacy).
4. **Pay** — Apple Pay, Google Pay, or card. One tap.
5. **Confirmation** — Animated checkmark, order reference, "Within 3–7 business days" or "Within 24–48 hours" depending on the pharmacy.

### For the Operations Team (Continuous Monitoring)

1. **Pipeline view** — See every order across every clinic in one dark-mode dashboard.
2. **SLA tracking** — Color-coded deadlines. Red means overdue. Automatic Slack alerts and escalation.
3. **Pharmacy health** — Monitor which pharmacy integrations are healthy, degraded, or down.
4. **Fax triage** — When pharmacies respond via fax, the ops team matches responses to orders.
5. **Catalog management** — Upload and manage pharmacy medication catalogs with version tracking.

---

## The Pharmacy Adapter — Our Core Innovation

The compounding pharmacy landscape is fragmented. Some pharmacies have modern technology (APIs), some have web portals, and many still rely entirely on fax. No existing platform connects to all of them.

CompoundIQ's Pharmacy Adapter Layer solves this with a four-tier integration strategy:

**Tier 1 — Direct API Connection**
For pharmacies with modern REST APIs. The prescription is delivered digitally in seconds, and the pharmacy sends real-time status updates back to the platform. This is the fastest and most reliable method.

*Pharmacies: ReviveRX, Vios, MediVera, LifeFile network (Empower, Belmar, UCP, Strive), Precision*

**Tier 2 — Automated Portal Submission**
For pharmacies that have web portals but no API. Our system uses a headless browser to log into the pharmacy's portal, fill out the order form, and submit it — automatically. An AI confidence engine verifies the submission was successful by analyzing a screenshot of the confirmation page.

*Pharmacies: Olympia/DrScript, Wells/WellsPx3*

**Tier 3 — Standardized API Specification**
A published API specification that pharmacies can adopt to integrate with CompoundIQ. Same benefits as Tier 1 but initiated by the pharmacy. This is the long-term growth strategy — once published, it enables rapid partner onboarding.

*Pharmacies: Future partners*

**Tier 4 — Fax Fallback**
The universal fallback. The system generates a compliant prescription PDF and faxes it via HIPAA-compliant fax service. Delivery is tracked, retries are automatic, and pharmacy responses are triaged by the ops team.

*Pharmacies: Any pharmacy not on Tier 1, 2, or 3*

**The key insight:** The system always uses the highest available tier for each pharmacy. If a higher tier fails, it automatically falls down to the next one. Fax is always available as the safety net. The clinic doesn't need to know or care which tier is used — the system handles it transparently.

**The LifeFile advantage:** LifeFile is the de facto B2B standard for compounding pharmacies. A single LifeFile API integration unlocks an entire network of major pharmacies — Empower, Belmar, UCP, and Strive. This is the single highest-leverage integration in the space.

---

## Revenue Model

CompoundIQ earns revenue on every transaction through a transparent platform fee:

```
Patient pays:          $300.00 (retail price set by clinic)
Pharmacy receives:     $150.00 (wholesale cost)
Clinic earns:          $127.50 (their markup minus platform fee)
Platform fee (15%):     $22.50 (15% of the $150 margin spread)
```

- The platform fee is a percentage of the **margin spread** (retail minus wholesale), not the total transaction
- The clinic sees the exact fee before they commit — full transparency
- Stripe processing fees (2.9% + $0.30) come out of the platform's portion, not the clinic's
- No subscription fees, no per-user fees — purely transaction-based

---

## Security & Privacy

CompoundIQ handles protected health information (PHI) and is designed for HIPAA-adjacent compliance:

**Patient privacy is enforced by the system, not by trust:**
- The patient checkout page never shows medication names — only "Prescription Service"
- Stripe (our payment processor) never sees any health information — only an order ID
- Text messages to patients contain only their first name and a payment link — never medication details
- Each clinic can only see their own patients and orders — enforced at the database level, not just the application

**All credentials and sensitive data are encrypted:**
- Pharmacy API keys and portal passwords are stored in an encrypted vault, never in plain text
- All data is encrypted at rest (AES-256) and in transit (TLS 1.2+)
- Patient payment information never touches our servers — it goes directly to Stripe

**Access is strictly controlled:**
- Medical assistants and providers can only access their own clinic's data
- The operations team has cross-clinic visibility but cannot modify clinical records
- Patients can only see their own order through a time-limited, cryptographically signed URL
- Sessions automatically expire after 30 minutes of inactivity

---

## The Competitive Landscape

| Platform | What They Do | What They Don't Do |
|----------|-------------|-------------------|
| **Rupa Health** | Lab test ordering for functional medicine | No pharmacy fulfillment, no compounding |
| **PrescribeWellness** | Retail pharmacy adherence | No compounding, no multi-pharmacy sourcing |
| **Pharmacy Portals** (DrScript, WellsPx3, LifeFile) | Single-pharmacy ordering | No cross-pharmacy comparison, no payment, no unified tracking |
| **E-Fax Services** | Send faxes | No intelligence, no tracking, no escalation, no payment |
| **CompoundIQ** | End-to-end: search, price, pay, route, track, deliver | — |

**No platform today provides:** cross-pharmacy search with state licensing compliance + integrated margin calculation + patient SMS checkout with multi-party payment routing + intelligent prescription routing across 4 submission methods + unified order lifecycle tracking with SLA enforcement.

---

## Current Status

| Milestone | Status |
|-----------|--------|
| Platform built | 15 phases, 81 work orders (76 completed, 5 in backlog) |
| All 3 applications functional | Clinic App, Ops Dashboard, Patient Checkout |
| QA validated | 29 automated test checks pass across all applications |
| Externally tested | Claude Cowork browser QA validated all screens |
| Documentation | 26 specification documents fully updated in software factory |
| POC deployed | Live on Vercel, accessible for demonstration |
| Security audit | All dependency vulnerabilities resolved (0 remaining) |

---

## What's Next

**Near-term:**
- Onboard 2–3 design partner clinics for beta testing
- Activate Twilio SMS for real patient notifications
- Activate Documo fax for real pharmacy submissions
- Complete Stripe Connect onboarding for first clinic

**Medium-term:**
- Integrate LifeFile API (unlocks Empower, Belmar, UCP, Strive)
- Publish Tier 3 API specification for pharmacy self-onboarding
- Launch Tier 2 portal automation for Olympia and Wells

**Long-term:**
- Scale to 50+ pharmacy partners across all 4 tiers
- Expand to additional therapeutic categories beyond functional medicine
- Build analytics and reporting for clinic revenue optimization

---

## Key Talking Points

**For investors:**
> "CompoundIQ is the Expedia for compounding pharmacies — a B2B2C infrastructure layer that captures a 15% fee on every prescription transaction. The 4-tier adapter strategy means we can onboard any pharmacy regardless of their technology, and the LifeFile integration alone unlocks the largest compounding pharmacy network in the country."

**For clinic partners:**
> "Your medical assistant searches, prices, and sends a payment link in under 30 seconds. The patient pays from their phone. You earn margin on every fill with full transparency. And you never touch a fax machine again."

**For pharmacy partners:**
> "You receive structured, error-free orders instead of handwritten faxes. Real-time status updates flow back to the clinic automatically. And our standardized API spec means you can integrate once and receive orders from every clinic on the platform."

**For patients:**
> "You get a text with a payment link. Tap, pay, done. Your prescription is on its way. You'll get updates by text as it progresses."

---

*CompoundIQ — Intelligent sourcing. Automated fulfillment. Transparent pricing.*
