# Role Audit + Data Model Survey

**Audit date:** 2026-05-27
**Audit scope:** Phase A1 of the post-security-campaign discovery plan
**Audience:** AI agents (Claude, Codex) operating on this codebase + the user. Not partner-facing. Not PDF-synced.
**Source-of-truth refs:**
- `src/middleware.ts` — route-level RBAC
- `src/app/(clinic-app)/layout.tsx` / `src/app/(ops-dashboard)/layout.tsx` — layout-level RBAC
- `src/lib/poc/canonical-users.ts` — canonical user roster
- `src/types/database.types.ts` — schema
- `scripts/seed-poc.ts` — seed-time hardcoded IDs

## 1. Roles in the system

Five distinct identities exist. Four are auth-backed; one is JWT-token-only.

| Role label | `app_role` claim | Auth | App entry | Cross-clinic? |
|------------|--------------------|------|-----------|----------------|
| Clinic Admin | `clinic_admin` | Supabase Auth (session) | `/dashboard` | No — `clinic_id` claim |
| Provider | `provider` | Supabase Auth (session) | `/dashboard` | No — `clinic_id` claim |
| Medical Assistant | `medical_assistant` | Supabase Auth (session) | `/dashboard` | No — `clinic_id` claim |
| Ops Admin | `ops_admin` | Supabase Auth (session) | `/ops/pipeline` | **Yes** — no `clinic_id` claim |
| Patient | (no `app_role`) | JWT in `/checkout/[token]` URL | `/checkout/[token]` | N/A — token scoped to one order |

### Canonical POC accounts ([canonical-users.ts:35-60](src/lib/poc/canonical-users.ts#L35-L60))

```
ops_admin           ops@compoundiq-poc.com         POCAdmin2026!
clinic_admin        admin@sunrise-clinic.com       POCClinic2026!
provider            dr.chen@sunrise-clinic.com     POCProvider2026!
medical_assistant   ma@sunrise-clinic.com          POCMA2026!
```

