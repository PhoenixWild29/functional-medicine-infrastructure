# HIPAA Security Rule: technical safeguards evidence map (2026-10-25)

Task C-2026-10-25-16. This map is written for AI readers; the orchestrator turns it into a Word document for Sam.

## How to read it

**What it covers.** For each standard and implementation specification in 45 CFR 164.312, plus 164.308(a)(5)(ii)(C) and (D), it records:
- what the code does today on `origin/main`;
- what queued, unmerged branches add, each named;
- what depends on vendors;
- the gaps, each with its risk, fix, type, and whether it **blocks real patient data**.

**Basis.** Everything comes from reading the code at `origin/main` 2696ff24 and the named branches, not docs. It states facts and gaps only, no legal conclusions.

**Queued branches.**
- The bundles: `bundle-security`; then `bundle-ci` and `bundle-features`, which each contain it.
- The migration queue: `ops-fax-viewer-documo` (000003), `rls-user-write-lockdown-v2` (000004), `security-followups-2` (000005), `signup-squatting` (000006), `rate-limit-db` (000007), `perf-indexes` (000008).
- Also `middleware-to-proxy`, `clinical-difference-saved` (000009) and `clinic-help`.

**Status of vendors and data.** **No BAAs are signed with any vendor yet. Production holds demo data only.**

**Method.** Four reviewers each took one area: access and authentication; audit; integrity and RLS; transmission and vendors. I re-checked the headline facts in the code:
- `REQUIRE_MFA` must be exactly `'true'` (`src/lib/env.ts:77`);
- the EPCS key is derived from the service-role key (`src/lib/epcs/crypto.ts:30-35`), and that column is used only by `/api/epcs`;
- no RLS policy checks `aal`;
- the clinic-user write policies on `orders` exist on main;
- the freeze trigger's column list (`20261012000001:156-183`) does not include `sig_text`, quantity, refills or the other clinical columns;
- there is no `instrumentation.ts` on main or any bundle;
- the face-sheet AI is on unless set to `"false"`;
- Tier 2 posts to `api.openai.com`;
- Tier 1 builds its URL from `base_url` with no https check.

---

## Summary: gaps that block real patient data

| # | Gap | Fix | Type |
|---|---|---|---|
| B1 | No BAAs. Supabase, Vercel, Twilio, Documo, Anthropic, OpenAI, Keragon and Sentry all receive or store ePHI. | Sign the BAAs and apply their configuration (see the vendor map) | vendor |
| B2 | MFA is off for every clinic and ops user by default. Only pharmacy_admin is always required. | Set env `REQUIRE_MFA=true` after users enroll (or add the staff roles to `ALWAYS_MFA_ROLES`) | env |
| B3 | MFA is enforced only in Next.js middleware. RLS never checks `aal`, so a password-only session can read PHI through PostgREST with the public anon key. | Add `(auth.jwt()->>'aal') = 'aal2'` to the `authenticated` policies on PHI tables (a shared helper) | code M-L |
| B4 | On main, clinic users can write `orders`, `patients`, `providers`, `payment_groups`, NPI verifications and state licenses directly through PostgREST. They can set `status` or `locked_at`, skipping signing and payment, and no history row is written. | Merge and apply 000004 (`rls-user-write-lockdown-v2`, already written); confirm with a PostgREST PATCH test | code S (done, queued) |
| B5 | The signed-order freeze misses clinically significant columns (`sig_text`, `sig_mode`, `titration_steps`, `quantity`, `dispense_*`, `days_supply`, `refills`, `substitution_allowed`, `special_instructions`, `patient_id`, `provider_id`, `formulation_id`, package columns, `shipping_fee`). | Add them to `prevent_snapshot_mutation`; allow-list the ops reroute's `pharmacy_id` | code S |
| B6 | Nothing refuses to transmit an unsigned order (the submit cron, routing engine and adapters do not check `locked_at` or the signature hash). | Adapters refuse such orders; DB CHECK `status NOT IN (post-sign) OR locked_at IS NOT NULL`; add the signature hash to the required fields | code S |
| B7 | The signature hash does not bind the prescription. It is SHA-256 of the signature image plus time, and the image is discarded. | Hash or HMAC a canonical serialization of the frozen Rx fields with the image and time; store the image privately | code M |
| B8 | No server-side session inactivity timeout or time-box. The 15-minute logoff runs only in an open tab. | Set the hosted Supabase Auth session inactivity timeout and time-box | vendor config |
| B9 | Shared POC accounts (including ops_admin) have their passwords in source, README and docs. | Make sure they do not exist or are banned on prod, keep `POC_MODE` unset, and remove the passwords from the repo | policy + code S |
| B10 | `POST /api/providers` takes a password chosen by the admin, and nothing forces a change. | Use the invite flow (the user sets their own password) or force a reset | code M |
| B11 | No password reset or change flow anywhere. | Forgot password plus change password using `passwordProblem` | code M |
| B12 | No failed-login monitoring or alerting. Sign-in goes from the browser straight to Supabase. | A job reading `auth.audit_log_entries` that alerts through Slack or PagerDuty, or a server-side login route; plus a review procedure | code M + policy |
| B13 | No emergency-access (break-glass) procedure. | A written procedure, a named MFA account, and logged use with a reason | policy + code S |
| B14 | Audit gaps in PHI access coverage. | See 164.312(b) | code S-M |
| B15 | `logPhiAccess` never fails closed and nobody is alerted. `PHI_ACCESS_LOG_HASH_SECRET` is not in `.env.example`, and when it is unset every hash is written NULL. | Alert on insert failure; fail a health check when the secret is missing; confirm it is set in prod | code S |
| B16 | No audit-log review procedure, and limited review tooling. | A written review policy, an ops audit viewer and export, and paging | policy + code M |
| B17 | Tier 1 API and Tier 2 portal pharmacy URLs are not forced to https at send time. | Reject non-`https:` URLs at send time, and add CHECK constraints on `base_url` and `portal_url` | code S |
| B18 | The face-sheet AI sends whole face sheets to Anthropic and is on by default. | Make `FACE_SHEET_AI_ENABLED` opt-in, and get a BAA with zero data retention | code S + vendor |
| B19 | Tier 2 sends portal confirmation screenshots, which can show patient and Rx, to **OpenAI**, a vendor that is not on the project's vendor list. | Remove the vision scoring, or get a BAA with ZDR plus an opt-in flag | code S + vendor |
| B20 | Sentry is very likely not running: there is no `instrumentation.ts`, so there is no error or incident signal. When it is enabled, transactions are not scrubbed. | Add `instrumentation.ts` / `instrumentation-client.ts`; queued `bundle-security` adds transaction scrubbing; Sentry BAA | code S + vendor |
| B21 | Backups, PITR and restore are not evidenced, and docs disagree about them. There is no restore test, and Storage objects are not covered by database backups. | Enable PITR under the BAA plan, record evidence, write a restore runbook, run a test restore, and decide how Storage is backed up | vendor + policy |

