CompoundIQ serves 5 distinct personas across 3 separate applications. Each persona has different access levels enforced at the database layer via Supabase Row-Level Security (RLS), different workflows, and different information visibility. The platform's architecture is designed so that no persona ever sees data they shouldn't — this is enforced at the PostgreSQL level, not just in application code.

---

## **Persona 1: Medical Assistant (MA)**

**Role:** Primary day-to-day operator of the platform. The MA is the person who uses CompoundIQ most frequently and performs the highest volume of actions.

**Application:** Clinic App (App 1)

**Credentials:** MD/DO/NP/PA credential types are NOT required. The MA is a non-prescribing clinical staff member.

**Database Role:** `clinic_user` — scoped to their own `clinic_id` via JWT claim. Can only see patients, providers, and orders belonging to their clinic.

**Primary Workflow:**

1. Select the patient by searching by name, DOB, or phone — the patient's shipping state auto-populates for all subsequent pharmacy searches (WO-80 multi-script patient session entry point)

2. Select the prescribing provider — auto-selects if the clinic has only one provider. Both patient and provider are pinned in a persistent banner at the top of all screens.

3. **Quick Actions Panel (WO-85)**: Above the medication search, see tabbed Favorites and Protocols panels. Click a Provider Favorite for one-click reorder of a saved configuration (loads dose, frequency, sig, pharmacy, refills directly into the margin builder). Click a Clinic Protocol Template (e.g., "Weight Loss Protocol") to add multiple medications to the session at once with phase labels intact.

4. **Cascading Prescription Builder (WO-82, WO-83, WO-84)**: Search by ingredient name. Progressive disclosure dropdowns reveal Salt Form → Formulation (concentration, oil base, dosage form) → Dose & Frequency → Pharmacy & Pricing → Quantity. The system filters pharmacies by patient state at the data layer — illegal out-of-state dispensing is impossible. DEA Schedule II–V medications display a red controlled substance warning banner. FDA Category 2 substances (e.g., BPC-157) display amber alert banners.

5. **Structured Sig Builder (WO-84)**: The sig (prescription directions) auto-generates from dropdown selections — timing (at bedtime, with breakfast, etc.), duration (for 30 days, ongoing, custom), with unit auto-conversion (mg ↔ mL ↔ syringe units for injectables). Toggle three sig modes: Standard (single dose pattern), Titration (start dose → increment → interval → target, e.g., LDN protocols), or Cycling (on/off day patterns, e.g., Thymosin Alpha-1 5-on/2-off). NCPDP 1,000-character limit enforced with live counter. Free-text override available.

6. **Margin Builder**: Set retail price using quick-action multiplier buttons (1.5x, 2x, 2.5x, 3x), review auto-calculated clinic margin and platform fee. Sig is pre-filled from the cascading builder. Optional: click the star button to save the entire configuration as a Provider Favorite for future one-click reorder (WO-85).

7. Choose: "Add & Search Another" to add more prescriptions for the same patient, "Review & Send" to proceed to batch review, or "Save as Draft — Provider Signs Later" to create a DRAFT order so the provider can sign later from the Drafts tab (WO-77 provider signature queue). The session banner shows the running count of prescriptions added.

8. **Batch Review with Drug Interaction Alerts (WO-86)**: All prescriptions are displayed with medication, pharmacy, pricing, and sig. Combined totals show total retail, total platform fee, and total clinic payout. If the session contains medications with known drug interactions, severity-coded alerts (info/warning/critical) display with clinical guidance (e.g., Ketotifen + Ketamine warning about additive sedation). If any prescription is a controlled substance, a red "Controlled Substance — EPCS 2FA Required" banner appears.

9. **Provider signs (with EPCS 2FA if controlled, WO-86)** — a single digital signature (SHA-256 hash) covers all prescriptions in the session. If a controlled substance is in the batch, the provider must complete EPCS two-factor authentication via TOTP authenticator app on a separate device per DEA 21 CFR 1311.

10. Click "Sign & Send All" — confirmation dialog shows total amount, prescription count, patient name, and phone number. On confirm, each prescription is created as a separate order and transitions to AWAITING_PAYMENT. SMS payment links fire via Twilio (one per prescription).

