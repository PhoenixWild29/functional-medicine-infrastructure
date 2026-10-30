# Decisions before real patient data, 2026-10-25

AI-facing brief (task A-2026-10-25-16). The orchestrator turns it into a Word document for Sam.

Twelve items. Each gives what the code does today, the options with their effort and risk, what the item blocks, and a recommendation with one line of why.

Facts were read from origin/main (2696ff24) unless a branch is named. Branch heads used:

| Branch | Head |
|---|---|
| settings-notifications | c1d9e765 |
| state-machine-enforcement | b0bd60f8 |
| clinical-difference-saved | d21721a0 |
| clinic-help | 96f74e33 |
| test-data-cleanup-script | 52f8f709 |
| security-followups-3 | ea321e84 |

Effort scale: S is under a day, M is 1 to 3 days, L is a week or more.

## Summary

| # | Decision | Recommendation |
|---|---|---|
| 1 | How to tell demo from real records | A separate prod Supabase project for real patients; demo stays where it is |
| 2 | Two-step sign-in for all staff | Turn on `REQUIRE_MFA=true` before the first real clinic |
| 3 | Data retention deletes | Keep dry run; switch deletion on per policy only after item 1 |
| 4 | Notification preferences | Build B's clinic-level design (M) after Twilio is decided |
| 5 | Texting on prod | Do the BAA and A2P 10DLC now (weeks of lead time); switch on after them |
| 6 | Patient receipt email | Keep texts only for launch; add a BAA'd email provider later |
| 7 | Pharmacy home page | Keep fax/API/portal intake; build a minimal live-pharmacy page later (M) |
| 8 | TIER_3_HYBRID | Leave it disabled |
| 9 | GLP-1 clinical difference pre-selection | Do not pre-select; ship saved statements instead |
| 10 | State machine rules left open | Keep SHIPPED tracking unenforced; fix the portal-poll mapping |
| 11 | Who may delete saved statements and favorites | Only the creator or a clinic admin |
| 12 | Support contact in Help | Give an address now; a one-line change |

---

## 1. Demo vs real records

- **Today:** nothing marks a clinic, pharmacy or patient as demo. Demo data is recognised four other ways:
  - fixed UUID prefixes (clinics `a1000000-…`, pharmacies `a4000000-…`);
  - Stripe placeholder ids `poc_placeholder_<clinic_id>` (`src/lib/stripe/demo-account.ts`);
  - `source = 'demo_seed'` on NPI and license rows only;
  - `metadata.poc_seed` on adapter submissions.
- **What acts on demo data today:**
  - Payouts: `DEMO_PAYOUTS_ON_APPROVAL` is on unless exactly `"false"`, so **every newly approved clinic, real or not, gets a demo payout account**. Its charges stay on the platform account (`src/lib/clinics/demo-payouts.ts`, `api/checkout/payment-intent/route.ts`).
  - Pharmacy submissions: `PHARMACY_SUBMISSIONS_ENABLED` is one global switch (`src/lib/adapters/submission-switch.ts`).
  - Texting: `TWILIO_ENABLED` and opt-in, with no demo/real distinction.
  - Practice reports: count everything by `clinic_id` (`src/lib/practice/load.ts`).
  - The cleanup script (test-data-cleanup-script) matches exact names and emails, and *refuses* to touch demo prefixes.
- **Options:**
  - **(A) An `is_demo` flag on clinics, inherited by their patients and orders, and on pharmacies.** M, plus checks in every sender: payouts, submissions, texting, reports.
    - Risk: one missed check sends a demo order to a real pharmacy, or texts a demo phone.
  - **(B) A separate prod project for real patients; demo stays on today's.** M, mostly setup: a new Supabase project, Vercel env, Stripe Connect, then run the migrations.
    - Risk: two environments to keep in step. Demo can never leak into real, because the data is physically apart.
  - **(C) Delete all demo data at go-live.** S to M (extend the cleanup script to demo prefixes).
    - Risk: loses the sales and demo environment. One wrong match deletes real rows.
- **Blocks:** turning on submissions, texting and retention (item 3) with real data present, and real payouts.
- **Recommendation: B.** It is the only option where a demo order can never reach a real pharmacy or a demo phone. Also set `DEMO_PAYOUTS_ON_APPROVAL=false` on the real project.

## 2. Two-step sign-in for all staff

- **Today:**
  - The switch is `REQUIRE_MFA` (on only if exactly `"true"`, `src/lib/env.ts`). There is also `MFA_ENFORCED_EMAILS`, a per-email list.
  - Both are off in `.env.example`.
  - It covers provider, medical_assistant, clinic_admin and ops_admin. Since 2026-10-30 pharmacy_admin follows the same rule as every other role (no longer always enforced; `src/lib/auth/mfa.ts`).