Conditional: B22. Clinic users can read the unredacted `adapter_submissions.response_payload` (`adapter_submissions_clinic_user_select`). This blocks real patient data if pharmacy responses carry PHI. Fix: drop the policy or expose a view of safe columns (code S).

---

## 164.312(a)(1) Access control (required)

### Roles and gates
**On main**
- **Roles come only from `app_metadata`.** See `src/lib/auth/claims.ts:22-57` (`getUserRole`, `getUserClinicId`, `getUserPharmacyId`). A deactivated user gets no role (`isDeactivated`, :36-39). RLS reads the same claims through `auth.jwt()->'app_metadata'` (migration `20261010000001_app_metadata_roles.sql`).
- **getUser, not getSession.** The middleware uses `getUser()` (`src/middleware.ts:311`), and so do the layouts. `src/__tests__/no-getsession-in-api-routes.test.ts` forbids `getSession()` in API routes.
- **Middleware gates (`src/middleware.ts`):**
  - no user: redirect to `/login`;
  - deactivated user: 403 `ACCOUNT_DEACTIVATED` for APIs, and a local sign-out for pages (:369-379);
  - MFA gate (:395-416);
  - pharmacy_admin is confined to `/pharmacy`, `/api/pharmacy` and `/mfa` (:431-436);
  - `/ops` is for ops_admin only (:439-441);
  - clinic pages require a clinic role or ops_admin (:444-447);
  - sign page and `/practice` role gates (:472-486).
- **Public routes** (:245-249): token pages and webhooks.
- **Layouts re-check the role:** `(clinic-app)`, `(ops-dashboard)` and `pharmacy`.
- **API routes:** each route has its own `STAFF_ROLES` set (for example `api/patients/route.ts:41`).
- **Deactivation:** the RPC `set_clinic_member_active` (`20261021000001_team_invites.sql:86-156`) sets `deactivated_at`, bans the user for 100 years, deletes their refresh tokens and sessions, and makes the provider inactive.

**Queued**
- `bundle-security`:
  - a shared `CLINIC_STAFF_ROLES` / `isClinicStaffRole` gate on about 40 clinic routes;
  - `refuseCrossSite` on every cookie-authenticated write;
  - token-path headers.
- `rls-user-write-lockdown-v2` (000004): removes the user write policies (see B4).
- `security-followups-2` (000005):
  - reactivation restores an earlier ban;
  - a trustworthy `clientIp()`.
  - **Note:** its migration line 36 re-creates `set_clinic_member_active` with `search_path = public, pg_catalog`, which undoes the `pg_catalog, public` hardening from 000001. Fix that line before applying.
- `middleware-to-proxy`: renames the file; the logic is unchanged.

**Depends on vendors:** Supabase Auth (JWTs, bans, sessions) and PostgREST (RLS). No BAA is signed.

**Gaps (not blocking)**
- Deactivated users keep PostgREST access until their JWT expires: policies do not check `deactivated_at`. Fix: add the check to the staff policies or strip `app_role`. Code M.
- The middleware lets a signed-in user with no role through (`appRole && …`, :445). Layouts and routes refuse them anyway. Code S.

### 164.312(a)(2)(i) Unique user identification (required)
**On main**
- **Staff.** Each staff person is a Supabase auth user. Logins are created by:
  - `createLogin` (`src/lib/auth/create-login.ts:32-52`), used by self sign-up, clinic invite accept and pharmacy invite accept;
  - `POST /api/providers` (`route.ts:192-200`).
- **Shared demo accounts.** `src/lib/poc/canonical-users.ts:45-70` holds four accounts, ops_admin among them, with passwords in source (also in `scripts/fix-rls.ts:11`, README and docs).
  - Used by `scripts/seed-poc.ts`, `/api/admin/reset-poc-credentials` (ops plus `POC_MODE`) and `/ops/demo-tools` (404 unless `POC_MODE='true'`).
  - People demoing as one of these accounts share an identity.
- **Patients.** Patients have no accounts; they use bearer links:

| Link | Storage | Lifetime | Single use | Revocable | Rate limit (main; in memory per instance) |
|---|---|---|---|---|---|
| Checkout | HS256 JWT with `JWT_SECRET`, not stored (`lib/auth/checkout-token.ts`) | `CHECKOUT_TOKEN_EXPIRY` env | no | no | none |
| Intake | 32 bytes; SHA-256 in `patient_intake_links.token_hash` | 72 h | yes | yes | none |
| Plan | 32 bytes; SHA-256 in `treatment_proposals.token_hash` | 7 days | dies when signed | yes | 120 per IP and 60 per token per 15 min; locks after 5 wrong DOBs |
| Join (clinic QR) | hashed | none | no (shared) | yes (toggle) | 20 per IP per hour, a daily cap and a honeypot |
| Staff invite | 32 bytes, SHA-256 | 7 days | yes | yes; a resend rotates it | 10 per 15 min |

**Queued**
- `bundle-security`: checkout-token-out-of-url and token-pages-hardening. The token is removed from the URL before Stripe loads; no-referrer and noindex; neutral pages for bad links.
- `rate-limit-db` (000007): shared limiter counts in Postgres. It fails open, and the pharmacy accept limiter is not converted.

**Gaps:**
- B9 (shared POC accounts) and B10 (admin-set passwords).
- Not blocking:
  - the checkout JWT cannot be revoked until it expires (code M);
  - intake POST has no rate limit (code S).

### 164.312(a)(2)(ii) Emergency access procedure (required)
**On main:** nothing in code or docs ("break glass" and "emergency access" are absent). The de facto paths are:
- ops_admin, with cross-clinic RLS reads and service-role ops routes (59 files);
- the service-role key;
- the Supabase dashboard (the documented recovery for a locked-out ops user, `api/admin/reset-poc-credentials/route.ts:20-22`).

**Queued:** nothing.

**Gaps:** B13. Ops service-role PHI reads are mostly unlogged (only `api/ops/orders/[orderId]/detail:92` logs); see B14.

### 164.312(a)(2)(iii) Automatic logoff (addressable)
**On main**
- **The component.** `src/components/hipaa-timeout.tsx`:
  - 15 minutes by default (`DEFAULT_IDLE_TIMEOUT_MINUTES`), overridden by env `IDLE_TIMEOUT_MINUTES` (`src/lib/env.ts:83-89`);
  - a warning 2 minutes before the end;
  - the activity events are mouse, key, touch and scroll, per tab;
  - at the end it calls `signOut()` and redirects to `/login?reason=session_timeout`.
- **Where it is mounted:** `(clinic-app)/layout.tsx:74`, `(ops-dashboard)/ops/layout.tsx:24`, `onboarding/layout.tsx:31`.
- **Where it is not mounted:** the pharmacy portal, `/mfa` and `/unauthorized`. Patient token pages have no session.
- **Caching:** `Cache-Control: no-store` (middleware :23-28), and `BfcacheGuard` stops Back from restoring a page.
- **Session settings in the repo:** `supabase/config.toml` is the local CLI config only (`jwt_expiry = 3600`, refresh rotation on, no session time-box or inactivity setting). The hosted settings are not in the repo.

**Queued:** nothing.

**Gaps:**
- B8.
- Not blocking:
  - the pharmacy portal has no idle timeout (mount `HipaaTimeout` in `src/app/pharmacy/layout.tsx`; code S);
  - the timers are per tab (share the activity across tabs; code S).

### 164.312(a)(2)(iv) Encryption and decryption (addressable)
**On main**
- **EPCS TOTP secrets.** AES-256-GCM in `src/lib/epcs/crypto.ts:38-53`, stored in `providers.totp_secret_encrypted`.
  - **The key is `SUPABASE_SERVICE_ROLE_KEY.slice(0,32).padEnd(32,'0')` (:30-35).** For a legacy JWT service-role key, those 32 characters are the standard JWT header, the same in every project, so the key is effectively public.
  - There is no key versioning.
  - If decryption fails, the stored value is used as plaintext (`api/epcs/route.ts:216-223`, `lib/epcs/totp.ts:49-53`).
  - The column is readable by same-clinic users through `providers_clinic_user_select`.
  - **It is used only by `/api/epcs`.** Sign-in MFA uses Supabase's own factors (`auth.mfa`), and EPCS is disabled because batch sign refuses controlled substances (`lib/orders/batch-sign.ts:506-510`).
- **Keyed hashes.** HMAC-SHA256 with `PHI_ACCESS_LOG_HASH_SECRET` (`src/lib/audit/keyed-hash.ts:12-21`) for IP, user agent and email in the audit logs. With the secret unset, the hashes are written NULL.
- **Tokens.** Only SHA-256 hashes are stored (CHECK constraints `chk_*_token_hash`).
- **Pharmacy and EHR secrets.** Kept in Supabase Vault through `read_vault_secret` (`20261017000003`, service_role only).

**Queued:** `bundle-security` adds a constant-time secret compare and clinic-scoped EPCS audit ids. Nothing changes the key derivation.

**Gap (blocks re-enabling EPCS, not real patient data while EPCS stays off):**
- a dedicated random key `EPCS_TOTP_KEY` with a version prefix;
- re-encrypt the existing rows;
- remove the plaintext fallback;
- revoke column SELECT.

Code M.

---

## 164.312(b) Audit controls (required)

### Audit tables (on main)