11. Monitor order progress on the Global Dashboard — filterable table or Kanban view showing all clinic orders with status badges, submission method tier icons, and SLA indicators. The Drafts tab shows orders awaiting provider signature (WO-77).

**Key UX Requirements:**

* Sub-30-second per-prescription workflows — a 3-medication visit completes in approximately 45 seconds total. Patient and provider are selected once per session, not per prescription.

* Non-technical user — no exposed database IDs, no raw API responses, no technical jargon in the UI

* Error rows highlighted with Terra/Rust left border for immediate visual identification

* Unpaid orders past 48h flagged in amber with reminder icon

* "Submitting" tab shows orders in SUBMISSION_PENDING state with adapter tier indicator

* Clicking an order row opens a slide-out drawer with: Rx PDF preview, financial split, tracking info, full status timeline, and adapter submission log

* New Prescription button disabled if clinic Stripe Connect status is not ACTIVE

* HIPAA session: 30-minute inactivity auto-logoff with 2-minute warning modal

**Notification Targets:**

* Dashboard notification when pharmacy rejects an order (with "1-click Reroute to Pharmacy B" button)

* Dashboard notification if SMS delivery to patient fails and fallback is exhausted (MA calls patient)

* Push notification after 8 hours if provider hasn't signed a DRAFT order

* Dashboard flag when adapter submission fails and ops reroutes

**RLS Access (what MA can see and do):**

* `clinics`: SELECT/UPDATE own clinic only

* `providers`: SELECT providers in own clinic

* `patients`: SELECT/INSERT/UPDATE patients in own clinic

* `pharmacies`: SELECT all active pharmacies (read-only, includes integration_tier)

* `pharmacy_state_licenses`: SELECT (read-only)

* `catalog`: SELECT WHERE regulatory_status = 'ACTIVE' AND is_active = true (read-only)

* **Hierarchical Catalog (WO-82)**: SELECT on `ingredients`, `salt_forms`, `dosage_forms`, `routes_of_administration`, `formulations`, `formulation_ingredients`, `pharmacy_formulations`, `sig_templates` (all read-only — these power the cascading dropdown builder)

