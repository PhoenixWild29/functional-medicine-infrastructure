**CompoundIQ — "Expedia for Compounding Pharmacies" + "Stripe B2B2C Checkou**t"

CompoundIQ is a B2B2C functional medicine infrastructure platform that connects independent prescribing clinics with compounding pharmacies through intelligent sourcing, automated fulfillment, and transparent pricing. The platform replaces the entirely manual, fax-dependent workflow that clinics use today with an AI-native system that handles the full order lifecycle: search, price, pay, route, track, and deliver.

The platform consists of three distinct web applications sharing a common component library, a 4-tier Pharmacy Adapter Layer for universal pharmacy connectivity, and a backend powered by Supabase (PostgreSQL + RLS + Vault + Edge Functions) with Stripe Connect for multi-party payments, Twilio for SMS notifications, and Documo for HIPAA-compliant fax.

**Application 1: Clinic App (Provider and Medical Assistant)**

The Clinic App is the primary front-stage application used by Medical Assistants (MAs) and Prescribing Providers. It contains six core screens:

Screen 1.1 — Patient & Provider Selection (WO-80): The MA opens the New Prescription flow and selects the patient first (name, DOB, or phone search). The patient's shipping state auto-populates for all subsequent pharmacy searches. The provider auto-selects if the clinic has only one prescriber, otherwise the MA picks from a dropdown. Both selections are pinned to a persistent session banner at the top of all subsequent screens, eliminating re-selection across multiple prescriptions. This is the entry point to the multi-script patient session.

Screen 1.2 — Quick Actions Panel — Favorites & Protocols (WO-85): Above the medication search, the MA sees a tabbed panel with "Favorites" and "Protocols" tabs. Provider Favorites are saved prescription configurations (medication, dose, frequency, sig, pharmacy, refills) that load with one click directly into the margin builder. Clinic Protocol Templates are multi-medication bundles (e.g., "Weight Loss Protocol" = Semaglutide + BPC-157 + Lipo-Mino) that add all their medications to the current session in one click. Favorites display use_count and titration/cycling badges. Protocols expand to show phase labels, sig text per medication, and a "Load N Medications into Session" button.

Screen 1.3 — Cascading Prescription Builder (WO-82, WO-83, WO-84): A progressive disclosure dropdown system that replaces card-based pharmacy search. The MA searches by ingredient name, then the system reveals options progressively: Salt Form (e.g., Testosterone Cypionate vs Enanthate) → Formulation (concentration, oil base, dosage form) → Dose & Frequency → Pharmacy & Pricing → Quantity. The Structured Sig Builder auto-generates prescription directions with timing (at bedtime, with breakfast, etc.), duration (for 30 days, ongoing, custom), and unit auto-conversion (mg ↔ mL ↔ syringe units for injectables). Three sig modes are available: Standard (single dose pattern), Titration (start dose → increment → interval → target, e.g., LDN protocols), and Cycling (on/off day patterns, e.g., Thymosin Alpha-1 5-on/2-off). The system enforces the NCPDP 1,000-character sig limit. DEA Schedule II–V medications display a controlled substance warning banner at search time. FDA Category 2 substances (e.g., BPC-157) display amber alert banners. Pharmacies are filtered by patient state at the data layer — illegal out-of-state dispensing is prevented automatically.

Screen 1.4 — Margin Builder (WO-28, WO-77, WO-80): The MA sees the locked wholesale price (from a pharmacy_formulations snapshot) and sets the retail price the patient will pay. The Sig field is pre-filled from the cascading builder. The system displays real-time margin calculation: margin percentage, platform fee amount, and estimated clinic payout. Quick-action multiplier buttons (1.5x, 2x, 2.5x, 3x) reduce cognitive load. A database-level constraint prevents retail_price from being set below wholesale_price. A soft warning fires at markups exceeding 5x wholesale, and a minimum margin floor warning appears below $10 clinic payout. The MA has three options: "Add & Search Another" (add this prescription to the session and configure another), "Review & Send" (proceed to batch review with all session prescriptions), or "Save as Draft — Provider Signs Later" (creates a DRAFT order so the provider can sign later from the dashboard Drafts tab — WO-77 provider signature queue).