| Table | Writer; is a failure fatal? | Append-only? | Who reads (RLS) | Retention |
|---|---|---|---|---|
| `phi_access_log` (`20261007000001`) | `logPhiAccess` / `logPhiAccessMany` (`src/lib/audit/phi-access.ts:120,167`). **Non-fatal**, prints only the error code. Nothing is logged when there is no signed-in user. Written only after a successful action (no 401/403 rows). Columns: actor id and role, email hash, clinic, patient, order, action, resource, masked route, IP and UA hashes. | Yes, for every role: revokes (UPDATE/DELETE/TRUNCATE from service_role too) plus triggers | clinic_admin of the clinic only; rows with a NULL clinic are visible to nobody | kept indefinitely (`NEVER_RETENTION_TARGETS`, `lib/retention/policies.ts:45`) |
| `epcs_audit_log` | `POST /api/epcs?action=audit` only; no caller | Yes (`20261011000001:140-167`); raw IP and UA on old rows | any role in the provider's clinic | never deleted |
| `order_status_history` | `insertStatusHistory` (`lib/orders/status-history.ts:40-90`). Non-fatal, sends a Slack alert. The DB trigger was dropped (`20260919000001`) | **Partly:** RLS deny only; the service role can update or delete | clinic users; ops | never deleted |
| `treatment_proposal_events` | proposal libraries; non-fatal | Yes (`20261024000002:211-220`) | clinic roles; ops | never deleted |
| `adapter_submissions` (the pharmacy-disclosure record) | `createSubmissionRecord` is **fatal** before a send; later updates are non-fatal | No (updated by the adapters) | clinic users of the order; ops | payload nulling planned, not live |
| `webhook_events`, `pharmacy_webhook_events` | webhooks | No | service role | planned, not live |
| `sms_log` | SMS senders; non-fatal | No | clinic users of the order (intake rows: nobody) | planned 1826 days, not live |
| `ehr_sync_events`, `patient_field_changes` | the claim insert is fatal (503); the rest non-fatal | No (`patient_field_changes` cascades on patient delete) | clinic_admin / clinic users; ops | none |
| Append-only (triggers): `retention_runs`, `legal_holds`, the agreement acceptances, onboarding events, `ingredient_compounding_history`, `proposal_choice_items`, `ledger_entries`, `payable_events`, `reconciliation_runs` | | Yes | | |

Every trigger can still be disabled by the table owner. There is no off-database copy and no hash chain.

### Coverage of PHI paths

Logged means a `phi_access_log` row.

| Path | Logged |
|---|---|
| `/api/orders` POST, `/[id]` PATCH/DELETE, `/record`, `bundlable-siblings`, checkout, group links, `reassign-to-me`, batch sign and its check, `compliance-check`, refill (API and page), margin and sign pages | yes |
| `/api/patients` POST, `/allergies`, `/intake-link`, `/duplicate-flag`, `/import`, `/patient-phases`, `/ops/orders/[id]/detail`, `settings/access-log` | yes |
| `/ehr-changes` | yes, only when there are rows |
| `/face-sheet` | yes, with no patient. The Anthropic disclosure is not recorded |
| `/dashboard` server render | yes, but **one row with no patient ids** |
| `/new-prescription` patient picker, `/api/practice` | yes, no patient ids |
| batch sign / proposal sign with several patients | yes, no patient ids |
| **Dashboard 30-second poll** (`orders-dashboard.tsx:201-209`, browser client: names, phone) and the **drawer timeline** (`order-drawer.tsx:357-360`) | **no**: browser reads through RLS |
| any direct PostgREST read by a signed-in user | **no** |
| `new-prescription/search?editOrder=` (`loadDraftContext`: name, DOB, phone, allergies) | **no** |
| `/api/favorites` (favorites pinned to a patient) | **no** |
| `/api/patients/import/parse` and `/validate` (the CSV is echoed back) | **no** |
| `/api/ops/fax` and the ops fax page | **no**. Queued `ops-fax-viewer-documo` logs `view/inbound_fax` with a NULL clinic, so the rows are invisible to every app user |
| `/api/ops/orders/[id]/action` | **no** (`order_status_history` only) |
| proposals send, cancel and events | **no** (`treatment_proposal_events` and `sms_log` only) |
| intake, join and plan token routes (patient actor), and the Keragon EHR webhook | **no**. Plan views after the first are not recorded at all |
| queued `/api/clinical-statements` (`clinical-difference-saved`) | **no** |

**Disclosures outside the app:**
- Pharmacy sends (crons, adapters, fax via Documo) are recorded only as updatable `adapter_submissions` rows with no actor.
- OpenAI screenshots and Anthropic face sheets are not recorded.
- SMS are recorded in `sms_log`.

**Access log UI** (`settings/access-log/page.tsx`):
- clinic_admin only;
- filters by patient and date;
- 200 rows, no paging, no patient or order column, no export;
- there is no ops-side viewer.

**Queued:**
- No new logged routes in any bundle (the count of `logPhiAccess` calls is the same).
- `security-followups-2` (ad64b442) makes the IP source trustworthy. On main, `clientIp` takes the first `x-forwarded-for` hop, which the client can spoof.

**Depends on vendors:**
- Supabase: the only copy of the logs; backups; owner access; its auth audit log of logins.
- Vercel: runtime logs.
- Sentry.

No BAA is signed.

**Gaps:**
- B14, the coverage gaps, each code S-M:
  1. move the browser PHI reads behind logged server routes (or rely on Supabase API logs under a BAA);
  2. log list views with `logPhiAccessMany` and the displayed patient ids;
  3. log the unlogged server paths listed above, with a test that fails for any patient or order route that does not log;
  4. allow `patient`/`system` actors for the token links, and log denied attempts;
  5. write an append-only disclosure row per external send.
- B15 and B16.
- Not blocking:
  - make `order_status_history` and the other mutable logs append-only for the service role (code M);
  - `epcs_audit_log` is readable by any clinic role (restrict it to admins; code S).

---

## 164.312(c)(1) Integrity (required)