- **What turning it on does:**
  - On their next page, every staff user with no verified authenticator is sent to `/mfa/enroll?redirectTo=…`. API calls get 401 `MFA_ENROLLMENT_REQUIRED` (`src/middleware.ts`).
  - Users who already have a factor get the `/mfa/challenge` on sign-in. Patients are never affected.
  - **Demo accounts are not exempt.** ops@compoundiq-poc.com and the Sunrise logins in README / `scripts/seed-poc.ts` would each have to enrol an authenticator app.
- **Options:**
  - **(A) Turn it on now.** S (an env change). Risk: the demo logins need an authenticator each, or shared ones held by the demo runner.
  - **(B) Enforce named accounts only, through `MFA_ENFORCED_EMAILS`.** S. Risk: new staff are missed unless added by hand.
  - **(C) Leave it off until the first real clinic.** S. Risk: forgotten at go-live.
- **Blocks:** any real PHI access by staff. It is a HIPAA access-control expectation.
- **Recommendation: A on the real project** (item 1B) from day one. Leave it off on demo. All real staff are then covered with no list to maintain.

## 3. Data retention

- **Today:**
  - The daily cron `api/cron/retention` (09:00 UTC) runs 9 policies (`src/lib/retention/policies.ts`):
    - abandoned unsigned drafts after 90 days;
    - webhook and adapter payloads nulled after 30 days;
    - Rx PDFs after 90 days;
    - `sms_log` after 5 years;
    - sent ops alerts, acknowledged clinic notifications and SLA notification log after 1 year.
  - **It only counts.** Every policy is `live: false`, and runs are written as `dry_run`, rows 0.
  - Never targets: phi_access_log, epcs_audit_log, patients, order history, the ledger and payables, and proposals.
  - Legal holds exist (`legal_holds`, clinic or patient scope, release only). Held rows are left out, and the run stops if holds cannot be read.
- **What would turn deletion on:** `RETENTION_ENABLED=true` **and** a code change that marks a policy live and adds its delete. The flag alone does nothing to this cron.
  - Two crons already delete:
    - screenshot-cleanup (72 h) does so when `RETENTION_ENABLED=true`;
    - purge-phi-debug (24 h) always does.
- **Options:**
  - **(A) Keep dry run until real data is separated (item 1), then switch policies on one by one.** S per policy.
  - **(B) Switch all 9 on now.** M. Risk: deletes demo drafts and PDFs the demo relies on, and with real data mixed in it cannot tell them apart.
  - **(C) Never delete; archive instead.** L.
- **Blocks:** nothing urgent. Storage and PHI minimisation grow over time.
- **Recommendation: A.** Counting is already running and shows what each policy would delete before anything is deleted.

## 4. Notification preferences

- **Today:** Settings › Notifications says "Coming soon" (`src/app/(clinic-app)/settings/page.tsx`).
  - settings-notifications (B) adds a read-only page: a catalog of what is sent, when, and to whom.
  - Found:
    - 5 patient texts, all needing opt-in and Twilio;
    - shipping and delivered texts are written but never sent;
    - no staff email of any kind;
    - `clinic_notifications` rows are written but never shown.
- **B's proposed design (not built):**
  - `clinics.notification_prefs jsonb NOT NULL DEFAULT '{}'`, keyed by catalog id, with a missing key meaning on.
  - The payment link and safety and security notices can never be turned off.
  - Only a clinic admin writes it, through `POST /api/settings/notifications`.
  - The senders check it and log `clinic_off`.
  - Any later per-user settings go in `user_metadata`.
  - No effort is stated in B's report. My estimate: **M** (a migration, an API, toggles, sender checks, tests).
- **Options:**
  - **(A) Build B's design.** M.
  - **(B) Keep the read-only catalog only.** Zero. Clinics cannot turn anything off.
  - **(C) Per-user preferences first.** L.
- **Blocks:** nothing until texting is on (item 5). Also pending: an in-app inbox for `clinic_notifications`, and whether to send the shipping and delivered texts.
- **Recommendation: B now, A once texting is live.** With no texts sent today, toggles would switch off nothing.

## 5. Texting on prod (Twilio)