Screen 1.5 — Batch Review with Drug Interaction Alerts and EPCS 2FA (WO-80, WO-86): The batch review page shows all prescriptions accumulated in the session with combined totals (total retail, platform fee, clinic payout). If any prescription contains a controlled substance, a red banner displays "Controlled Substance — EPCS 2FA Required." If the session contains medications with known drug interactions, severity-coded alerts (info/warning/critical) display with clinical guidance. The provider signs once — a single SHA-256 hash signature covers all prescriptions in the session. If any prescription contains a DEA Schedule II–V compound, the system requires EPCS two-factor authentication at the point of signing per DEA 21 CFR 1311. The provider scans a QR code with an authenticator app on a separate device (TOTP via otplib, RFC 6238 compliant), enters a 6-digit code, and the system logs the event to an immutable epcs_audit_log. TOTP secrets are stored AES-256-GCM encrypted at rest. After successful 2FA (or for non-controlled prescriptions, immediately after signing), each prescription is created as a separate order, transitions to AWAITING_PAYMENT, and an SMS payment link fires via Twilio.

Screen 1.6 — Order Dashboard (with Drafts Tab): The MA and provider see all orders for their clinic with status indicators, SLA countdowns, and the ability to view order details. The Drafts tab displays orders saved by the MA awaiting provider signature (WO-77 provider signature queue) — providers can review and sign drafts in a separate session from when the MA created them. Clinics see only their own data — Row-Level Security (RLS) enforced at the database layer ensures zero cross-clinic data access. The Clinic Admin persona additionally manages Stripe Connect onboarding and views revenue/order history for their clinic.

**Application 2: Patient Payment Portal (Mobile-Web)**

The Patient Payment Portal is a mobile-optimized guest checkout experience. There is no patient account, no login, no app download, and no patient portal. The patient receives an SMS with a tokenized URL, taps it, and lands on a checkout page.

Screen 2.1 — Cart Review: The patient sees the medication name, dosage, form, quantity, and total retail price. Wholesale cost and pharmacy name are strictly hidden from the patient.

Screen 2.2 — Stripe Checkout: Payment is processed via Stripe Elements (PCI-compliant). A single Stripe PaymentIntent handles the entire multi-party split: retail_price flows to the clinic's connected Stripe Express account via transfer_data, and the platform_fee is captured via application_fee_amount. Zero PHI (no medication names, patient names, diagnoses, or NPI numbers) appears in any Stripe metadata, descriptions, or line items — the permitted Stripe description is "Custom Prescription — [Clinic Name]" or "Healthcare Services."

