# CompoundIQ — Architecture Overview

For the full system architecture diagram and infrastructure stack, see [docs/system-architecture.md](docs/system-architecture.md).

## Three-Application Architecture

The codebase serves three distinct audiences through a single Next.js application using route groups:

| Route Group | Audience | Auth |
|-------------|----------|------|
| `(clinic-app)` | Medical assistants, providers, clinic admins | Supabase Auth (clinic_id + app_role JWT claims) |
| `(ops-dashboard)` | CompoundIQ ops team | Supabase Auth (ops_admin role) |
| `pharmacy/` | Pharmacy admins (onboarding portal) | Supabase Auth (pharmacy_admin role, pharmacy_id claim) |
| `(patient-checkout)` | Patients | Stateless — 72-hour checkout JWT token |
| `intake/`, `join/` | Patients (intake form, clinic sign-up link) | Stateless — a token checked against its stored hash |
| `get-started`, `onboard/` | New clinics, providers, pharmacies (self sign-up, invite acceptance) | None until the account exists |

The request gate is `src/middleware.ts`: session refresh, roles, MFA, the checkout token, public routes and security headers. Next.js 16 renames middleware to `proxy.ts`. That rename is pending in #266; until it merges, middleware.ts is current.

## Authentication Flows

### Clinic and Ops Users (Supabase Auth)

```
/login (public)
  → supabase.auth.signInWithPassword()
  → session cookie set (PKCE)
  → full page navigation (not a client-router push; Next 16.3+ reuses a
    redirect it already saw) to the role's landing page
    (src/lib/auth/landing-route.ts):
      ops_admin          → /ops/pipeline
      clinic_admin       → /practice
      pharmacy_admin     → /pharmacy/onboarding
      provider, medical_assistant → /dashboard
      no role / unknown  → /unauthorized

/auth/callback (public)
  → exchanges Supabase PKCE code for session
  → redirects to / (root handles role routing)
  → on failure → /login?error=auth_callback_failed

/ (root, server component)
  → no session → /login
  → otherwise the role's landing page (as above)
```

Role claims are stored in `app_metadata.app_role`, `app_metadata.clinic_id` and `app_metadata.pharmacy_id`. They are written only with the service role and read through `src/lib/auth/claims.ts`. Never read them from `user_metadata`, which any signed-in user can rewrite. Identity is always `getUser()`, never `getSession()`. The middleware (`src/middleware.ts`) enforces role checks on every request. Layouts provide a second layer of defense. A deactivated team member is banned in Auth and carries `app_metadata.deactivated_at`, so the middleware signs them out.

### Patients (Stateless Checkout Token)

```
AWAITING_PAYMENT transition
  → generateCheckoutToken() → 72h JWT (order_id, clinic_id)
  → SMS link: https://app.compoundiq.com/checkout/<token>

/checkout/<token> (Edge Middleware)
  → verifyCheckoutToken()
  → invalid/expired → /checkout/expired
  → valid → forwards x-checkout-order-id header to Server Components
```

No login required. Patients are never issued a Supabase session.

### Public Routes (No Auth Required)