**On main**
- **Signed-order freeze.** `prevent_snapshot_mutation` (BEFORE UPDATE on `orders`, latest in `20261012000001_compounding_status.sql:156-183`) blocks changes once `locked_at` is set. Frozen columns:
  - the price, medication, pharmacy, NPI, signature-hash and shipping-address snapshots;
  - `clinical_difference`, `diagnosis_code`, `diagnosis_text`;
  - `locked_at`.
  - It fires for every role, the service role included.
- **No deleting signed orders.** `orders_no_delete_signed` and `orders_no_truncate` (`20261011000001:170-191`).
- **Compare-and-swap status changes.** `casTransition` (`src/lib/orders/cas-transition.ts:76-130`): `canTransition`, then `.eq('status', expected)`, then history on a live change.
  - Other compare-and-swap writers: batch sign (`batch-sign.ts:894`), payment expiry, ops reroute, proposal cancels.
  - The state machine is enforced in the app only.
- **Every public table has RLS.** The 20261014000001 migration fails if a table has no RLS or no `pharmacy_admin_scope`.
- **Input validation.** Per-route checks only on main (no shared validator).

**Queued**
- `rls-user-write-lockdown-v2` (000004) closes B4.
- `state-machine-enforcement` (in `bundle-features`): the actor role and required fields are checked in the UPDATE predicate, and proposal cancels go through `casTransition`.
- `api-input-validation` (all bundles): `src/lib/api/input.ts` (zod v4; 400 with field names, values never echoed), in 56 of 138 routes.

**Depends on vendors:** Supabase runs the triggers and RLS and keeps the data durable. No BAA is signed.

**Gaps:**
- B4, B5 and B6.
- Not blocking:
  - a database transition guard: a trigger that also writes history (code M);
  - status changes and their history in one transaction (code M);
  - service-role append-only protection on the mutable logs (code M).

## 164.312(c)(2) Mechanism to authenticate ePHI (addressable)

**On main**
- **Signature hash.** `SHA-256(signature.dataUrl + ':' + signedAt)` (`src/lib/orders/batch-sign.ts:846`), stored in the frozen `provider_signature_hash_snapshot`, in `providers.signature_hash` (overwritten on every signing), and in the history metadata. **It covers no Rx field, and the image is not kept.**
- **Agreement acceptances.** They store `text_sha256` of the exact text (`src/lib/agreements/clinic-agreements.ts:131`). This is the one content-authenticating hash in the app.
- **Inbound webhook authenticity:**

| Source | Method | Replay window |
|---|---|---|
| Stripe | `constructEvent` | 300 s, plus dedup |
| Documo | HMAC-SHA256 (`lib/documo/client.ts:85-105`) | none (dedup only). An empty signature header makes the route answer 500 on main |
| Pharmacy | HMAC with the secret from Vault | none (dedup) |
| Twilio | `validateRequest` | none |
| Slack | v0 HMAC | 300 s |
| Keragon | HMAC over the timestamp and body | 300 s |

- **Files.** No checksums: Rx PDFs are uploaded with `upsert: true` (`tier4-fax.ts:283-288`).

**Queued:** `bundle-security` makes a bad Documo signature a 400.

**Gaps:**
- B7.
- Not blocking:
  - store a SHA-256 of each sent PDF (code S);
  - a hash chain on the audit logs (code M);
  - signed timestamps on webhooks where the vendor supports them (code S).

---

## 164.312(d) Person or entity authentication (required)

**On main**
- **Password sign-in.** It runs in the browser, straight to Supabase (`src/app/login/page.tsx:67`), with a generic error message.
- **MFA.** Supabase TOTP factors, read from the `aal` claim in middleware (`src/middleware.ts:395-416`, `getClaims()`). The rules are in `src/lib/auth/mfa.ts`:
  - `MFA_ROLES` covers every staff role (:28);
  - `ALWAYS_MFA_ROLES = ['pharmacy_admin']` (:35);
  - **the switch to require MFA for all staff is env `REQUIRE_MFA=true`** (`src/lib/env.ts:77`; it must be exactly `'true'`; `.env.example` sets `false`);
  - per account: `MFA_ENFORCED_EMAILS`;
  - a user who has a factor is challenged even when MFA is not enforced.
  - Enrollment and challenge: `src/app/mfa/_components/mfa-enroll.tsx`, `mfa-challenge.tsx`.
  - No lost-device reset in the app (it is done in the dashboard).
  - **No RLS policy checks `aal`** (B3).
- **EPCS TOTP.** `/api/epcs` has setup, verify, status and audit. Verify has no rate limit and failed attempts are not logged. `verifyProviderTotp` is unused. Batch sign has no TOTP step because controlled substances are refused.
- **Machine callers:**
  - cron: `Bearer CRON_SECRET` (`src/lib/cron/auth.ts`, a plain `!==` on main);
  - webhooks: signatures (see c(2)).

**Queued:**
- `security-followups-3` (in `bundle-security`): a constant-time compare (`safeEqual`) for the cron and internal tokens.
- Nothing queued enforces MFA or adds `aal` to RLS.

**Depends on vendors:** Supabase Auth (password hashing, MFA, rate limits, hosted MFA settings). No BAA is signed.

**Gaps:**
- B2 and B3.
- Not blocking:
  - a lost-device MFA reset runbook (policy);
  - a limit on EPCS verify attempts (code S, while EPCS is off).

---

## 164.312(e)(1) Transmission security (required)

