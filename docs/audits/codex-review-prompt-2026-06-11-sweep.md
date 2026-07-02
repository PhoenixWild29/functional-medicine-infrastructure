# Codex Full-Sweep Review Prompt — 2026-06-11

**Scope:** Everything merged or opened on `main` between the previous Codex sweep (2026-06-09, covering PRs #73–#79) and 2026-06-11.

**Branches / PRs to review:**

| PR  | Title                                                                                          | Status  | SHA       |
| --- | ---------------------------------------------------------------------------------------------- | ------- | --------- |
| #80 | docs: Codex review prompt for 2026-06-09 sweep                                                 | merged  | 3ed228f   |
| #81 | fix(phase-c + f3): Codex post-review fix bundle                                                | merged  | e64fa4a   |
| #82 | chore: regen db:types after Phase C Stage 1 migration                                          | merged  | (origin/main) |
| #83 | feat(phase-c stage 3): payment_intent.succeeded group branch in Stripe webhook                 | merged  | (origin/main) |
| #84 | feat(phase-c stage 4+5): multi-Rx Combine and Send + patient group checkout                    | OPEN    | e00f314   |

The Stage 1 + Stage 2 + Stage 2.5 fixes have been live in production since 2026-06-10. Stage 3 (webhook) merged 2026-06-10. Stage 4+5 (PR #84) is open. Feature flag `PHASE_C_GROUPS_ENABLED` is currently UNSET in production — full Phase C is gated until ops flip the flag after #84 merges and smoke passes.

---

## How to Use This Prompt

Copy the section below the divider into Codex. Codex should:

1. Verify Phase C end-to-end correctness across the five stages.
2. Re-audit the F-2/F-3 carryover surfaces (signer identity for group creation, middleware block, RLS).
3. Surface any new vulnerabilities introduced by Stages 3/4/5.
4. Confirm PHI boundaries hold across all new Stripe metadata + checkout-page surfaces.
5. Issue a verdict per PR: PASS / PASS-with-followups / CHANGES-REQUIRED.

Per the project's verify-before-report guardrail: do NOT report a finding without reading the cited line and confirming the behavior. False positives have been more costly than missed findings in prior reviews.

---

## Codex Prompt (copy below)

You are reviewing PRs #80 through #84 of CompoundIQ, a healthcare SaaS prescription platform that ships compounding-pharmacy orders to patients. The prior Codex sweep (2026-06-09) covered PRs #73–#79 and surfaced two CRITICAL findings against PR #79 (solo-PI bypass on grouped orders, missing webhook handling); both were fixed in PR #81 + PR #83. This sweep verifies that the fixes hold AND that the new code paths (Stage 3 webhook, Stage 4 clinic UI, Stage 5 patient UI) ship correctly.

### Repo layout

- Branch under review for #84: `feat/phase-c-stage4-combine-and-send-ui`
- Other PRs are already merged to `main`.
- Tech stack: Next.js 16 App Router, Supabase (Postgres + RLS), Stripe Connect Express, Twilio, Documo, Sentry, deployed on Vercel.
- Database types: `src/types/database.types.ts` (auto-generated; regenerated in PR #82 after Stage 1 migration applied to production).
- POC mode: `process.env['POC_MODE']` and `process.env['PHASE_C_GROUPS_ENABLED']` — exact string `=== 'true'` comparisons.

### Phase C summary

Phase C lets a clinic bundle N AWAITING_PAYMENT orders for the SAME patient + SAME provider into ONE Stripe PaymentIntent. The patient pays once; the webhook atomically transitions all N member orders.

Five stages, all gated behind `PHASE_C_GROUPS_ENABLED`:

| Stage | Surface                                                | PR     |
| ----- | ------------------------------------------------------ | ------ |
| 1     | `payment_groups` table + `orders.payment_group_id` FK  | merged |
| 2     | `POST /api/checkout/payment-group`                     | merged |
| 2.5   | Solo route blocks grouped orders + CAS stamp-back       | merged |
| 3     | Webhook `payment_intent.succeeded` group branch         | merged |
| 4     | Clinic "Combine and Send" UI in order drawer            | #84    |
| 5     | Patient `/checkout/[token]` group flavor                | #84    |

### What changed per PR (read this before diving in)

**PR #80 (merged):** Docs only — the prior sweep prompt. Not a code change. Verify it's complete + accurate as the historical artifact.

**PR #81 (merged):** Codex post-review fix bundle. Five distinct fixes:
1. **Solo route blocks grouped orders** — `src/app/api/checkout/payment-intent/route.ts` now SELECTs `payment_group_id` and rejects with 409 if non-null. Includes a CAS stamp-back predicate `.is('payment_group_id', null)` so a race with concurrent group-creation never double-charges.
2. **Feature flag** — `PHASE_C_GROUPS_ENABLED !== 'true'` returns 503 in `src/app/api/checkout/payment-group/route.ts`.
3. **F-2 carryover for cart** — provider session creating a group must own the orders' provider (`provider.user_id === session.user.id`). Enforced inside `src/lib/payment-group/create-group.ts` (extracted from the route in PR #84; in #81 it lived inline in the Stage 2 route).
4. **F-3 broadening** — `src/middleware.ts` block now matches both `=== '/new-prescription/sign'` AND `startsWith('/new-prescription/sign/')`.
5. **Providers two-step atomic create** — `src/app/api/providers/route.ts` does a clinic existence check (404 if missing, 409 if inactive) before `createUser`, with rollback if either step fails.
6. **Rollback retry hardening** — payment-group rollback retries the order-unlink 3 times before logging CRITICAL.

**PR #82 (merged):** `src/types/database.types.ts` regenerated after Stage 1 migration applied to production. Includes `payment_groups` table + `orders.payment_group_id` + Relationships. Also: `package.json` adds `npm run db:types` script for future regenerations. Verify the regen is faithful (no spurious diffs) and the alias was not accidentally dropped.

**PR #83 (merged):** Phase C Stage 3 webhook. Key files:
- `src/app/api/webhooks/stripe/route.ts` — `handlePaymentIntentSucceeded` now branches on `metadata.payment_group_id` presence. Solo path extracted to `handleSoloPaymentSucceeded`. Group path delegates to `handleGroupPaymentSucceededImpl` in handle-group.ts.
- `src/app/api/webhooks/stripe/handle-group.ts` — dependency-injected group handler:
  - Per-order CAS: AWAITING_PAYMENT → PAID_PROCESSING with metadata `{ stripe_payment_intent_id, payment_group_id }`
  - PI cross-check (group.stripe_payment_intent_id must match event.id)
  - Idempotent on already-PAID group
  - Empty members → mark CANCELLED
  - Per-order failure → group stays AWAITING_PAYMENT for redelivery retry
- HIPAA boundary: solo metadata `{order_id, clinic_id, platform}`; group metadata `{payment_group_id, clinic_id, order_count, platform}`. Zero patient/medication info.

**PR #84 (OPEN — `feat/phase-c-stage4-combine-and-send-ui`):** Stage 4 (clinic UI) + Stage 5 (patient UI). Key files:

Shared library:
- `src/lib/payment-group/create-group.ts` — extracted shared lib. Stage 2 route now delegates. Same validation + DB + Stripe orchestration + 3-retry rollback as before.
- `src/lib/auth/checkout-token.ts` — optional `groupId` on payload; new `generateGroupCheckoutToken` factory. `verifyCheckoutToken` is unchanged (the payload type widened, not narrowed).
- `src/middleware.ts` — forwards either `x-checkout-order-id` or `x-checkout-group-id` depending on which the token carries.

Stage 4 (clinic-side):
- `GET /api/orders/[orderId]/bundlable-siblings` — returns eligible peer list (same patient + provider, AWAITING_PAYMENT, no group, no solo PI). Anchor not bundlable → returns reason string.
- `POST /api/orders/[orderId]/group-and-send` — auth + role + CSRF + body validation, then delegates to `createPaymentGroup` + issues group checkout token.
- `src/app/(clinic-app)/dashboard/_components/order-drawer.tsx` — *Combine with other prescriptions…* picker nested inside the existing *Ready for Patient Payment* card. Sibling checkboxes (pre-selected), running total, clipboard fallback.

Stage 5 (patient-side):
- `POST /api/checkout/payment-group-intent` — patient-facing PI retrieve + optional receipt_email attach. Symmetric to solo `/api/checkout/payment-intent`.
- `src/app/checkout/[token]/page.tsx` — detects group flavor from middleware-forwarded header, loads `payment_groups` row + member count via `count: 'exact', head: true`.
- `src/app/checkout/[token]/_components/checkout-page-content.tsx` — parameterized by `kind: 'solo' | 'group'` and intent endpoint URL. Shows *Prescription Bundle · N prescriptions* in the order-summary card when group. PHI surface unchanged (zero — no patient name, no medication names).

Hardening on existing routes:
- `src/app/api/checkout/payment-intent/route.ts` — explicitly rejects group-flavor tokens with 400 + tightened type narrowing for `orderId | groupId`.

Feature gating: every new endpoint and the patient-side page check `process.env['PHASE_C_GROUPS_ENABLED'] !== 'true'`. Until ops flip the flag in production, the sibling-discovery returns 503 (drawer button shows no candidates) and the patient-side intent endpoint returns 503.

Tests: 265/265 passing (+33 new). 0 lint errors. Typecheck clean.

### What I want from you

Per-PR verdict in the form `PR #X: {PASS | PASS-with-followups | CHANGES-REQUIRED}` plus rationale. For CHANGES-REQUIRED, cite the exact file + line + the misbehavior + the fix.

**Specific scrutiny dimensions (please cover ALL):**

1. **Solo/group race correctness.** Walk the full timeline:
   - Operator clicks Combine on order A while a separate solo checkout link for order A is open in a patient browser tab.
   - Operator's group-create CAS stamps `payment_group_id` on A.
   - Patient on the solo tab clicks Pay; solo route SELECTs A, sees `payment_group_id` non-null, returns 409.
   - Now reverse: patient hits Pay on solo first, solo route creates PI + CAS stamps `stripe_payment_intent_id`. Then operator clicks Combine. The group-create CAS predicate `.is('stripe_payment_intent_id', null)` fails. createPaymentGroup returns 409.
   - Verify both directions are correct AND that no path can result in double-charge. Cite the exact CAS predicates.

2. **F-2 carryover for cart.** When a provider session creates a group, `createPaymentGroup` must verify `provider.user_id === session.user.id` for the SHARED `provider_id` of the orders. Verify the carryover is correct in `src/lib/payment-group/create-group.ts` AND that the cart endpoint in `src/app/api/orders/[orderId]/group-and-send/route.ts` correctly forwards `callerAppRole` + `callerUserId` to the lib. Check that medical_assistant and clinic_admin sessions bypass the F-2 check (act-on-behalf-of).

3. **Group webhook idempotency.** Stage 3 marks the group PAID via `.eq('group_id', groupId).eq('status', 'AWAITING_PAYMENT')` CAS. Verify re-delivery of the same `payment_intent.succeeded` event after group is PAID is a no-op. Verify per-order CAS in handle-group.ts is also idempotent (each order's transition is independent).

4. **PHI surface across all new code.** Audit every console.log / console.error / console.warn / console.info added in PRs #81–#84. Confirm zero patient names, no medication names, no DOBs, no addresses are logged. Audit every Stripe metadata payload — solo `{order_id, clinic_id, platform}`; group `{payment_group_id, clinic_id, order_count, platform}`. Audit the patient checkout page render — zero PHI in the bundle order-summary card.

5. **JWT token correctness.** `CheckoutTokenPayload` is now `{ orderId?, groupId?, patientId, clinicId, iat, exp }` — exactly one of orderId/groupId is present per token. Verify:
   - `generateCheckoutToken` cannot produce a payload with both orderId AND groupId set.
   - `verifyCheckoutToken` is unchanged in behavior (no signature drift, no expiry weakening).
   - The middleware correctly forwards the present one.
   - Solo `/api/checkout/payment-intent` rejects group tokens with 400.
   - Group `/api/checkout/payment-group-intent` rejects solo tokens with 400.

6. **RLS isolation.** Phase C added `payment_groups` table. Verify the table's RLS policies are correct (Stage 1 migration). Specifically: a user from clinic B cannot SELECT a `payment_groups` row belonging to clinic A under any role.

7. **Stripe metadata propagation.** The dispute handler in #84 is OUT OF SCOPE for this review (separate PR), but verify the metadata structure persists across PI → Charge → Refund. Specifically: when we eventually handle `charge.dispute.created` for a group PI, will the `metadata.payment_group_id` be present on the charge? Look up Stripe docs / current behavior and note if a dispute-time lookup might fail.

8. **POC mode behavior.** For clinics with `stripe_connect_account_id = 'poc_placeholder'`, the group route omits Connect routing (no `application_fee_amount`, no `transfer_data`). Verify the same logic appears in the shared lib in PR #84. Verify the omission is documented as POC-only and won't accidentally ship to production.

9. **Drawer UI safety.** The drawer's "Combine and Send" picker:
   - Renders only when feature flag is on (bundlable-siblings endpoint returns 503 if off, drawer shows nothing).
   - Pre-selects all siblings (acceptable — operator must explicitly click Confirm).
   - On success, calls `router.refresh()` to reflect new payment_group_id state.
   - Clipboard fallback for tabs without clipboard write permission.
   - Verify these all behave correctly.

10. **Test coverage gaps.** Identify any code path in PRs #81/#83/#84 that lacks a test. List the gap + the test that should exist. Don't enumerate trivial gaps — focus on race conditions, error paths, and security boundaries.

### Out of scope

- The group dispute handler is in a separate branch (not yet opened). Don't include it in this review.
- The PHI policy implementation for `adapter_submissions.request_payload` is in a separate branch. Don't include it.
- The F-3 dashboard RLS filter is in a separate branch. Don't include it.

### Verify-before-report guardrail

The prior sweep had a 28% false-positive rate before we added the guardrail. Before reporting a finding:

1. Cite the file path + line number.
2. Quote the cited line verbatim.
3. State the misbehavior in terms of input/output.
4. Propose the exact fix (one-line if possible).

Do NOT report a finding without all four. If you're under 95% confident, mark it as a "soft finding" with a question rather than a blocking issue.

### Output format

```
=== PR #80 ===
Verdict: PASS / PASS-with-followups / CHANGES-REQUIRED
Findings:
  - [severity] [file:line] description + fix
  - …

=== PR #81 ===
…

=== PR #82 ===
…

=== PR #83 ===
…

=== PR #84 ===
…

=== Cross-PR Observations ===
(things that don't fit a single PR — e.g., behavior across Stages 2+3 that only manifests when you trace a payment end-to-end)

=== Overall ===
{PASS / CHANGES-REQUIRED}
Recommendation: {merge as-is | fix the listed CHANGES-REQUIRED then merge | revert + redesign}
```