Screen 2.3 — Confirmation: Payment confirmation with order reference (format: # followed by first 8 characters of the order UUID, e.g. #a1b2c3d4). Animated checkmark with CSS-only draw animation. Tier-aware next-steps messaging: Tier 1/3 pharmacies with real-time status show "Within 24–48 hours, you'll receive tracking info via text." Tier 4 (fax) pharmacies show average turnaround days from the pharmacy record, falling back to "3–7 business days." No medication details shown on confirmation (HIPAA compliance).

After payment, the system auto-generates a compliant prescription PDF from the frozen order snapshots and routes it through the Pharmacy Adapter Layer — all without any human intervention.

**Application 3: Internal Ops Dashboard (Back-Stage Console)**

The Ops Dashboard is the operational nerve center. It is used by the internal ops team to monitor the order pipeline, manage exceptions, and handle pharmacy integrations.

Screen 3.1 — Catalog Importer: Supports CSV upload (drag-and-drop), API sync status monitoring, and manual entry. CSV format validation enforces required columns (pharmacy_id, medication_name, form, dose, wholesale_price, turnaround_time_days, regulatory_status). Preview mode shows diff of changes before applying. Price discrepancy alerts fire when API-synced prices differ from catalog prices by more than 10% (flagged for review, never auto-updated). All changes logged to catalog_history with change source tracking. Rollback capability within 24 hours.

Screen 3.2 — Fulfillment Triage Queue: Real-time queue of orders requiring ops action, sorted by SLA urgency. Each row shows: order number, clinic, patient name, medication, status, tier icon (API/Portal/Fax), SLA countdown timer, and order age. Quick-action buttons include: Retry Submission (re-trigger adapter), Force Tier 4 Fax (manual fallback), View Submission Log (shows adapter_submissions history), Retry Fax, Reroute Pharmacy, Add Tracking, Cancel + Refund, View PDF. For orders in PENDING_MANUAL_REVIEW status (from Tier 2 portal automation), a side panel displays the Playwright submission screenshot and adapter response details for ops confirmation. Slack push notifications fire for all error states and SLA breaches. Unacknowledged alert timer: if ops doesn't respond in 15 minutes, the alert re-fires and escalates to the ops manager. Bulk operations supported for multi-select actions.

Screen 3.3 — Inbound Fax Triage: Queue of unprocessed inbound faxes from Tier 4 pharmacies. Each row shows fax timestamp, sending number, page count, and preview thumbnail. Ops workflow: open fax PDF, identify pharmacy, match to order, select disposition (Acknowledge, Reject, Query, Unrelated). Matched dispositions trigger order state transitions. This screen applies primarily to Tier 4 pharmacies — Tier 1/3 pharmacies send status updates via webhooks automatically.

Screen 3.4 — Adapter Health Dashboard (New in V2.0): Real-time monitoring of the Pharmacy Adapter Layer. Per-pharmacy health status (healthy/degraded/down). Submission success rate (24h rolling) by pharmacy, color-coded by tier. Average submission latency by tier (Tier 1: \~2s, Tier 2: \~45s, Tier 4: \~25min). Active submissions in-flight. Recent failures with error type, tier, pharmacy, and timestamp. Tier fallback frequency tracking. Credential expiry warnings. Playwright automation health metrics. Emergency quick actions: Disable Pharmacy Adapter (kill switch per pharmacy), Force All to Fax (global Tier 4 fallback), Trigger Health Check.

**The Pharmacy Adapter Layer — Core Architectural Innovati**on

The Pharmacy Adapter Layer is the platform's primary technical differentiator. It is a unified integration engine built on the strategy pattern (PharmacyAdapterFactory) that abstracts pharmacy connectivity behind a single internal interface, enabling seamless order routing regardless of each pharmacy's technical capability.

Four integration tiers:

Tier 1 — Direct REST/Webhook API: For pharmacies with native APIs (ReviveRX, Vios Compounding, MediVera, LifeFile network including Empower, Belmar, UCP, and Strive, and Precision Compounding). Order submission via POST to pharmacy REST API. Real-time status updates via webhook callbacks with per-pharmacy HMAC-SHA256 signature verification. Latency: less than 2 seconds. Coverage: approximately 25% of target pharmacies. Key insight: LifeFile is the de facto B2B standard for compounding pharmacies — a single LifeFile API integration unlocks the largest pharmacy network in the country (Empower, Belmar, UCP, Strive).

Tier 2 — Portal Automation via Playwright: For pharmacies with web portals but no API (Olympia Pharmacy/DrScript, Wells Pharmacy/WellsPx3). Headless Chromium browser automation handles login, form fill, order submission, and confirmation capture. An AI confidence engine analyzes submission screenshots (threshold: confidence &gt;= 0.85) to determine success. Polling every 15 minutes for status updates. Screenshots are captured for every submission attempt, stored in encrypted object storage, auto-deleted after 90 days, and treated as protected artifacts (may contain PHI). Latency: less than 30 seconds. Coverage: approximately 20% of target pharmacies.

Tier 3 — Standardized API Specification: A published API spec that pharmacies can adopt to integrate with the platform. Same bidirectional flow as Tier 1. This is the long-term platform play — once published, it enables rapid partner onboarding without custom integration work per pharmacy. Coverage: future 30%+ of partners.

Tier 4 — Fax Fallback via Documo mFax: Universal fallback for any pharmacy without Tier 1/2/3 capability. System generates a compliant PDF prescription, submits via Documo's HIPAA-compliant fax API, tracks delivery confirmation, and manages inbound fax triage for pharmacy responses. Auto-retry 3 times over 30 minutes on failure. Latency: minutes to hours. Coverage: approximately 25%+ of target pharmacies.

Routing logic is deterministic: the system always selects the highest available tier for a pharmacy at order submission time. If a higher tier fails, the adapter cascades downward automatically (Tier 1 fails → try Tier 2 if available → try Tier 4 fax). Circuit breaker pattern: 3 consecutive failures per pharmacy triggers a 5-minute cooldown, 1 half-open probe, 2 successes required to close the circuit. Every submission attempt (any tier) creates an adapter_submissions record with full audit trail: pharmacy_id, order_id, tier_used, submission_method, request_payload_hash, response_status, latency_ms, created_at. No submission bypasses the audit trail.

**Order Lifecycle — 23 Stat**es

Every order flows through a closed state machine with exactly 23 states: DRAFT, AWAITING_PAYMENT, PAYMENT_EXPIRED, PAID_PROCESSING, SUBMISSION_PENDING, SUBMISSION_FAILED, FAX_QUEUED, FAX_DELIVERED, FAX_FAILED, PHARMACY_ACKNOWLEDGED, PHARMACY_COMPOUNDING, PHARMACY_PROCESSING, PHARMACY_REJECTED, REROUTE_PENDING, READY_TO_SHIP, SHIPPED, DELIVERED, CANCELLED, ERROR_PAYMENT_FAILED, ERROR_COMPLIANCE_HOLD, REFUND_PENDING, REFUNDED, DISPUTED. All state transitions use an atomic Compare-and-Swap (CAS) pattern to prevent race conditions. No state can be invented, and no transition can be added outside the defined valid transition set.

**SLA Engine — 10 Enforcement Typ**es

The platform enforces 10 SLA types with automatic escalation: PAYMENT_EXPIRY (72h), SMS_REMINDER_24H (24h), SMS_REMINDER_48H (48h), FAX_DELIVERY (30min, Tier 4 only), ADAPTER_SUBMISSION_ACK (5min for Tier 1/3, 10min for Tier 2, 30min for Tier 4), PHARMACY_ACK (4 business hours), PHARMACY_COMPOUNDING_ACK (48h), SHIPPING (48h), TRACKING_UPDATE (24 hours after order shipped — alert ops if no tracking update). A cron job runs every 5 minutes checking all unresolved SLA deadlines. Escalation tiers: Tier 0 (adapter automated — auto-retry, auto-fallback, fires before any human notification), Tier 1 (automated SMS/retry), Tier 2 (ops Slack alert, 15-min ack timer), Tier 3 (manager escalation), Tier 4 (clinic notification if unresolved in 2 hours).

**Payment Architecture — Stripe Connect Expre**ss

Single PaymentIntent per order. Stripe Connect Express accounts for each clinic. Automatic three-way split: patient pays retail_price, clinic receives clinic_payout_amount via transfer_data.destination, platform captures platform_fee via application_fee_amount. Stripe processing fees (2.9% + $0.30) deducted from the platform's portion. Dispute handling workflow auto-assembles evidence (order metadata, payment confirmation, submission proof, shipping tracking, signed Rx with signature_hash verification) for 7-day submission window.

**Security and Compliance**

HIPAA-adjacent architecture: Row-Level Security (RLS) enforced on all 33 database tables across 4 roles (admin, provider, patient, pharmacy). 30-minute idle session timeout with re-authentication. Soft deletes everywhere (deleted_at timestamps, no physical DELETE operations on PHI). All pharmacy credentials (API keys, portal logins, webhook secrets) stored encrypted in Supabase Vault — never in environment variables, never logged in plaintext, rotated every 90 days minimum. Per-pharmacy HMAC-SHA256 webhook signature verification. Provider signatures use SHA-256 hash of canvas data.

EPCS Two-Factor Authentication (WO-86): For DEA Schedule II–V controlled substances, the platform implements DEA 21 CFR 1311 compliant two-factor authentication at the point of signing. Providers enroll a TOTP authenticator app (Google Authenticator, Authy, or similar) on a separate device — TOTP secrets are AES-256-GCM encrypted at rest using a key derived from the service role secret. At signing, the provider scans a QR code (first time) or enters a 6-digit time-based code, and the system verifies via otplib (RFC 6238). All EPCS events are logged to an immutable epcs_audit_log table with 2-year retention, capturing event type, IP address, user agent, dea_schedule, and medication name. Controlled substances are still routed through Tier 4 (manual fax) only — automated tier routing of controlled substances remains out of scope.

Drug Interaction Alerts (WO-86): Known drug interaction pairs are stored in a drug_interactions table with severity classification (info, warning, critical), description, and clinical guidance. At the batch review page, the system checks all medications in the session against this database and displays severity-coded alerts with clinical notes (e.g., Ketotifen + Ketamine warning about additive sedation, Semaglutide + Tirzepatide critical alert about additive GLP-1 effects).

**What Is Explicitly Out of Scope for MVP**

The following are NOT part of the MVP build: EMR/EHR integrations (HL7, FHIR, Epic, Cerner), DocuSign or SaaS e-signature, patient portals or native mobile apps, automated tier routing of DEA-controlled substances (controlled substances are supported via EPCS 2FA + Tier 4 manual fax routing only — see WO-86), lab diagnostics or ICD-10 codes, insurance billing or PBM integrations, multi-language support, full pharmacy management system replacement (the platform integrates WITH pharmacy systems, not replaces them).

**Technology Stack**

Frontend: Next.js 14+ (App Router, React 18+, Server and Client Components). Backend/Database: Supabase (PostgreSQL 15+ with RLS, Edge Functions, Realtime subscriptions, Vault). Payments: Stripe Connect Express. Fax: Documo mFax REST API (HIPAA-compliant, Tier 4 only). SMS: Twilio Programmable Messaging. Portal Automation: Playwright (headless Chromium, Tier 2). Credential Encryption: Supabase Vault. Cron: Vercel Crons (vercel.json), 9 scheduled jobs ranging from 5-minute to daily intervals. All cron endpoints protected by CRON_SECRET bearer token. CI/CD: Vercel + GitHub Actions.

Database: 33 tables (17 original + 8 hierarchical catalog tables from WO-82 + 3 provider speed feature tables from WO-85 + 5 regulatory compliance tables from WO-86), 1 view (provider_prescribing_history), 10 enum types, 23 order states, 16 hard constraints, 40+ environment variables across 8 categories, 4 RLS roles, 19 phases, 86 work orders completed. The platform has been fully built through Phase 19 (WO-1 through WO-86) covering foundation, order flow, pharmacy adapter layer, SLA engine, ops dashboard, patient portal, UI/UX redesign, multi-script patient sessions (WO-80), provider signature queue (WO-77), cascading prescription builder with structured sig builder and titration/cycling protocols (WO-82, WO-83, WO-84), provider favorites and clinic protocol templates (WO-85), and EPCS 2FA + drug interaction alerts + phase-gated protocol management (WO-86). Additional libraries: otplib (TOTP RFC 6238 for EPCS), qrcode (TOTP enrollment QR codes).

---

**Source documents referenced:**

* Master Initialization Artifact V2.2 — Sections 1-5 (Metadata, Product Definition, Business Rules, Acceptance Criteria, Tech Stack)

* PRD Part 2 V2.2 — Sections 1-10 (Executive Summary, Data Model, State Machine, Webhooks, Stripe, UI/UX Blueprint, Edge Cases, HIPAA, SLA Engine, Implementation Priority)

* Pharmacy Adapter Architecture — Sections 1-4 (Vision, Market Intelligence, 4-Tier Architecture, Unified Interface)

* Order State Machine V2.2 — Full 23-state enum and valid transitions

* Database Schema Spec V2.2 — 33 tables, 10 enums (expanded in WO-82, WO-85, WO-86)

* SLA Engine Spec V2.2 — 10 SLA types, escalation tiers

* Webhook Architecture V2.2 — 4 source categories, idempotency, HMAC verification

* Env/Security Spec V2.2 — 40+ environment variables, RLS policies, HIPAA rules