**On main**
- **Headers.** `src/lib/security/headers.ts:36-43`, applied by `next.config.ts:15-17`:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains` (no `preload`, on purpose, :37);
  - `X-Frame-Options: DENY`, nosniff, `Referrer-Policy: strict-origin-when-cross-origin`.
- **CSP and Permissions-Policy.** The middleware (`src/middleware.ts:68-79`) adds a per-request nonce CSP (`buildCsp`, `headers.ts:82-113`) and a Permissions-Policy (:115-136):
  - script-src is self plus the nonce;
  - connect-src is self, Supabase, Sentry, and Stripe on checkout only;
  - frame-ancestors `'none'`; form-action self; upgrade-insecure-requests over https;
  - camera only on `/intake`, payment only on `/checkout`.
- **Platform.** The HTTP-to-HTTPS redirect is Vercel's own behavior; `vercel.json` sets no headers.
- **Outbound.** Every vendor host is hardcoded https: Documo, Twilio, Stripe, Slack, PagerDuty, Anthropic (SDK), and OpenAI (`tier2-portal.ts:90`). The exceptions are the pharmacy endpoints from DB config:
  - Tier 1 `fetch(config.base_url + path)` (`tier1-api.ts:199`) and the Tier 2 `page.goto(config.portal_url)` are not checked for https at send time (only at onboarding and catalog sync);
  - Playwright `ignoreHTTPSErrors` is off unless `PLAYWRIGHT_IGNORE_HTTPS_ERRORS=true`.
- **Fax.** Documo pulls the Rx PDF through a 1-hour Supabase signed URL (`tier4-fax.ts:297`); the fax leg is the PSTN.
- **SMS.** Carrier plaintext with minimal content (`lib/sms/templates.ts:87-142`: first name, "Dr. {lastName}", link; no drug or clinic), and opt-in is enforced.
- **Email.** The app sends none.
- **Kill switch.** Nothing goes to a pharmacy unless `PHARMACY_SUBMISSIONS_ENABLED` is exactly `"true"` (`lib/adapters/submission-switch.ts:34-40`).

**Queued**
- `bundle-security`: `Referrer-Policy: no-referrer`, `X-Robots-Tag` and no-store on token paths.
- `ops-fax-viewer-documo`: inbound fax PDFs fetched from Documo over https.
- `middleware-to-proxy`: no change to headers.

**Depends on vendors:** Vercel TLS and certificates; Supabase TLS (and SSL enforcement for direct DB connections); each vendor's TLS; the PSTN for fax; carriers for SMS. No BAA is signed.

**Gaps:**
- B17.
- Not blocking:
  - HSTS preload / apex coverage (owner decision);
  - fax and SMS documented as accepted channels in the risk analysis (policy).

### 164.312(e)(2)(i) Integrity controls (addressable)
- **On main:** TLS everywhere; signed webhooks (table in c(2)); a nonce CSP.
- **Queued:** `bundle-security` constant-time compare.
- **Gaps (not blocking):**
  - Documo replay protection and the empty-signature 500 (fixed on bundles);
  - Twilio replay: dedupe `MessageSid` (code S).

### 164.312(e)(2)(ii) Encryption (addressable)

**In transit:** as in (e)(1). Everything is https except the PSTN fax and SMS legs, and a misconfigured pharmacy URL (B17).

**At rest, app level:** the EPCS TOTP encryption (see a(2)(iv)), keyed hashes, token hashes, and Vault for secrets. Storage buckets:
- `prescription-pdfs` (`20260318000010`), `adapter-screenshots` (`20260318000013`) and `pharmacy-license-documents` (`20261014000001`) are all private, reached by service role or signed URL;
- `fax-pdfs` is referenced in `src/lib/fax/map-fax-row.ts:24-26` but created by no migration (queued `ops-fax-viewer-documo` removes the reference).

Patient PHI columns, `sms_log` bodies and Storage files have no app-level encryption.

**At rest, vendor level:** Supabase Postgres, Storage, Vault, backups and PITR, and Vercel logs. This is vendor encryption, not code. No BAA is signed.

**Gaps:** B1 (Supabase and Vercel BAAs and HIPAA configuration).

---

## 164.308(a)(5)(ii)(C) Log-in monitoring (addressable)

**On main**
- Sign-in and the MFA challenge go from the browser to Supabase, so the app never sees them. There is no failed-login logging, alerting or lockout in code. `last_sign_in_at` is shown on the team list (`src/lib/team/team.ts:46-47`).
- Rate limits are in memory per Vercel instance (`src/lib/security/rate-limit.ts`):
  - covered: sign-up 5 per 15 min; invite accept 10 per 15 min; join 20 per hour; plan; face sheet;
  - **none in the app** for login, the MFA challenge, EPCS verify and intake POST.

**Queued:**
- `rate-limit-db` (000007): shared limiter counts (login and MFA still not covered);
- `security-followups-2`: a trustworthy client IP;
- `signup-squatting` (000006): limits on duplicate-email probing.

**Depends on vendors:** Supabase Auth rate limits and its auth audit log (`auth.audit_log_entries`, retention per plan); Vercel logs. No BAA is signed.

**Gaps:**
- B12.
- Not blocking: hosted Supabase Auth rate limits and lockout (vendor config).

## 164.308(a)(5)(ii)(D) Password management (addressable)

**On main**
- **Rule.** `passwordProblem` (`src/lib/auth/create-login.ts:18-26`): at least 12 characters and at most 72 bytes; no composition or breach checks in the app.
  - Used by self sign-up, clinic invite accept and pharmacy invite accept.
  - `POST /api/providers` has its own length-only check, and the password is chosen by the admin (`route.ts:45,103,196`).
- **Reset and change.** None:
  - no `resetPasswordForEmail` or `updateUser({password})` anywhere in `src`;
  - no "forgot password" link;
  - `/auth/callback` only exchanges a code.
- **Supabase settings.** `supabase/config.toml` has no password settings; the hosted settings are not in the repo.
- **Demo passwords** are in source and docs (B9).

**Queued:** nothing.

**Depends on vendors:** Supabase Auth (bcrypt, hosted password policy, leaked-password protection, a paid-plan setting). No BAA is signed.

**Gaps:**
- B9, B10 and B11.
- Not blocking: turn on leaked-password protection and a minimum length of 12 in hosted Supabase (vendor config).

---

## Supporting evidence

### RLS per PHI table (on main, with queued changes)

All read policies use `auth.jwt()->'app_metadata'`.
- **CLINIC** means `clinic_id` equals the JWT clinic.
- **PAS** is the restrictive `pharmacy_admin_scope` on every table (`20261014000001:296-332`), re-applied last in every migration up to 000009.

| Table | Read | User writes (main) | Queued |
|---|---|---|---|
| patients | CLINIC, any role | **insert / update allowed** | 000004 drops and REVOKEs |
| orders | `orders_role_aware_select` (ops; admin/MA in CLINIC; the provider's own); provider plus the client-set header `x-provider-view-mode` (not a security boundary) | **insert / update allowed**; `ops_admin_update_orders` (TO PUBLIC); freeze, no-delete-signed and no-truncate triggers | 000004 drops and REVOKEs; 000008 adds indexes |
| providers | CLINIC | **update allowed** (the insert policy checks a top-level claim that is never set) | 000004; 000006 adds `npi_claimed` |
| provider_npi_verifications, provider_state_licenses | via providers | **clinic_admin FOR ALL** | 000004 |
| payment_groups | CLINIC | **insert / update allowed** | 000004 |
| order_status_history, sms_log, adapter_submissions, webhook_events | via orders / service role | deny (policy only) | none |
| adapter_submissions | **clinic users of the order can read unredacted `response_payload`** | deny | none (B22) |
| adapter_submission_debug_payloads | service role only (full PHI, written only if `PHI_DEBUG_ENABLED=true`; purged after 24 h) | none | none |
| patient_intake_links, clinic_signup_links | CLINIC | none (REVOKEs) | none |
| treatment_proposals and children | clinic roles in CLINIC; ops | REVOKE; append-only triggers on events and choice items | none |
| phi_access_log | clinic_admin in CLINIC | none (append-only) | 000003 adds `fax_id` |
| epcs_audit_log | providers in CLINIC (any role) | append-only | none |
| provider_favorites (patient-scoped), protocol tables, patient phases | via CLINIC | service role | none |
| ehr_sync_events, patient_external_ids, patient_field_changes, ehr_connections | clinic_admin / CLINIC; ops | REVOKEs | none |
| clinics | CLINIC | REVOKEd (000001) | none |
| saved_clinical_statements | n/a on main | | 000009: clinic roles in CLINIC and ops read; REVOKE user writes; soft delete |

Views: the dead-letter and prescribing-history views have SELECT revoked from users; the `v_protocol_*` views are security invoker.

Not blocking: Supabase's default TRUNCATE grants remain on PHI tables with no TRUNCATE trigger (PostgREST cannot TRUNCATE). Fix: one REVOKE migration.

### Service-role use

`createServiceClient` (`src/lib/supabase/service.ts`) bypasses RLS and is imported by 181 non-test files.

| Who uses it | How it is scoped |
|---|---|
| Clinic routes and SSR pages | `getUser()`, then the clinic from claims, then an explicit `.eq('clinic_id')` (e.g. `api/orders/[orderId]/route.ts:86-93`) |
| Token routes | by token hash, then that row's clinic |
| Webhooks | by signature, then by event or connection |
| Crons | `CRON_SECRET`; cross-clinic by design |
| Ops | `ops_admin` |

**No clinic-facing service-role read of a PHI table without a clinic filter was found.**

**F-3 ("dashboard SSR never uses the service role") does not hold literally.** `dashboard/page.tsx:202` calls `isPortalOnboardedClinic(createServiceClient(), clinicId)`, which reads the clinic's onboarding status and an invite count: no PHI. The PHI reads use the session client. Fix: an RPC, or update the rule and its test. Not blocking.

### Backups and restore

- **In the repo:** only the local `supabase/config.toml` (no backup settings) and down migrations (schema rollback). No backup, export or restore script, and no restore test.
- **Docs disagree:**
  - `docs/software-factory-updates/CompoundIQ_Data_Layer.md:34` says PITR is on with 30 days;
  - `docs/archive/source/launch-kit/pre-launch-checklist.md:286-295` says it is "Not started";
  - `docs/technical/OPS-RUNBOOK.md:249` says "Check if PITR is needed".
- **Nothing in the repo proves backups or PITR are on.** Both are Supabase plan features. Database backups do not cover Storage objects (confirm with Supabase).

Gap: B21.

### Data retention: counts only, deletes nothing

- **The retention cron is a dry run.** `src/app/api/cron/retention/route.ts:28-29` returns `{ dry_run: true, ... }`.
  - `src/lib/retention/policies.ts`: every policy is `live: false`; the runner only runs counting selects and inserts `retention_runs` rows with `mode: 'dry_run'` and `rows_affected: 0` (:251-292).
  - The DB CHECK `(mode = 'live' OR rows_affected = 0)` backs this up.
  - `RETENTION_ENABLED` is reported but not acted on.
  - `NEVER_RETENTION_TARGETS` includes `phi_access_log`, `epcs_audit_log`, `patients`, `order_status_history` and the ledgers.
- **What does delete:**
  - `purge-phi-debug` (hourly) hard-deletes `adapter_submission_debug_payloads` older than 24 h (`route.ts:44-47`), ignoring legal holds;
  - `screenshot-cleanup` (hourly) removes portal screenshots older than 72 h **only when `RETENTION_ENABLED === "true"`** (`route.ts:66,102-118`), and the prod value is unknown;
  - a few app hard deletes: favorites, onboarding rollbacks, the Keragon undo of a just-created patient, license files, and POC seed rows.
- **Soft deletes:** draft orders, catalog rows, `deleted_at` on patients, providers and clinics, and saved statements (queued). No app path disposes of a patient's data.

Not blocking:
- turn the reviewed policies live one at a time;
- confirm `RETENTION_ENABLED` or make screenshot deletion unconditional;
- a per-clinic export and dispose procedure;
- legal holds for `purge-phi-debug`.

### Breach detection and alerting
- **Sentry.** `src/lib/sentry/phi-scrubber.ts`:
  - redacts by key (names, DOB, email, phone, address, allergies, sig, body, payload, auth headers, cookies);
  - redacts by pattern (phone, NPI, 12 drug names, Stripe ids and keys, email, SSN, dates);
  - drops request bodies and cookies, reduces `user` to id, clinic and role;
  - `sendDefaultPii: false`, Replay off, `tracesSampleRate` 0.1 in prod.
  - **There is no `instrumentation.ts` or `instrumentation-client.ts` on main or any bundle,** so with `@sentry/nextjs` ^10 on Next 16 (Turbopack) the SDK is very likely never initialized. Confirm in the Sentry project.
  - On main, transactions are not scrubbed. Queued `bundle-security` adds `phiBeforeSendTransaction`, token-URL scrubbing, and `withApiErrors` (logs the route, method and error name; returns a generic 500; reports to Sentry).
- **Slack.** Alerts are built from an allow-list (`src/lib/slack/ops-alert.ts`, plus a static test), so they carry ids and enums only.
- **PagerDuty.** Ids and enums only (`src/lib/pagerduty/client.ts`).
- **SLA crons.** `sla-check` and `sla-refire` every 5 minutes; a daily digest.
- **Anomaly detection.** None: no failed-login alerting, no unusual-PHI-access alerting, and no written log review.
- **Console logs** (Vercel) carry patient and order UUIDs, raw DB error messages, some ops emails, and the raw IP in the Stripe webhook. No patient name, DOB, phone or address was found in a log line.

Gaps:
- B20 and B16 (review);
- the Vercel BAA (B1);
- not blocking: a cron alert on PHI-read volume and failed-MFA bursts (code M).

---

## Vendor map

**No BAA is signed with any vendor. Production holds demo data only.**

| Vendor | ePHI that reaches them (code) | Env switches | BAA needed? | Configuration compliance depends on |
|---|---|---|---|---|
| Supabase | All of it: Postgres, Storage (Rx PDFs, screenshots, license documents), Vault, Auth | `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | yes | HIPAA add-on (plan), encryption at rest, PITR and backups, SSL enforcement, network restrictions, region, log retention, session timeout and MFA settings |
| Vercel | All traffic; function logs (UUIDs, DB errors) | none | yes | BAA tier, log retention and drains, function region (no `regions` in `vercel.json`), preview deployment protection |
| Twilio | Patient phone, first name, provider last name, links, tracking URL (`lib/sms/templates.ts`, `sender.ts`); inbound replies | `TWILIO_ENABLED`, `TWILIO_*` | yes | BAA for Programmable Messaging; message body retention |
| Documo | Full Rx PDF through a 1-hour signed URL; inbound faxes (queued viewer) | `PHARMACY_SUBMISSIONS_ENABLED`, `DOCUMO_*` | yes | BAA; fax retention. The comment at `tier4-fax.ts:26` says "Documo is BAA-covered", which is not true yet |
| Anthropic | The whole face sheet (`lib/face-sheet/extract.ts:157-180`) | `FACE_SHEET_AI_ENABLED` (**on unless `"false"`**, `face-sheet/config.ts:26`), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | yes | BAA with zero data retention, covering the beta features used |
| OpenAI | Portal confirmation screenshots (`tier2-portal.ts:78-125`) | `PHARMACY_SUBMISSIONS_ENABLED`, `OPENAI_API_KEY` | yes | BAA with ZDR, or remove the feature |
| Keragon | Inbound patient demographics (`/api/integrations/keragon/patients`) | per-clinic connection and Vault secret | yes (clinic and Keragon) | Keragon HIPAA plan |
| Sentry | intended: scrubbed errors (very likely nothing sent today) | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_*` | yes, if PHI can pass the scrubber | BAA tier, scrubbing rules, IP storage off, retention |
| Stripe | Amount and ids only. The C7 allow-list `lib/stripe/phi-guard.ts`, with a static test; no `receipt_email`; card data in Stripe's PaymentElement | `STRIPE_*` | no (payment processing) | keep the guard |
| Slack, PagerDuty | ids and enums only (allow-lists) | `SLACK_*`, `PAGERDUTY_ROUTING_KEY` | no, while PHI-free | keep the allow-lists |
| GitHub Actions | synthetic E2E data only; Playwright artifacts kept 14 days; the prod `DATABASE_URL` secret for migrations (`deploy.yml:76-77`) | `E2E_*`, `DATABASE_URL` | no, while CI never sees real PHI | a protected `deploy` environment with reviewers |
| Pharmacies | the full order | `PHARMACY_SUBMISSIONS_ENABLED` | no (covered entities; treatment disclosure) | https transport (B17) |