| Route | Why Public |
|-------|-----------|
| `/login` | Entry point — no session yet |
| `/unauthorized` | Needs to render without valid session |
| `/auth/callback` | Cold visit from email verification link |
| `/api/webhooks/*` | External services (Stripe, Twilio, Documo) have no session |
| `/api/cron/*` | Vercel cron triggers use `CRON_SECRET` bearer token, not session cookies |
| `/api/health` | CI/CD health check — no session in deploy pipeline |
| `/api/checkout/*` | Patient checkout (token in the request) |
| `/intake/*`, `/api/intake/*` | Patient intake link (token checked against its hash) |
| `/join/*`, `/api/join/*` | A clinic's patient sign-up link and its QR code (token checked against its hash; rate limited) |
| `/get-started`, `/api/signup` | Self sign-up for clinics, solo providers and pharmacies (rate limited) |
| `/onboard/*`, `/api/onboard/*`, `/api/onboarding/invite/*` | Accepting a clinic or pharmacy invite |
| `/legal/*` | BAA and terms text |
| `/api/integrations/keragon/patients` | Keragon EHR patient webhook (HMAC signature with the clinic's shared secret) |
| `/plan/*`, `/api/plan/*` | The patient's treatment-plan choice link (token checked against its hash; date of birth before any PHI; rate limited) |

## Database Schema (77 tables, 10 enums)

Counted from `supabase/migrations/` through 20261024000002. Full ERD: [docs/technical/erd.md](docs/technical/erd.md). The ERD predates the October tables below.

**V1.0 (12 tables):** clinics, providers, patients, pharmacies, pharmacy_state_licenses, catalog, catalog_history, orders, order_status_history, webhook_events, order_sla_deadlines, inbound_fax_queue

**V2.0 (5 tables):** pharmacy_api_configs, pharmacy_portal_configs, adapter_submissions, normalized_catalog, pharmacy_webhook_events

**Additional (4):** sms_log, sms_templates, transfer_failures, disputes

**Incremental (5):** clinic_notifications, ops_alert_queue, circuit_breaker_state, sla_notifications_log, catalog_upload_history

**V3 hierarchical catalog (8 tables):** ingredients, salt_forms, formulations, formulation_ingredients, pharmacy_formulations, + 3 supporting tables. This hierarchy (`ingredients → salt_forms → formulations → formulation_ingredients → pharmacy_formulations`) runs **alongside** the legacy flat `catalog` table; a 166-product importer (`scripts/import-catalog-v3.ts`, `npm run seed:catalog`) seeds it.

**Phase C multi-Rx (2 tables):** payment_groups, dispute_orders

**Adapter debug (1 table):** adapter_submission_debug_payloads

**Later Phase B/C (7 tables):** additional operational + audit tables added by migrations through 20260614000004 — see the ERD for the full list.

**October 2026 (onboarding, team, intake, payments, compliance):**
- Clinic onboarding and agreements: `onboarding_invites`, `clinic_onboarding_steps`, `clinic_onboarding_events` and `agreement_acceptances` (append-only).
- Pharmacy onboarding: `pharmacy_invites`, `pharmacy_onboarding_applications`, `pharmacy_agreement_acceptances` and `pharmacy_onboarding_events` (append-only).
- Patient intake: `clinic_signup_links`, `patient_intake_links`, `patient_import_batches`, `patient_external_ids`, `patient_field_changes`, `ehr_connections` and `ehr_sync_events` (Keragon).
- Payments: `ledger_entries`, `pharmacy_payables`, `payable_events` and `reconciliation_runs` (append-only).
- Compliance: `phi_access_log`, `epcs_audit_log`, `retention_runs` and `legal_holds`.
- Providers: `provider_state_licenses` and `provider_npi_verifications`.
- Patient protocol choice (#268): `treatment_proposals`, `treatment_proposal_options`, `proposal_choice_items` and `treatment_proposal_events` (the last two append-only), plus `orders.proposal_option_id` and `orders.proposal_required`.

**Phase C multi-Rx payment groups are LIVE:** multiple prescriptions can be bundled into a single patient checkout via `payment_groups`, with `dispute_orders` tracking per-order dispute state.

**Role features F-3 / F-5 have shipped:** F-3 (provider opt-in clinic-view toggle) and F-5 (`patients.primary_provider_id`) are in production. See [docs/audits/role-audit-and-data-model.md](docs/audits/role-audit-and-data-model.md).

## Four-Tier Adapter Architecture

Pharmacies are integrated at one of four tiers based on technical capability:

| Tier | Method | Latency | Used when |
|------|--------|---------|-----------|
| Tier 1 | Direct REST API | <5s | Pharmacy has CompoundIQ-compatible API |
| Tier 2 | Playwright portal automation | 30–120s | Pharmacy has a web ordering portal |
| Tier 3 | Standardized OpenAPI spec | <10s | Pharmacy implements CompoundIQ spec |
| Tier 4 | Fax via Documo | 1–4h | All pharmacies (universal fallback) |

The routing engine cascades: Tier 1/2/3 failure → Tier 4 fax. The circuit breaker (per pharmacy) opens after 5 failures and blocks Tier 1/2/3 for a 5-minute cooldown.

## Order State Machine (23 statuses)

```
DRAFT
  → AWAITING_PAYMENT (sign + send)
  → PAYMENT_EXPIRED  (72h without payment)

AWAITING_PAYMENT
  → PAID_PROCESSING  (Stripe payment_intent.succeeded)

PAID_PROCESSING
  → SUBMISSION_PENDING (adapter routing initiated)

SUBMISSION_PENDING
  → PHARMACY_ACKNOWLEDGED (pharmacy confirms receipt)
  → SUBMISSION_FAILED     (all tiers exhausted)
  → FAX_QUEUED            (Tier 4 fax sent)

PHARMACY_ACKNOWLEDGED
  → PHARMACY_COMPOUNDING (pharmacy begins work)
  → PHARMACY_REJECTED    (pharmacy rejects order)

PHARMACY_COMPOUNDING
  → PHARMACY_CONFIRMED  (pharmacy confirms completion)

PHARMACY_CONFIRMED
  → SHIPPED              (tracking number assigned)

SHIPPED
  → DELIVERED            (carrier confirms delivery)

... + CANCELLED, FAX_FAILED, REROUTE_PENDING, MANUAL_REVIEW
```

## Webhook Processing

All webhooks (Stripe, Documo, Twilio, pharmacy) share a 7-step pattern:

1. Verify HMAC signature
2. Parse payload with Zod schema
3. Check `external_event_id` for idempotency
4. Insert into `webhook_events`
5. Resolve order
6. Transition status via `casTransition()` (compare-and-swap)
7. Mark `processed_at`

## SLA Engine

8 SLA types monitor order lifecycle. A `sla-check` cron runs every 5 minutes and fires alerts at escalation tiers:

- **Tier 1**: Slack #ops-alerts channel message
- **Tier 2**: Slack DM to on-call (15-min re-fire timer)
- **Tier 3**: PagerDuty critical incident (phone wake-up)

## Multi-Tenant Isolation (RLS)

Every table has Row Level Security (RLS) enabled. The key JWT claim is `app_metadata.clinic_id` (`auth.jwt() -> 'app_metadata' ->> 'clinic_id'`, migration 20261010000001). Ops admins get a special `app_role = ops_admin` claim that grants cross-clinic SELECT access.

The server-side Supabase client (`service_role`) bypasses RLS and is used exclusively in API routes and cron jobs — never in client-side code.

Since Oct 24 (migration 20261024000001, security review C1), a user JWT cannot write `clinics` at all. INSERT, UPDATE, DELETE and TRUNCATE are revoked from anon and authenticated, and the old `clinics_clinic_user_update` policy is gone. The app writes clinics only with the service role. Before this, a self sign-up's clinic_admin could have approved their own clinic through PostgREST. Other permissive user-write policies on orders, patients, providers, payment_groups and the provider license and NPI tables (L5) are being locked down separately, on `rls-user-write-lockdown`.

## Onboarding, Approval and Team

- **Invites.** Ops invites a clinic or a pharmacy. The invitee accepts at `/onboard/...` and finishes a wizard: practice details, providers, staff, BAA, terms and payouts for a clinic; licenses, ordering, shipping, the agreement and the catalog for a pharmacy. Ops reviews and approves at `/ops/onboarding`.
- **Self sign-up** (`/get-started`, `src/lib/signup/self-serve.ts`) creates a solo provider, a clinic or a pharmacy with no invite. The login works at once, and the clinic starts `in_progress` and inactive.
- **The approval guard.** Until ops approves (`onboarding_status = 'approved'` AND `is_active`), every route that orders, signs, charges or reaches a patient answers 403 `CLINIC_PENDING_REVIEW`. The check is `src/lib/onboarding/approval-guard.ts`. It fails closed: an unreadable clinic is 503. An onboarding pharmacy is inactive, so it receives no orders.
- **Unverified NPI.** On approval, ops sees an unverified-NPI warning and must confirm a state-board check first.
- **Demo payouts.** Approving a clinic with no Stripe Connect account gives it `poc_placeholder_<clinic_id>` (ACTIVE), so ordering opens on approval. Checkout treats a placeholder as the platform's own account. See `DEMO_PAYOUTS_ON_APPROVAL` in CLAUDE.md, including the pending live-key guard (H1).
- **Team** (Settings > Team; `src/lib/team/`, `/api/team/*`). An approved clinic's admin invites clinic admins, providers and medical assistants, resends or revokes invites, adds providers, and deactivates or reactivates members.
  - Deactivation (`set_clinic_member_active`) bans the login, ends its sessions, sets `providers.is_active = false`, and refuses to remove the last active clinic admin.
  - Every change is a `clinic_onboarding_events` row.

## Patients and Prescriptions (October additions)

- **Clinic sign-up link and QR code** (Settings; `/join/<token>`). A patient adds themself to the clinic. The admin creates, disables or re-enables it, and it is refused until the clinic is approved.
- **Patient intake link** (`/intake/<token>`): a patient completes their details from an SMS link.
- **Face-sheet fill** (New patient): reads an uploaded face sheet with the Anthropic API to prefill the form. It is shown only when `ANTHROPIC_API_KEY` is set.
- **CSV import** (`/api/patients/import/*`) and **Keragon EHR sync** (`docs/integrations/keragon.md`).
- **Possible duplicates.** A new patient who matches an existing one gets 409 `POSSIBLE_DUPLICATE`. Each existing patient shown is logged in `phi_access_log`.
- **+ New Protocol** creates a protocol template directly, with no patient. The creator is the calling provider; a clinic admin may name a provider of the clinic.
- **Patient protocol choice** (#268, live; migration 20261024000002, applied on production; design: `docs/design/patient-protocol-choice.md`; code: `src/lib/proposals/`):
  - **Proposing.** The provider builds DRAFT lines as usual and, instead of signing, chooses "Send to patient for choice". The lines are grouped as options (Option A, B, ...) in a `treatment_proposals` row, with `treatment_proposal_options`; the lines are tagged by `orders.proposal_option_id` and `orders.proposal_required`.
  - **Checks first.** Every signing check except the signature runs first, so a line that could not be signed is never offered. A controlled substance can never be proposed.
  - **Who sends.** The provider, or a clinic admin on their behalf. A medical assistant may prepare a proposal but not send it (403 `MA_CANNOT_SEND`).
  - **The link.** The patient gets `/plan/<token>`: a 32-byte token stored only as SHA-256. It lasts 7 days, is replaced on re-send, and stops working once signed. It locks after 5 wrong date-of-birth tries. The link is copied, shown as a QR code, or texted when SMS is set up and the patient opted in; each delivery is recorded. Before the date-of-birth check the page shows no PHI.
  - **Choosing and signing.** The patient chooses an option; the choice is recorded in `proposal_choice_items` (append-only), and every step is a `treatment_proposal_events` row (append-only).
    - The provider then signs only the chosen lines, through the existing batch sign. Every check runs again, and the payment link or payment group goes out as for any signed order. A clinic admin may sign as their own linked, NPI-verified provider; a medical assistant cannot.
    - A failed check stops the whole choice, and nothing is signed.
    - After signing, the lines not chosen go DRAFT → CANCELLED and stay tagged, so the clinic sees what was not chosen. Cancelling a proposal cancels all its lines.
    - Signed protocol options start or advance the patient's protocol instance.
  - **Expiry.** A Vercel cron (`/api/cron/proposal-expiry`) expires a sent or chosen proposal 7 days after sending and cancels its draft lines. The link then says it has expired.
  - **Where it shows.** On the clinic dashboard a proposed line is a "Proposed" order: a DRAFT tagged to the proposal. There is no new order status.
- **Submission failure reason.** An order in SUBMISSION_FAILED, FAX_FAILED or PHARMACY_REJECTED shows one plain line in the clinic order drawer: where it was going, why, and what happens next. The reason maps the latest failed adapter submission's error code (`src/lib/orders/submission-failure.ts`). Only known codes or an HTTP status are returned; the adapter's message is never shown.
- **Uploads** are limited to 4 MB (`src/lib/uploads/limits.ts`). Vercel refuses bodies over about 4.5 MB, so the limit is checked in the browser and on the server, and named in the copy. File types are read from the bytes (`src/lib/uploads/sniff.ts`).

## Payments

Destination charges through Stripe Connect Express. The application fee is the pharmacy wholesale plus shipping. The clinic receives the rest. There is no percentage platform fee (since #241): CompoundIQ's flat monthly fee is billed separately. `ledger_entries` (append-only) records each charge, transfer, refund and dispute line, and `pharmacy_payables` tracks what is owed to each pharmacy. Ops marks payables scheduled or paid; each mark is a `payable_events` row.

## Security Controls (October 2026 review)

- **Same-origin writes:** `src/lib/security/same-origin.ts`. See CLAUDE.md.
- **Rate limits** are in memory, per Vercel instance (`src/lib/security/rate-limit.ts`): sign-up, the join link, invite acceptance and the face sheet. Moving them to a shared store is open (L7).
- **Email at self sign-up** is confirmed on creation, so a login is live for an address nobody verified (M2). Ops confirms the email and phone before approval. Email confirmation in the product is open.
- **zod** is 3.25.76, which `npm audit` flags. It is mitigated: every public route caps body fields, and Vercel caps bodies at 4.5 MB. The move to zod 4 is its own change.

## Vault Credential Management

Pharmacy API keys and portal passwords are stored in Supabase Vault (AES-256-GCM). The `pharmacy_api_configs` and `pharmacy_portal_configs` tables store only the UUID reference (`vault_secret_id`, `username_vault_id`, `password_vault_id`). The adapter layer decrypts credentials at runtime via `supabase.rpc('vault.decrypted_secret', ...)`.

## Key Architecture Decisions

**Why Next.js App Router?**
Server Components eliminate API round-trips for data-heavy clinic UI. Edge Middleware handles checkout token validation at the CDN edge without a cold start.

**Why Supabase Vault over BYTEA encryption?**
Vault manages key rotation, audit logging, and access control as a first-class feature. BYTEA encryption requires managing the encryption key in environment variables — a worse security posture.

**Why Stripe Connect Express?**
Express accounts allow clinics to receive disbursements without CompoundIQ holding funds. Each clinic gets its own Stripe account with direct payment flows.

**Why four adapter tiers?**
Each tier trades cost/complexity for speed. Tier 1 is fast but requires pharmacy API investment. Tier 4 fax is universal but slow. The four-tier cascade maximizes automation coverage across the fragmented pharmacy landscape.