Canonical clinic for all clinic-staff accounts: `a1000000-0000-0000-0000-000000000001` ("Sunrise Functional Medicine"). Canonical provider record (Dr. Sarah Chen): `a2000000-0000-0000-0000-000000000001` per [scripts/seed-poc.ts:69](scripts/seed-poc.ts#L69).

## 2. RBAC enforcement architecture (defense-in-depth, 3 layers)

### Layer 1 — Middleware ([src/middleware.ts:117-128](src/middleware.ts#L117-L128))

```
if pathname starts with /ops:
    require app_role === 'ops_admin'
    else → /unauthorized

if pathname doesn't start with /ops:
    require app_role in {clinic_admin, provider, medical_assistant, ops_admin}
    else → /unauthorized
```

Patient `/checkout/[token]` is gated by JWT verification, not by Supabase session ([middleware.ts:41-74](src/middleware.ts#L41-L74)). The token carries `orderId` + `clinicId` claims, decoded and forwarded as request headers.

### Layer 2 — Layout-level guard

[`src/app/(clinic-app)/layout.tsx:23-28`](src/app/(clinic-app)/layout.tsx#L23-L28) re-checks `app_role in {clinic_admin, provider, medical_assistant}` and redirects to `/unauthorized` if not. [`src/app/(ops-dashboard)/layout.tsx:21-25`](src/app/(ops-dashboard)/layout.tsx#L21-L25) does the same for `app_role === 'ops_admin'`. This is redundant with middleware but provides server-component-side enforcement for cases where middleware might be bypassed.

### Layer 3 — API route per-endpoint

Inconsistent across endpoints:

- [`/api/orders/[orderId]/checkout-link`](src/app/api/orders/[orderId]/checkout-link/route.ts#L73-L77) — **explicit** check that `app_role in CLINIC_APP_ROLES`.
- [`/api/orders/[orderId]/sign-and-send`](src/app/api/orders/[orderId]/sign-and-send/route.ts#L41-L60) — **only** checks session + `clinic_id`. Does NOT verify the signing user IS the provider on the order. See finding **F-2** below.
- Most ops API routes — check session + `app_role === 'ops_admin'`.

## 3. Page-level role differentiation: NONE

Both the clinic-app sidebar and the page contents are **identical** across `clinic_admin`, `provider`, `medical_assistant`. The only difference is a 5-character role label rendered next to the email in the bottom-left of the sidebar.

[`src/components/sidebar-nav.tsx:37-41`](src/components/sidebar-nav.tsx#L37-L41):

```
Dashboard          (all 3 roles)
New Prescription   (all 3 roles)
Settings           (all 3 roles)
```

No "My Patients" view for providers, no draft-prep-only mode for MAs, no clinic-management items hidden from non-admin roles.

## 4. Data model — entity relationships

### Core tables (relevant to roles + multi-provider/multi-Rx work)

```
clinics  ──┬── providers   (clinic_id, provider_id)              1:N
           ├── patients    (clinic_id, patient_id)               1:N
           ├── orders      (clinic_id, patient_id, provider_id)  1:N
           └── clinic_users (RLS — clinic staff in this clinic)

orders ── stripe_payment_intent_id (1:1 with Stripe PaymentIntent)

epcs_audit_log (provider_id, patient_id, ...)  ──── for compliance audit
```

### Patient table — `clinic_id` ONLY, no provider_id

[`src/types/database.types.ts:1260-1318`](src/types/database.types.ts#L1260-L1318):

```
patients {
  patient_id, clinic_id, first_name, last_name, date_of_birth,
  email, phone, sms_opt_in, address_*, state, zip,
  is_active, created_at, updated_at, deleted_at
}
```

**No `provider_id` column.** A patient is "owned" by a clinic, not by a provider. The patient↔provider relationship is implicit, derived from `orders` rows.

### Orders table — the join point

[`src/types/database.types.ts:1036-1075`](src/types/database.types.ts#L1036-L1075):

```
orders {
  order_id, clinic_id, patient_id, provider_id, catalog_item_id, pharmacy_id,
  status, submission_tier, quantity, sig_text, notes,
  retail_price_snapshot, wholesale_price_snapshot,
  pharmacy_snapshot, medication_snapshot,
  provider_npi_snapshot, provider_signature_hash_snapshot,
  stripe_payment_intent_id, stripe_transfer_id,
  documo_fax_id, fax_attempt_count, reroute_count, tracking_number,
  created_at, updated_at, deleted_at, is_active
}
```

The `provider_id` on the order is what gets EPCS-signed. The provider on the order is captured via snapshot columns (`provider_npi_snapshot`, `provider_signature_hash_snapshot`) at sign-and-send time — so historical orders survive provider record changes.

### Providers table — NO link to auth.users

[`src/types/database.types.ts:2033-2099`](src/types/database.types.ts#L2033-L2099):

```
providers {
  provider_id, clinic_id, first_name, last_name,
  npi_number, dea_number, license_number, license_state,
  signature_hash, signature_on_file,
  totp_enabled, totp_secret_encrypted, totp_verified_at,
  is_active, created_at, updated_at, deleted_at
}
```

**Critical gap:** no `user_id` or `auth_user_id` column. There's no DB-level mapping from "this Supabase auth session is Dr. Chen" to "providers row a2000000-...". The mapping is implicit, established by the seed script ([scripts/seed-poc.ts:69](scripts/seed-poc.ts#L69)) and not enforced anywhere at runtime. Implications in finding **F-1** below.

## 5. Multi-provider-per-patient — current support

| Scenario | Supported today? | Path |
|----------|-------------------|------|
| Same patient, multiple providers in same clinic | ✅ Yes (data layer) | Each `orders` row carries a different `provider_id`; same `patient_id` + same `clinic_id`. |
| Same patient, providers across multiple clinics | ❌ No | RLS isolates by `clinic_id`. Cross-clinic patient view would need new `patient_clinics` join table OR a "patient-clinic-permission" model. |
| UI shows "all providers who treat this patient" | ⚠️ Unknown / probably no | No patient-detail view found in clinic-app routes. Patient info only surfaces inside an order context. Need separate audit. |
| Provider's "my patients" filter | ❌ No | Dashboard shows all clinic orders for any clinic staff role. No filter by `provider_id === current_user.provider_id` — because that mapping doesn't exist (see F-1). |

## 6. Multi-Rx checkout — current support

| Scenario | Supported today? | Path |
|----------|-------------------|------|
| One Rx, one PaymentIntent, one charge | ✅ Yes | `REQ-PSR-001`. Idempotency key `checkout-pi-v2-${orderId}`. |
| Multiple Rx in one checkout (one charge to patient, sum of orders) | ❌ No | No `payment_groups` / `checkout_sessions` table. Each order has its own `stripe_payment_intent_id`. |
| Connect split routing | ✅ Yes (per order) | `application_fee_amount` per PaymentIntent, computed from order's margin. Bundling N orders requires summing application fees and (if same clinic) using one transfer destination. |
| Cross-clinic Rx bundle | ❌ No | Would need `transfer_data[]` multi-destination split, with operational complexity for refunds/disputes. |

## 7. Findings (most critical first)

### F-1 [CRITICAL] No DB-level mapping from auth users to provider rows

**Location:** `providers` table schema, no `user_id` / `auth_user_id` column. Seed-time hardcoding only ([scripts/seed-poc.ts:69](scripts/seed-poc.ts#L69)).

**Impact:**
- Server-side cannot enforce "the signed-in user IS the provider on this order." Today the convention is: the front-end submits the order with a `provider_id` and the server trusts it.
- Provider-specific filters (e.g., "my orders," "my patients") cannot be implemented at the SQL layer.
- EPCS audit logs record `provider_id` from the order, but a different auth user could have signed it.
- Multi-provider workflows (e.g., "show me which provider signed for this patient last") work at the data layer but cannot be authenticated against the active session.

**Fix:** Add `providers.user_id` column (foreign key to `auth.users.id`, unique). Backfill from current seed. Update sign-and-send to verify `session.user.id === order.provider.user_id` before accepting the signature. Required for any meaningful per-provider RBAC.

**Effort:** 0.5–1 day (migration + backfill + sign-and-send guard + tests).

### F-2 [HIGH] `sign-and-send` doesn't verify the signing user is the order's provider

**Location:** [`src/app/api/orders/[orderId]/sign-and-send/route.ts:41-119`](src/app/api/orders/[orderId]/sign-and-send/route.ts#L41-L119).

**Impact:** A medical assistant (MA) session that has `clinic_id` claim can call this endpoint for an order whose `provider_id` is Dr. Chen. The endpoint checks: session exists, clinic_id present, order is in this clinic, order is DRAFT, signature data is plausible PNG. It does NOT check that the calling session corresponds to the order's `provider_id`. Combined with F-1, there's no DB column to even attempt that check.

The TOTP enrollment lives on `providers.totp_secret_encrypted`, but the sign-and-send route uses `order.provider_id` to read it — so the MA's session decrypts Dr. Chen's TOTP, then asks the user (the MA) to enter a code. If the MA has out-of-band access to Dr. Chen's authenticator, the MA can sign Dr. Chen's prescription. This is a real EPCS-compliance gap.

**Fix:** Depends on F-1 first. After `providers.user_id` exists, sign-and-send must enforce `order.provider_user_id === session.user.id`.

**Effort:** included in F-1 fix.

### F-3 [HIGH] No page-level role differentiation in clinic app

**Location:** [`src/components/sidebar-nav.tsx`](src/components/sidebar-nav.tsx#L37-L41), all three clinic-app routes.

**Impact:** Clinic Admin, Provider, and MA all see the identical sidebar (Dashboard, New Prescription, Settings) and identical page contents. A provider has no "my queue" view; an MA has no "drafts I started" view; a Clinic Admin has no clinic-management-only screens.

For a single-provider clinic this is fine. For multi-provider clinics or clinics with admin-only billing access, this becomes a friction point and an information-leakage concern (every clinic user sees every order's financial split, every patient's PHI).

**Fix:** Role-aware nav + page filters. Concrete first steps:
1. Provider's `/dashboard` defaults to "my patients" filter (orders where `provider_id === my_provider_id`). Toggle to "all clinic orders" available.
2. MA cannot enter `/new-prescription/sign/[orderId]` — redirected to a read-only view, or sign button hidden client-side AND server-side blocks the POST.
3. Settings page split into "my settings" (everyone) and "clinic settings" (clinic_admin only).

**Effort:** 1–2 days, dependent on F-1 (need to know who the provider is).

### F-4 [MEDIUM] No patient-detail view

**Location:** Clinic-app routes — only `/dashboard`, `/new-prescription/*`, `/settings`. No `/patients` or `/patients/[patientId]` route exists.

**Impact:** A clinic-staff user has no canonical place to see "everything for patient X" — all their orders, all the providers who've treated them, allergies, demographics. Patient info only surfaces inline inside an order. This blocks the multi-provider visibility ask from Lauren.

**Fix:** Add `/patients` (list) + `/patients/[patientId]` (detail). The detail page would aggregate the patient's orders, surface "providers who've treated this patient" (DISTINCT provider_id from orders), surface payment history, surface upcoming refills.

**Effort:** 2–3 days (new pages, list/detail/edit forms, no schema changes needed since `patients` table already supports it).

### F-5 [MEDIUM] Patient↔provider relationship is implicit only

**Location:** Data model — no `patient_providers` join table; the relationship is derived from `SELECT DISTINCT provider_id FROM orders WHERE patient_id = X`.

**Impact:** Mostly fine for now, but creates ambiguity for use cases like:
- "Set Dr. Chen as patient Y's primary care provider" (no place to store this).
- "Patient transfers from Dr. Chen to Dr. Patel" (the historical orders still reference Dr. Chen — correct for audit, but no clean way to indicate "Dr. Patel is the current provider").
- "Show me all of Dr. Patel's patients, including ones he hasn't prescribed for yet" (impossible — relationship is order-dependent).

**Fix:** Optional. If primary-provider concept is needed for Lauren's ask: add `patients.primary_provider_id` (nullable FK to providers). Order creation can default to primary provider but is not constrained to it.

**Effort:** 0.5 day if just adding the column.

### F-6 [LOW] No CompoundIQ internal roles beyond `ops_admin`

Confirmed via [canonical-users.ts:17-22](src/lib/poc/canonical-users.ts#L17-L22): `PocUserLabel` is union of 4 strings. `app_role` claim has no other documented values.

**Fix:** Per user direction, defer. Track in deferred backlog.

## 8. Relevant constants to remember

```
POC_CLINIC_ID         a1000000-0000-0000-0000-000000000001  (Sunrise Functional Medicine)
POC_PROVIDER_ID       a2000000-0000-0000-0000-000000000001  (Dr. Sarah Chen)
CLINIC_APP_ROLES      ['clinic_admin', 'provider', 'medical_assistant']
NAV_ITEMS (clinic)    ['/dashboard', '/new-prescription', '/settings']
NAV_ITEMS (ops)       ['/ops/pipeline', '/ops/catalog', '/ops/fax', '/ops/sla', '/ops/adapters', '/ops/demo-tools']
```

## 9. Recommended next steps from this audit

In dependency order:

1. **F-1: `providers.user_id` mapping** — required before any of F-2 / F-3 can be solved properly. 0.5–1 day.
2. **F-2: sign-and-send signer enforcement** — bundled with F-1. EPCS compliance.
3. **F-4: patient-detail view** — unblocks Lauren's multi-provider visibility ask. 2–3 days.
4. **F-3: role-aware nav + filters** — 1–2 days, depends on F-1.
5. **F-5: primary_provider_id** — optional, judgement call. 0.5 day.

For Phase B (quick wins) of the larger plan, F-1 + F-2 + F-4 are the highest-leverage. F-3 / F-5 can wait until clinic-onboarding feedback reveals concrete need.

For Phase C (multi-Rx cart) — **F-1 is a hard prerequisite.** The cart endpoint needs to validate "all N orders share the same provider" which requires `provider_id` to be meaningfully tied to the calling session.

## 10. F-3 resolution (2026-06-11)

**Chosen approach:** Option A — enforce the dashboard role filter at the database tier via Row-Level Security on `orders`.

**Migration:** `supabase/migrations/20260611000004_f3_dashboard_rls_filter.sql`

**Visibility contract** (SELECT-only; INSERT/UPDATE policies unchanged):

| Role | What they SELECT |
|------|------------------|
| `ops_admin` | every row, cross-clinic |
| `clinic_admin` | every row in their `clinic_id` |
| `medical_assistant` | every row in their `clinic_id` |
| `provider` | every row in their `clinic_id` WHERE `orders.provider_id` matches the `providers` row whose `user_id = auth.uid()` |

**Policy deviation from the §F-3 spec:** The audit suggested a UX toggle (provider defaults to "my patients" with the option to flip to "all clinic orders"). Under Option A, the policy is the contract — there is no toggle. A provider cannot see another provider's orders in the same clinic. If a future requirement reintroduces the toggle, it has to come with a second policy or an explicit grant tied to a new `app_role` claim.

**Companion code change:** `src/app/(clinic-app)/dashboard/page.tsx` switched from `createServiceClient()` to the session-scoped `createServerClient()` for the SSR query. The pre-F-3 dashboard SSR bypassed RLS — that was the gap the migration alone could not have closed. The browser-side polling already uses the session-scoped client, so no change there.

**Cross-clinic isolation:** asserted in the provider branch by requiring both `orders.clinic_id` to match the JWT `clinic_id` AND the linked `providers` row's `clinic_id` to match the same JWT — defence-in-depth in case a stale provider linkage spans clinics.

**Deferred / non-goals:** the patient-detail view (F-4), provider-toggle UX (F-3 nice-to-have), and `patients.primary_provider_id` (F-5) are unchanged. F-1 (`providers.user_id`) and F-2 (sign-and-send signer enforcement) remain prerequisites and are already in place.