- **Env vars (names only):** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_WEBHOOK_SECRET` (signs inbound webhooks), `TWILIO_ENABLED`.
  - Texting runs only when the first three are set and `TWILIO_ENABLED` is not `"false"` (`src/lib/twilio/config.ts`).
  - Prod has no Twilio today.
- **What starts sending, always to the patient's phone:**
  1. The payment link at sign (`batch-sign.ts`).
  2. The 24-hour reminder and 3. the 48-hour reminder (`cron/sla-check`).
  4. Payment confirmation (Stripe webhook).
  5. The intake link, when a patient is added or the link is resent.
  6. The plan (proposal) link.
  7. The HELP auto-reply.
- **Consent:**
  - Payment and proposal texts need `sms_opt_in`.
  - **Intake links do not.** They are blocked only after a STOP, by design (`src/lib/intake/sms.ts`).
  - STOP and START are handled (`src/lib/sms/inbound.ts`).
  - Limit: 5 texts per phone per day.
- **Needs:**
  - A **Twilio BAA** (listed as a to-do in the launch checklist).
  - **A2P 10DLC brand and campaign registration**: about $44 and 1 to 3 weeks' review (`docs/archive/source/launch-kit/pre-launch-checklist.md`).
  - The env vars, and the inbound webhook URL set in Twilio.
- **Options:**
  - **(A) Start the BAA and 10DLC now, switch on when approved.** S of work, weeks of waiting.
  - **(B) Stay off; clinics copy links by hand or use QR codes.** Zero. More staff work.
- **Blocks:** automatic payment and intake links to patients, and item 4.
- **Recommendation: A.** The approval lead time is the critical path, and everything to send is already built and consent-checked.
  - Decide first whether intake links should need opt-in: today they do not.

## 6. Patient receipt email

- **Today:** checkout asks for an optional email.
  - The check is syntax only: at most 254 characters, `a@b.c`, not `.invalid` (`api/checkout/payment-intent/route.ts`, `payment-group-intent/route.ts`).
  - It is **not sent to Stripe** (no BAA, compliance C7), **not stored, and nothing emails the patient**. The app has no email provider.
  - The checkout page tells the patient to expect texts instead.
- **Options:**
  - **(A) Texts only.** Zero. Depends on item 5.
  - **(B) A BAA-covered transactional email provider** (for example Paubox, or AWS SES under AWS's BAA), with a receipt that contains no PHI. M. Also needs an SPF/DKIM/DMARC domain setup.
  - **(C) Stripe receipts.** S technically. **Not allowed** without a Stripe BAA (C7).
- **Blocks:** nothing, if texting is on.
- **Recommendation: A for launch, B later if clinics ask.** A payment confirmation text already exists and is consent-checked.

## 7. Pharmacy home page

- **Today:** `/pharmacy` redirects to the onboarding wizard (`src/app/pharmacy/page.tsx`).
  - The nav has only Onboarding and Agreements. An approved pharmacy sees "Your pharmacy is approved and live on CompoundIQ." and a read-only wizard.
  - There is **no order queue, status update or payouts page** for pharmacies.
  - Orders reach them by API (`tier1-api.ts`, also used for TIER_3_SPEC), by an automated portal (`tier2-portal.ts`) or by fax (`tier4-fax.ts`), with fax as the fallback.
  - Payables are recorded on the ops side only, and move no money (`src/lib/payments/payables.ts`).
- **What a live pharmacy would need:**
  - a list of its orders and their status;
  - acknowledging or rejecting an order, and adding tracking;
  - its payables statement;
  - contacts.
- **Options:**
  - **(A) No portal; pharmacies work from fax, API or portal as today.** Zero.
  - **(B) A read-only orders and payables page.** M.
  - **(C) A full pharmacy workspace with status and tracking updates.** L. It also feeds item 10's tracking.
- **Blocks:** nothing for launch. Pharmacies already receive orders.
- **Recommendation: A for launch, then B.** The first pharmacies take fax and API orders today, and B is the smallest useful step.

## 8. TIER_3_HYBRID

- **Today:** the enum value exists (`20260317000001_create_enums.sql`). The routing engine fails such an order with `tier3_hybrid_unsupported` (`src/lib/adapters/routing-engine.ts`), and `api/adapters/submit` answers 501.
  - It still appears in labels and filters across ops and the prescriber pharmacy search, which shows it as "Standardized API / Instant" (`api/pharmacy-search/route.ts`).
  - On security-followups-3 the onboarding Ordering step shows it as "Hybrid: Not available yet" (disabled).
  - The canonical docs list only TIER_3_SPEC. No plan exists. It would need a hybrid adapter, an onboarding option and webhook registration.
- **Options:**
  - **(A) Leave it disabled.** Zero.
  - **(B) Build it.** L, with no pharmacy asking for it.
  - **(C) Remove the value and its labels.** S to M (enum change, UI cleanup).
- **Blocks:** nothing.
- **Recommendation: A**, with one small fix: drop "Hybrid" from the prescriber pharmacy-search labels so it is never offered.

## 9. GLP-1 clinical difference pre-selection

- **Today:**
  - Every GLP-1 (semaglutide, tirzepatide, liraglutide, retatrutide) requires a clinical-difference reason and gets the 5 standard reasons (`src/lib/orders/rx-details.ts`, `formulationRxDefaults`).
  - **None is pre-selected, on purpose.** The code comment reads: "C8: never pre-selected. The provider chooses the reason, so a signed prescription records a decision, not a default." Also `src/lib/compliance/compounding.ts`.
  - The shortage reason is allowed only while the product is on FDA's shortage list, and "Other" needs 20 characters.
  - A stale comment above `STANDARD_CLINICAL_DIFFERENCE_OPTIONS` still says "First entry is the pre-selected default". The code does not do that.
- **What was asked:** Gina's email asks for "a spot for that" (`docs/practitioner-feedback/2026-09-11-gina-rooks-email.md`). No explicit pre-selection request was found in her email or the transcript.
- **clinical-difference-saved:**
  - Saved statements per clinic, or per patient: new table `saved_clinical_statements` (migration `20261024000009`, PREPARED, to merge after perf-indexes).
  - Shown under the standard list, patient's first. Picking one fills "Other". Never pre-selected.
- **Options:**
  - **(A) Saved statements, no pre-selection.** Built.
  - **(B) Pre-select the clinic's usual reason per formulation.** S. Risk: a signed Rx then records a default, not a provider's decision, which is the C8 compliance concern.
  - **(C) Pre-select the first standard reason.** S. Same risk, and less accurate.
- **Blocks:** nothing.
- **Recommendation: A.** One click per prescription and the record stays the provider's own decision. Fix the stale comment.

## 10. State machine: rules left open

From state-machine-enforcement (`docs/technical/state-machine-enforcement.md`):
- **Now enforced:**
  - `casTransition` checks the actor's role and the required fields in its UPDATE, and refuses with nothing written.
  - AWAITING_PAYMENT needs the 6 snapshots and `locked_at`; PAID_PROCESSING needs the payment intent.
  - The payment-expiry cron, the ops reroute and the proposal cancels now go through `casTransition`.
- **Left open for Sam:**
  - **SHIPPED without `tracking_number` and `carrier`.** Enforcing it would reject a pharmacy `order.shipped` webhook that has no tracking.
  - **The portal status poll** (`cron/portal-status-poll`) maps portal text to `PHARMACY_READY`, which is not a status, and makes illegal moves from PHARMACY_ACKNOWLEDGED. So Tier 2 orders never advance past PHARMACY_PROCESSING from the poll.
  - Batch sign stays a single UPDATE, outside `casTransition`, so a sign is never partial.
- **Options:**
  - **Tracking:**
    - (A) Leave it unenforced and show "tracking pending" to ops. S.
    - (B) Enforce it, and park tracking-less webhooks for ops to complete. M.
  - **Portal poll:**
    - (A) Fix the mapping to real statuses through legal steps. S to M.
    - (B) Leave it as is. Tier 2 status stays stale.
- **Blocks:** accurate status for Tier 2 (portal) pharmacies.
- **Recommendation: tracking A, poll fix A.** Pharmacies cannot be relied on to send tracking, and the poll bug is a plain defect.

## 11. Who can delete saved statements and favorites

- **Saved statements** (clinical-difference-saved, `api/clinical-statements/route.ts`):
  - Any clinic staff role (clinic_admin, provider, medical_assistant) can delete any statement of their clinic.
  - `created_by` is recorded but not checked. Soft delete, cross-site refused. The code itself says "Narrowing to the creator or a clinic admin is Sam's call".
- **Favorites** (`src/app/api/favorites/route.ts` DELETE, unchanged on favorites-frequent):
  - On main, any signed-in user of the clinic (no role check) can delete any provider's favorite of that clinic. **Hard delete.**
  - security-followups-3 (in bundle-security) adds the cross-site check and the clinic-staff role gate. Still no ownership check, and still a hard delete.
- **Options:**
  - **(A) Keep it as it is.** Zero. Risk: one staff member can wipe a provider's favorites with no undo.
  - **(B) The creator, or the owning provider for favorites, or a clinic admin.** S per route.
  - **(C) Clinic admin only.** S. Clumsy for providers managing their own lists.
- **Blocks:** nothing.
- **Recommendation: B**, plus soft delete for favorites. People manage their own items and an admin can clean up, but nobody silently removes a colleague's.

## 12. Support contact in Help

- **Today (clinic-help):** Help shows "Contact CompoundIQ through your CompoundIQ account contact". `HELP_CONTACT` is in `src/lib/help/topics.ts`.
  - There is no email or phone, and no env var. A test asserts there is no address.
  - The only address in code, integrations@compoundiq.com, is for pharmacy API partners.
- **Options:**
  - **(A) A support email**, for example support@ your domain. S (one line plus the test).
  - **(B) An env var** (for example `NEXT_PUBLIC_SUPPORT_EMAIL`), so prod and demo can differ. S.
  - **(C) Leave it generic.** Zero. Clinics have nowhere to write.
- **Blocks:** clinic self-service when something goes wrong.
- **Recommendation: B.** The address is set per environment, so demo and real point to the right inbox.