* **Provider Speed Features (WO-85)**: SELECT/INSERT/UPDATE/DELETE on `provider_favorites` (scoped to own clinic's providers); SELECT on `protocol_templates` and `protocol_items` (scoped to own clinic)

* **Drug Interactions (WO-86)**: SELECT on `drug_interactions` (read-only, used for interaction alerts at batch review)

* **Patient Protocol Phases (WO-86)**: SELECT/INSERT/UPDATE on `patient_protocol_phases` and `phase_advancement_history` (scoped to own clinic's patients)

* `orders`: SELECT/INSERT/UPDATE where clinic_id matches

* `order_status_history`: SELECT for own clinic orders

* NO access to: pharmacy_api_configs, pharmacy_portal_configs, adapter_submissions, webhook_events, order_sla_deadlines, inbound_fax_queue, pharmacy_webhook_events, epcs_audit_log (provider's own EPCS events only — service role writes)

**What MA Never Sees:** Pharmacy API credentials, adapter submission internals, webhook event logs, SLA engine deadlines, raw fax data, other clinics' data.

---

## **Persona 2: Prescribing Provider (MD/DO/NP/PA)**

**Role:** Reviews and digitally signs prescriptions prepared by the MA. The provider is the clinical authority — their signature is the legal authorization for the compounded medication order. They use the platform minimally and need a zero-friction approval flow.

**Application:** Clinic App (App 1) — shared with the MA but with a focused, minimal interaction surface

**Credentials:** Must hold valid prescribing credentials (MD, DO, NP, PA). NPI number is stored on the `providers` table and snapshotted onto every order at creation time (`provider_npi_snapshot`).

**Database Role:** `clinic_user` — same role as MA, scoped to own clinic_id

**Primary Workflow:**

1. MA prepares one or more prescriptions in a patient session (cascading dropdown builder, structured sig builder, margin builder for each)

2. Provider receives notification (in-app) that prescriptions require signature. Two paths: same-session signing (provider in clinic) or draft queue signing (provider returns later via the Drafts tab — WO-77 provider signature queue).

3. Provider opens the batch review page — sees all prescriptions for the patient: medication, pharmacy, dosage, retail price for each, with combined totals. Reviews any **drug interaction alerts (WO-86)** displayed with severity-coded clinical guidance. If any prescription is a controlled substance, sees a red **"Controlled Substance — EPCS 2FA Required"** banner.

4. One-tap approval: "Click to Sign" digital signature pad captures signature data — a single signature covers all prescriptions in the session

5. **EPCS 2FA gate (WO-86)**: If any prescription contains a DEA Schedule II–V compound, after signing the system displays a TOTP authentication modal. First time: provider scans a QR code with an authenticator app (Google Authenticator, Authy) on a separate device. Every time: provider enters a 6-digit time-based code. The system verifies via otplib (RFC 6238 compliant) and logs the event to an immutable epcs_audit_log per DEA 21 CFR 1311. TOTP secrets are AES-256-GCM encrypted at rest.

6. Signature is SHA-256 hashed with timestamp — this is the legal record for all prescriptions in the batch. For controlled substances, the EPCS audit trail is the additional legal record required by DEA.

7. **Save as Favorite (optional, WO-85)**: After signing, the provider can save any prescription configuration as a Provider Favorite for future one-click reorder.

8. Done. No further data entry required from the provider.

**Key UX Requirements:**

* One-tap approval flow — provider does NO data entry

* Signature pad must be large enough for mobile/tablet use

* Clear display of what they are signing (patient, medication, pharmacy, price)

* No technical details about adapter tiers, submission methods, or fulfillment logistics — the provider only cares that the prescription is valid and signed

**What Provider Never Sees:** Wholesale pricing (only retail price they set/approved), adapter tier details, SLA timers, ops workflows, other clinics' data, pharmacy API credentials.

**RLS Access:** Same as MA (`clinic_user` role). In practice, the provider interacts with a subset of the screens the MA uses.

---

## **Persona 3: Internal Ops Team**

**Role:** The backstage operations team that monitors the entire order pipeline across ALL clinics, handles exceptions, manages pharmacy integration configurations, triages inbound faxes (Tier 4), reviews adapter health, manages catalog uploads, and handles clinic onboarding. This is the only persona with cross-clinic visibility.

**Application:** Internal Ops Dashboard (App 3)

**Database Role:** `ops_admin` — full read access across all clinics; write access on ops-specific tables. This is the highest-privilege human role in the system.

**Primary Workflows:**

**Workflow A — Fulfillment Triage (Screen 3**.2):

* Real-time queue of orders requiring ops action, sorted by SLA urgency (most urgent first)

* Filters: SUBMISSION_PENDING, SUBMISSION_FAILED, ERROR_ADAPTER_TIMEOUT, ERROR_ADAPTER_AUTH, PENDING_MANUAL_REVIEW, REROUTING, ERROR_FAX_FAILED, ERROR_PHARMACY_REJECTED, FAX_DELIVERED (awaiting ack), READY_TO_SHIP, DISPUTED

* Each row shows: Order #, Clinic, Patient (name only), Medication, Status, Tier icon, SLA countdown, Age

* Quick-action buttons: Retry Submission, Force Tier 4 Fax, View Submission Log, Retry Fax, Reroute Pharmacy, Add Tracking, Cancel + Refund, View PDF

* For PENDING_MANUAL_REVIEW orders: side panel with Tier 2 submission screenshot and adapter response for ops to confirm or deny success

* Bulk operations: multi-select → retry submission, retry fax, add tracking, escalate

* Tracking input: tracking number + carrier dropdown (USPS, FedEx, UPS) → on save, order → SHIPPED → patient SMS auto-fires

* Shift coverage indicator: "Currently on duty: [ops name]" with handoff notes

* Unacknowledged alert timer: if ops alert not clicked within 15 minutes, re-fire and escalate to ops manager

**Workflow B — Catalog Management (Screen 3**.1):

* CSV upload with drag-and-drop and file picker

* API Sync Status panel: which pharmacies have catalog sync enabled, last sync time, price discrepancies

* Price discrepancy alert: when API-synced price differs from catalog price by &gt;10%, flag for ops review (do NOT auto-update)

* Preview mode: show diff of changes before applying

* Rollback capability within 24 hours

**Workflow C — Inbound Fax Triage (Screen 3**.3):

* Applies to Tier 4 (fax) pharmacies only — Tier 1/2/3 status updates arrive automatically via webhooks

* Queue of unprocessed inbound faxes: timestamp, sending number, page count, preview thumbnail

* Ops workflow: open fax PDF → identify pharmacy → match to order → select disposition (Acknowledge, Reject, Query, Unrelated)

* Matched disposition triggers appropriate order state transition

**Workflow D — Adapter Health Monitoring (Screen 3**.4):

* Per-pharmacy health status: healthy (green), degraded (yellow), down (red)

* Submission success rate (24h rolling) by pharmacy, color-coded by tier

* Average submission latency by tier: Tier 1 (\~2s), Tier 2 (\~45s), Tier 4 (\~25min)

* Active submissions in-flight by tier

* Recent failures: last 10 failed submissions with error type, tier, pharmacy, timestamp

* Tier fallback frequency tracking

* Credential expiry warnings (API key/token expirations)

* Playwright automation health: success rate by portal, failure count (24h), screenshot review queue

* Emergency actions: Disable Pharmacy Adapter (per pharmacy kill switch), Force All to Fax (global Tier 4 fallback), Trigger Health Check

**Notification Targets (3-tier escalation cascade):**

* Tier 1: Slack #ops-alerts channel notification

* Tier 2: Slack DM to ops lead (fires after Tier 1 delay window)

* Tier 3: PagerDuty page (fires regardless of acknowledgment)

* Acknowledgment pauses Tier 2 escalation but NOT Tier 3

* Specific alert channels: #ops-alerts (all error states, SLA breaches), #legal-alerts (disputes, compliance holds), email to clinic admin (disputes, Stripe Connect issues)

**RLS Access (what Ops can see and do):**

* `clinics`: SELECT all clinics

* `providers`: SELECT/INSERT/UPDATE all

* `patients`: SELECT all (cross-clinic)

* `pharmacies`: Full CRUD

* `pharmacy_state_licenses`: Full CRUD

* `catalog`: Full CRUD

* `catalog_history`: SELECT/INSERT (append-only)

* `orders`: Full access (all clinics)

* `order_status_history`: Full access (append-only)

* `webhook_events`: SELECT

* `order_sla_deadlines`: SELECT/UPDATE

* `inbound_fax_queue`: Full CRUD

* `pharmacy_api_configs`: Full CRUD

* `pharmacy_portal_configs`: Full CRUD

* `adapter_submissions`: Full access

* `pharmacy_webhook_events`: Full access

---

## **Persona 4: Patient**

**Role:** The end consumer who receives and pays for the compounded medication. The patient has the most constrained interaction with the platform — guest checkout only via a tokenized JWT URL sent by SMS. There is no patient portal, no patient app, no login, and no account creation. This is a deliberate design decision (HC-08 hard constraint) to minimize friction and maximize conversion.

**Application:** Patient Payment Portal (App 2) — mobile-web optimized, not a native app

**Database Role:** `anon` (unauthenticated) for the checkout flow. The patient never authenticates via Supabase Auth. The JWT token in the checkout URL is a separate, server-generated token (not a Supabase session token) containing: order_id, patient_id, exp (72h), iat.

**Primary Workflow:**

1. Receive SMS: "Hi [First Name], Dr. [Provider Last Name] at [Clinic Name] has finalized your custom prescription. Tap here to securely complete your order: [Link]"

2. Tap link — opens in mobile browser, no app download required. Short URL format (e.g., rxpay.io/[short_code]) to avoid SMS truncation.

3. See trust-optimized checkout page: clinic logo + clinic name (white-labeled), line item shows "Custom Prescription — [Clinic Name]" — NEVER the medication name (HIPAA compliance)

4. Apple Pay / Google Pay buttons above card form for faster conversion

5. Enter card details (or use Apple Pay/Google Pay), required email for receipts

6. Complete payment → see success page with animated CSS-only checkmark, order reference (# followed by first 8 characters of order UUID, e.g. #a1b2c3d4, rendered in monospace font)

7. For Tier 1/3 pharmacies with real-time status: "Within 24–48 hours. You'll receive tracking info via text when it ships."

8. For Tier 4 pharmacies: "You will receive an SMS with tracking when it ships (typically 3-7 business days)."

9. Receive SMS updates: payment confirmation, shipping notification with tracking link, delivery confirmation

10. Link expires after 72 hours — if not paid, auto-cancel with PAYMENT_EXPIRED cancellation reason

**Key UX Requirements:**

* Zero friction: no account creation, no login, no app download

* Mobile-first: checkout must be optimized for mobile browsers

* Trust signals: clinic branding (logo + name), not CompoundIQ branding — patients see their clinic, not our platform

* HIPAA compliance: NO medication names, dosages, or clinical information on the checkout page or in Stripe metadata

* Conversion-optimized: Apple Pay/Google Pay for one-tap payment, minimal form fields

* Payment link expires in 72 hours (server-side enforcement)

* Automatic SMS reminders at 24h and 48h if unpaid

**What Patient Never Sees:**

* Wholesale cost (the price the clinic pays the pharmacy)

* Pharmacy name (which pharmacy is fulfilling the order)

* Platform fee (CompoundIQ's revenue share)

* Clinic margin (the markup the clinic earns)

* Adapter tier or submission method details

* Any other clinic's data or any ops dashboard information

* Any medication name or clinical details on checkout page or Stripe receipts

**RLS Access (extremely restricted):**

* `patients`: SELECT own record only (patient_id = auth.uid())

* `orders`: SELECT own orders EXCLUDING wholesale_price_snapshot, platform_fee_amount, pharmacy_snapshot (these columns are explicitly hidden from patient role)

* NO access to: clinics, providers, pharmacies, catalog, webhook_events, order_sla_deadlines, inbound_fax_queue, pharmacy_api_configs, pharmacy_portal_configs, adapter_submissions, pharmacy_webhook_events, catalog_history, order_status_history

**SMS Communication (Twilio):**

* Content constraint: Patient first name + checkout URL only. Never include medication names, dosages, DOB, last name in SMS.

* Opt-out support: STOP/UNSUBSCRIBE keywords set `patients.sms_opt_in = false`. START re-enables.

* If SMS delivery fails: retry once after 5 min. If 2nd failure: attempt email if available. If no email: flag for ops/MA manual follow-up.

**Shipping Address Validation:**

* Patient checkout flow collects shipping address (street, city, state, ZIP)

* System compares patient-entered shipping state with MA-entered shipping_state on patients table

* If mismatch: show warning to patient ("Your shipping state differs from what was entered. Please confirm.")

* This prevents compliance violations from state mismatch

---

## **Persona 5: Clinic Admin**

**Role:** The business/administrative owner of the clinic account. Manages Stripe Connect onboarding (Express accounts), views revenue and order history for their clinic, and handles financial/administrative settings. This persona may also be the Prescribing Provider in small practices.

**Application:** Clinic App (App 1) — same application as MA and Provider, with admin-specific views

**Database Role:** `clinic_user` — same role as MA and Provider, scoped to own clinic_id. No cross-clinic data access.

**Primary Workflows:**

**Workflow A — Stripe Connect Onboard**ing:

* Receives onboarding link from CompoundIQ ops team

* Completes Stripe Express account setup (bank info, identity verification, business details)

* Platform monitors `account.updated` webhook for onboarding completion

* If `charges_enabled = true` and requirements empty → status = ACTIVE → order creation unlocked

* If RESTRICTED (Stripe requires additional info): new order creation blocked, existing orders continue, clinic admin alerted

* If DEACTIVATED: all operations blocked, immediate notification

**Workflow B — Revenue & Order Hist**ory:

* Views order history for their clinic (filtered by date range, status, provider)

* Sees financial data: retail prices, clinic margins, platform fees, payout status

* Does NOT see wholesale pricing or pharmacy-level costs (those are MA/Provider visibility)

* Revenue dashboard showing aggregate metrics

**Workflow C — Clinic Setti**ngs:

* Clinic logo upload (displayed on patient checkout page for white-labeling)

* Default markup percentage configuration (`clinic.default_markup_pct`)

* Provider management (view providers associated with clinic)

**Notification Targets:**

* Email notification when Stripe Connect status changes (RESTRICTED, DEACTIVATED)

* Email notification when patient files a dispute (charge.dispute.created)

* Notification when clinic payout fails (transfer.failed)

**RLS Access:** Same as MA (`clinic_user` role) — scoped to own clinic_id.

---

## **Persona-to-Application Mapping Summary**

| **Persona** | **Application** | **DB Role** | **Primary Screens** | **Cross-Clinic Access** |
| --- | --- | --- | --- | --- |
| Medical Assistant | Clinic App (App 1) | clinic_user | 1.1 Patient & Provider Selection, 1.2 Quick Actions Panel (Favorites/Protocols), 1.3 Cascading Prescription Builder, 1.4 Margin Builder, 1.5 Batch Review, 1.6 Order Dashboard with Drafts tab | No |
| Prescribing Provider | Clinic App (App 1) | clinic_user | 1.5 Batch Review (signature flow with drug interaction alerts and EPCS 2FA), 1.6 Drafts tab | No |
| Internal Ops Team | Ops Dashboard (App 3) | ops_admin | 3.1 Catalog Importer, 3.2 Fulfillment Triage, 3.3 Fax Triage, 3.4 Adapter Health | Yes — all clinics |
| Patient | Payment Portal (App 2) | anon (JWT token) | 2.1 SMS Link, 2.2 Checkout, 2.3 Success Page | No — own order only |
| Clinic Admin | Clinic App (App 1) | clinic_user | Admin views + Dashboard | No |

## **Persona-to-Feature Node Mapping**

| **Feature Node** | **Primary Persona(s)** | **Secondary Persona(s)** |
| --- | --- | --- |
| A: State-Compliance Search Engine | Medical Assistant | — |
| B: Dynamic Margin Builder | Medical Assistant | Prescribing Provider (reviews price) |
| C: B2B2C SMS Checkout | Patient | Medical Assistant (triggers) |
| D: Multi-Party Payment Routing | Patient (pays) | Clinic Admin (receives payout) |
| E: Intelligent Order Routing | System (automated) | Internal Ops (exception handling) |
| F: Pharmacy Adapter Layer | System (automated) | Internal Ops (monitoring, configuration) |
| G: Multi-Script Patient Session + Provider Signature Queue (WO-77, WO-80) | Medical Assistant | Prescribing Provider (signs drafts) |
| H: Cascading Prescription Builder + Structured Sig Builder (WO-82, WO-83, WO-84) | Medical Assistant | Prescribing Provider (titration/cycling protocols) |
| I: Provider Favorites + Clinic Protocol Templates (WO-85) | Medical Assistant, Prescribing Provider | Clinic Admin (template management) |
| J: EPCS 2FA + Drug Interaction Alerts + Phase Management (WO-86) | Prescribing Provider (signs controlled substances with TOTP) | Medical Assistant (sees interaction alerts), Internal Ops (audit log review) |

---

**Source Documents:** Master Initialization Artifact V2.2 (Section 2.2 Target Personas, Section 2.3 Feature Nodes), PRD Part 2 V2.2 (Section 6 UI/UX Blueprint — all 3 apps and 12+ screens), Database Schema Spec V2.2 (RLS policies across all 33 tables — expanded by WO-82, WO-85, WO-86), SLA Engine Spec V2.0 (escalation targets), Webhook Architecture V2.2 (notification flows), API Contract Spec V2.2 (endpoint auth requirements), Environment & Security Spec V2.2 (Supabase roles, patient checkout token, EPCS TOTP authentication per DEA 21 CFR 1311).

\