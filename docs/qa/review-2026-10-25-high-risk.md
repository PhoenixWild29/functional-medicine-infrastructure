# Independent review: four high-risk unmerged branches (2026-10-25)

Task C-2026-10-25-09. Each branch was reviewed against `origin/main` (2696ff24) from its diff alone; the authors' reports were not read. Four reviewers, one per branch, each started fresh. A reviewer reported a finding only after confirming it:
- by reading the code path end to end (each hop is cited), or
- with a throwaway test in a detached worktree of the branch (removed afterwards).

I re-checked the headline findings against the branch code myself. Line numbers are on the branch named.

None of the branches changes `package.json`, the lockfile or `supabase/migrations`.

## Summary

| Branch | Head | Critical | High | Medium | Low | Verdict |
|---|---|---|---|---|---|---|
| rx-quantity-shipping (D) | 702da165 | 0 | 1 | 1 | 2 | Fix the quantity meaning before merge |
| rx-allergies-required (A) | 92540ab0 | 0 | 0 | 0 | 2 | Mergeable; low items can follow |
| state-machine-enforcement (B) | d7b161ac | 0 | 0 | 0 | 2 | Mergeable; low items can follow |
| favorites-frequent (D) | f2c1220d | 0 | 0 | 1 | 1 | Mergeable; add the index soon after |

The one high finding: on rx-quantity-shipping, the `quantity` sent to pharmacies means "packages" on some lines and "units" on others for the same prescription.

---

## 1. rx-quantity-shipping

`orders.quantity` is no longer always 1. `dispenseCount()` (`src/lib/orders/rx-details.ts:893-911`) sets it by these rules:

| Line | quantity |
|---|---|
| Has a package | `package_count` |
| No package, counted unit (capsule, tablet, troche, pellet, suppository) | `ceil(dispense_quantity)` |
| No package, measured amount | 1 |
| Old row with neither | its stored value |

POST /api/orders and PATCH /api/orders/[id] store it. The Tier 1 API, Tier 3 spec, Tier 2 portal, Tier 4 fax and the fax PDF all recompute it from the row at submit time. The branch also adds a shared refills range, a default shipping type, `shippingAddedBy` and a multi-pharmacy warning.

### Findings

**High: `quantity` counts packages on one line and units on another, for the same prescription**
- **Where**: `src/lib/orders/rx-details.ts:900-908`. The field's meaning is undocumented on `OrderPayload.quantity` and in the Tier 3 OpenAPI (`src/app/api/spec/v1/openapi/route.ts:137`, `{ type: 'number' }`).
- **Scenario**: 30 capsules from a "30 capsules" bottle.
  - Built in the builder with the package chosen: `package_label` is set, so quantity = **1**.
  - The same line from a protocol (no `packageId`) or as a catalog line: `resolve-line.ts:134` leaves `package_label` null, so quantity = **30**.
  - The same pharmacy then receives `medication.quantity` / `drug.quantity` / `Qty` (`transformers.ts:264, 326, 390`) as 1 on one order and 30 on another.
  - A pharmacy integration that reads `quantity` as the unit count under-fills the packaged line (1 capsule).
  - Before this branch the field was always 1, a known constant. The split is new.
- **Severity**: the reviewer rated it medium. I raise it to high, because it puts a wrong dispense count into the pharmacy payload, and only the free-text Dispense line stays right.
- **How confirmed**:
  - path: POST route.ts:209 → resolve-line.ts:134/293 (`linePackage` only when `requestedPackageId`) → route.ts:365 → adapter `dispenseCount(order)` → transformer;
  - worktree probe: `caps no pkg => 30 | 30 capsules`, `caps w/ pkg => 1 | 30 capsules (1 × 30 capsules)`;
  - I re-read `dispenseCount` on the branch.
- **Fix**: give the field one meaning and document it on `OrderPayload.quantity` and in the OpenAPI schema. Either:
  - always units for counted forms (package_count × units per package), or
  - always packages: store the default package as the line's package when it covers the dispense, and send the unit count as its own field.

**Medium: a no-package line dispensed in containers sends quantity 1 under "Dispense: 2 vials"**
- **Where**: `src/lib/orders/rx-details.ts:879` (`COUNTED_DISPENSE_UNITS` leaves out vial, bottle, tube, pen and kit) and `:906-908`.
- **Scenario**: quantity label "2 vials" with no package.
  - `computeDispense` gives `{2, 'vial'}`, and `dispenseCount` gives 1.
  - The fax shows "Quantity: 1" under "Dispense: 2 vials", and the API payloads send 1.
  - This breaks the function's own comment that it "always agrees with 'Dispense: ...'". `formatDispense` (`:1219`) already counts those containers.
- **How confirmed**: worktree probe gives `2 vials no pkg => 1`, `3 kits no pkg => 1`. Not confirmed: whether live catalog data has a container label on a no-package line.
- **Fix**: add vial, bottle, tube, pen and kit to the counted set.

**Low: a huge counted dispense gives a 500 instead of a 400**
- **Where**: `src/app/api/orders/route.ts:365`, `[orderId]/route.ts:258`; `optionalPositiveNumber` has no upper bound (`rx-details.ts:1271-1275`).
- **Scenario**: `{ dispenseQuantity: 5e9, dispenseUnit: 'capsule' }` gives a quantity that overflows `orders.quantity INTEGER`, so the insert fails with a generic 500.
- **How confirmed**: probe gives `5000000000`; the insert error goes to the generic 500 at route.ts:392-395.
- **Fix**: give `dispenseQuantity` a maximum in `validateRxDetailsBody` (a 400). api-input-validation (26f1c9a6) bounds it at 1,000,000 in its own schema; add the bound to the shared validator too.

**Low: the counted-unit check is exact-match on a client-supplied unit**
- **Where**: `rx-details.ts:906`; `dispenseUnit` is stored as sent (`:1087`).
- **Scenario**: `dispenseUnit: 'Capsules'` with 30 gives quantity 1 while Dispense prints "30 Capsules".
- **How confirmed**: probe gives `Capsules cased => 1`.
- **Fix**: normalise `dispenseUnit` through the alias table before storing it and before counting.

### Checked and fine
- **Money is unaffected**:
  - no price, fee or payout reads `orders.quantity`;
  - wholesale stays package price × `package_count` (`resolve-line.ts:292`);
  - adapter payloads carry no price (`transformers.ts:40-95, 237-418`);
  - shipping helpers have no quantity term (`shipping.ts:84-104`, `reroute.ts:239-266`).
- **The client cannot set `quantity`**: POST and PATCH never read `body.quantity`; it is computed on the server from the validated rxDetails and the server-resolved package.
- **Every adapter reads the needed columns**: each adapter's select includes `quantity`, `package_label`, `package_count`, `dispense_quantity` and `dispense_unit` (`tier1-api.ts:214`, `tier2-portal.ts:233`, `tier4-fax.ts:90`). Tier 3 shares Tier 1's path.
- **Old rows**:
  - null package and null dispense keep their stored quantity (at least 1);
  - a NUMERIC string dispense is parsed;
  - a blank package label falls through to the dispense rules.
- **Measured forms and titration**: measured forms give 1 per fill. Titration and cycling lines count from the stored total dispense.

### Considered, not confirmed
- Orders submitted before deploy (quantity 1) and resubmitted after it would send a different quantity. Retry paths not traced.
- Demo seeds still insert `quantity: 1`. Harmless, because adapters recompute.

---

## 2. rx-allergies-required

A prescription cannot be signed unless the patient has at least one allergy or NKDA recorded. The server check is in `canSign` (`src/lib/orders/batch-sign.ts:651-660`). When that is the only problem, `signBatch` returns 422 `ALLERGIES_REQUIRED` with one message (`:785-789`), and proposal sign passes it through (`src/lib/proposals/sign-choice.ts:89-93`).

`validateAllergiesPatch` refuses a save that records nothing, so a patient cannot be set back to "not recorded" (`src/lib/patients/allergies.ts:174-177`). Review and the draft sign page open an in-place allergy prompt, both before signing and on a server refusal.

### Findings
No critical, high or medium findings. Every signing path is gated on the server.

**Low: proposing or sending a plan for an unrecorded patient is refused with signing wording, once per line, and no prompt opens**
- **Where**:
  - `src/lib/proposals/propose.ts:300, :376` (call `canSign(..., atSigning: true)`);
  - `:176-182` (`refusal`);
  - `batch-review-form.tsx:929-931`.
- **Scenario**: an MA prepares a plan, or a provider sends one, for a patient with no allergies and no NKDA.
  - The request is refused with "N problems. Nothing was signed." and "Record allergies or mark NKDA before signing" once per line.
  - There is no `ALLERGIES_REQUIRED` code, so the prompt does not open. The amber notice is still on the page, so the user is not stuck.
- **How confirmed**: path propose.ts:300 → canSign → batch-sign.ts:654-659 → `refusal` → Review renders `problems[].message`. No test covers it.
- **Fix**: collapse an all-allergy refusal into one message with `ALLERGIES_REQUIRED_CODE` (as `signBatch` does), open the prompt on it in `handleSendForChoice`, and add a unit test.

**Low (pre-existing, also on main): the API reference documents the retired sign-and-send route as live**
- **Where**: `docs/technical/API-REFERENCE.md:214-237, :279`.
- **Scenario**: a reader is told `POST /api/orders/{orderId}/sign-and-send` signs a draft; it actually returns 410 `USE_BATCH_SIGN`.
- **Fix**: mark it retired and point to `/api/orders/batch-sign`.

### Checked and fine
- **One signing writer**: DRAFT → AWAITING_PAYMENT is written only by `signBatch` (`batch-sign.ts:915`). No migration function writes it, and there are no server actions.
- **Batch sign**: `/api/orders/batch-sign` → `signBatch` → `checkBatch(atSigning)` → the gate.
- **Proposal sign**: `/api/proposals/[id]/sign` → `signChosenProposal` → `signBatch`.
- **Refills**: build session lines only; signing then goes through batch sign.
- **Draft sign page**: posts to the two gated routes.
- **Ops paths**: retry, fax and reroute act only on orders already signed.
- **No client bypass**: allergies are read from `patients` on the server (`batch-sign.ts:638`), and the body carries only `orderIds` and `signature`. A throwaway test with a forged body was still refused.
- **Edge cases, each refused**:
  - an empty list with NKDA false;
  - null/null;
  - whitespace-only entries;
  - no patient row.

  NKDA plus allergies is forbidden by a DB CHECK.
- **Wrong clinic**: the patient read is not clinic-filtered, but its ids come only from clinic-filtered orders.
- **Failures and mixed problems**:
  - a failed allergy read is a 503 (fail-closed);
  - mixed problems keep the per-line list.
- **Retired route**: sign-and-send returns 410 and touches nothing. No UI, adapter or script calls it; the one E2E use asserts the 410.
- **Branch tests**: 28 suites and 561 tests pass in a worktree; tsc is clean.

### Considered, not confirmed
- With 2 local Playwright workers, `patient-protocol-choice.spec.ts` can collide with the WO-97 block that holds "Patient, Test" at "not recorded". CI uses 1 worker.
- `[].every(...)` is true for an empty problem list. It is unreachable today, because `canSign` always adds a problem.

---

## 3. state-machine-enforcement

`casTransition` (`src/lib/orders/cas-transition.ts`) now takes `actorRole`. It refuses a transition the rules do not allow for that actor (`CasTransitionRefused`), and it refuses entering a status whose required field is null. That check is a set of `.not(field,'is',null)` predicates inside the same conditional UPDATE (`:150`). A new `patch` writes other columns in the same UPDATE; the ops reroute uses it, which replaces a hand-written UPDATE. The payment-expiry cron also moves to `casTransition`.

Rule changes:
- DRAFT→CANCELLED now allows ops_admin and system;
- REFUND_PENDING→REFUNDED now allows ops_admin;
- SUBMISSION_PENDING has no required fields;
- SHIPPED's tracking and carrier become unenforced.

Batch sign refuses a draft missing an AWAITING_PAYMENT snapshot (`missing_snapshot`).

### Findings
No real flow is refused. Every call site passes an `actorRole` the rules allow for each transition it can reach; the reviewer checked each pair with a throwaway test against `canTransition` and `canActorTransition`.

**Low: when a required field is missing, a refused-then-fixed race is reported as "already transitioned" and the order is left unmoved**
- **Where**: `src/lib/orders/cas-transition.ts:162-173, :193-197, :214`.
- **Scenario**:
  - The UPDATE matches 0 rows because a required field is null.
  - Before the re-read, another writer sets the field.
  - `missingRequiredFields` finds the order still in `expectedStatus` with every field set and returns `[]`.
  - `casTransition` returns `{ success: true, wasAlreadyTransitioned: true }`, although the order never moved.
  - A caller that treats that as "done" (the solo Stripe handler returns early and marks the event processed) would leave a paid order in AWAITING_PAYMENT.
- **Why low**: no current path reaches it. The solo order is found by its PaymentIntent, so the field is set; the group handler stamps the PI before its CAS.
- **How confirmed**: I re-read the branch code. The re-read returns `[]` when `row.status === status` and every field is set, and the function then falls to the no-op branch.
- **Fix**: report `wasAlreadyTransitioned` only when the re-read shows `status !== expectedStatus`. If it is still in `expectedStatus`, retry the UPDATE once or throw a "state changed, retry" error.

**Low: DRAFT→CANCELLED writes outside `casTransition` are not checked**
- **Where**:
  - `src/lib/proposals/expire.ts:60` (system);
  - `propose.ts:418` (a clinic user cancels a plan);
  - `sign-choice.ts:100` (unchosen lines at sign).
- **Scenario**: each sets `status: 'CANCELLED'` directly with its own history, so no actor rule runs, although the branch's comment says a medical assistant cannot cancel a plan.
- **How confirmed**: a `git grep` of every order status write on the branch. These, batch sign and the demo refresh are the only writes outside `casTransition`.
- **Fix**: route them through `casTransition` with the caller's real role, or document them as out of enforcement scope.

### Checked and fine (call sites)

| Call site | Transition | actorRole | Verdict |
|---|---|---|---|
| Stripe solo `payment_intent.succeeded` (webhooks/stripe/route.ts:319) | AWAITING_PAYMENT→PAID_PROCESSING | system | allowed; PI set |
| Stripe group (handle-group.ts:178) | same | system | allowed; PI stamped first (:156-160) |
| Refunds (handle-charge-refunded.ts:260; cron/refund-retry:73,:129) | REFUND_PENDING→REFUNDED | system | allowed |
| cron/payment-expiry:206 (was a direct UPDATE) | AWAITING_PAYMENT→PAYMENT_EXPIRED | system | allowed |
| cron/sla-check:198 | SUBMISSION_PENDING→FAX_QUEUED | system | allowed |
| cron/portal-status-poll:179 | mapped status | system | legal pairs allowed; illegal ones already threw on main |
| routing-engine (claim :478, fail :369, fax :422, ack :677, reject :714, :856, :889) | submission states | system | allowed |
| tier4-fax:360 | PAID_PROCESSING→FAX_QUEUED | system | allowed (a no-op inside routeOrder, as on main) |
| Documo webhooks :224, :327 | FAX_QUEUED→DELIVERED/FAILED | system | allowed |
| Pharmacy webhook :362-:647 | ACK/COMPOUNDING/PROCESSING/READY/SHIPPED/REJECTED | system | allowed |
| Ops fax action :114, :197 | FAX_DELIVERED→ACK/REJECTED | ops_admin | allowed |
| Ops order actions: add_tracking, cancel, cancel+refund, refunded, retry, force/retry fax, reroute (with patch) | various | ops_admin | allowed; refused pairs were already illegal on main |

Other checks that hold:
- **Rules**: every VALID_TRANSITIONS pair has a rule (throwaway test: `VALID without rule: []`).
- **Required-field race safety**: the check sits in the UPDATE's WHERE clause, so a missing field is never written past.
- **Actor race safety**: the actor check is a pure function with no read, so a concurrent writer cannot invalidate it.
- **Patch**: a patch that nulls a required field is refused before the write.
- **`missing_snapshot`**: it does not refuse real drafts. The only draft creators always set the shipping state, provider NPI and pharmacy snapshot.
- **Branch tests**: 108 suites and 1306 tests in the touched areas pass; tsc is clean, so no call site misses `actorRole`.

### Considered, not confirmed
- Production drafts created before the snapshot columns were filled would now be refused at batch sign. Production data was not checked; worth a read-only count before merge.
- The portal-status-poll mapping has illegal targets. This is pre-existing, not from this branch.

---

## 4. favorites-frequent

The Favorites panel's "Recent" strip is replaced by "Frequently used" (`GET /api/favorites/frequent?provider_id=`). It ranks the provider's formulation + pharmacy + dose combinations by order count over the last 90 days, newest breaking ties, and falls back to the newest combinations. "Make favorite" opens a new dialog that saves for the practice, or for the session patient only, with a choice of doses. It saves through the existing `POST /api/favorites`.

### Findings

**Medium: the ranking query has no date bound and no supporting index**
- **Where**: `src/app/api/favorites/frequent/route.ts:59-68`; `SCAN_LIMIT = 500` at `:33`.
- **Scenario**: every panel open reads up to 500 of the provider's orders, with their full `medication_snapshot` and `pharmacy_snapshot` jsonb, ordered by `created_at`. The 90-day window is applied afterwards in JS (`favorite-presets.ts`, `frequentlyUsed`).
  - No migration indexes `orders` on `provider_id`, `clinic_id` or `created_at`. I re-checked with `git grep` over `supabase/migrations` on the branch: there is no index on those columns or on `status`.
  - So each request is a sequential scan of `orders` plus a top-N sort.
  - The old Recent route had the same shape with 200 rows; this raises it to 500 and makes the result depend on the whole history.
- **Fix**:
  - add `CREATE INDEX idx_orders_provider_created ON orders (provider_id, created_at DESC) WHERE deleted_at IS NULL;`;
  - push the window into the query with `.gte('created_at', since)`, and run the recent fallback as a second small query only when the window is empty;
  - optionally select only the needed jsonb keys.

**Low: in practice mode, the dialog offers the session patient's patient-only doses, and keeps them after a patient switch**
- **Where**:
  - `quick-actions-panel.tsx:552-560` (`otherDosesFor` does not filter `patient_id === null`);
  - `make-favorite-dialog.tsx:53` (`doses` is seeded once) and `:55` (scope defaults to practice).
- **Scenario**: patient A has a dose pinned only to them. Make favorite on the same drug, in "The practice" mode, lists that dose. Ticking it saves A's patient-only dose to the practice card. A patient switch while the dialog is open keeps A's doses.
  - It is the same user and the same clinic, so it is not a cross-clinic or cross-patient leak, but a patient-scoped dose can be promoted to the general list.
- **How confirmed**: path `useClinicFavorites` (`:246-255`, includes the session patient's pinned favorites) → `otherDosesFor` (no scope check) → the dialog seeds `doses` once.
- **Fix**: use only `patient_id === null` favorites in practice mode, and close the dialog, or key it by patient, when the session patient changes.

### Checked and fine
- **Cross-clinic**: `clinicId` comes from `getUser()`. The `provider_id` is checked against the clinic's providers (a foreign one gets 403), and the orders query also filters `clinic_id` (`route.ts:37-62`).
- **Cross-provider**: the orders query filters `provider_id`; formulations are looked up only by ids from those rows; pharmacy names come from the same rows.
- **Service role and N+1**: both service reads carry explicit clinic and provider filters, and there are a fixed 3 queries.
- **Patient scoping**: the server drops favorites pinned to other patients (`api/favorites/route.ts:217-222`). The client query key includes `patientId`, with no keepPreviousData.
- **The dialog's POST**: `provider_id` and `patient_id` are validated on the server (`api/favorites/route.ts:309-318`), and `patient_id` is sent only in patient scope.
- **Access and data**:
  - deactivated users and pharmacy_admin are blocked by the middleware;
  - cancelled and deleted orders are excluded;
  - errors are generic, with no DB message to the client.

### Considered, not confirmed
- Any clinic role can read any clinic provider's Frequently used. This matches the clinic-wide favorites model.
- Counts are truncated past 500 orders in 90 days. This is documented and unlikely at current volume.
- A card pinned to the session patient hides Make favorite. This is UX, not leakage.

---

## 5. clinical-difference-saved (security review, C-2026-10-25-14)

`origin/clinical-difference-saved` at **3bd67130** (D), on main 2696ff24.

### What it does
Saved clinical difference statements (coverage gap 6):
- A provider's typed "Other (describe)" statement can be saved for a formulation, for the practice (patient_id NULL) or for one patient, and picked next time. Nothing is pre-selected.
- The chosen text still goes into `rxDetails.clinicalDifference`, so `orders.clinical_difference`, the Rx and the fax are unchanged.
- New: migration 20261024000009 (PREPARED, table `saved_clinical_statements`), `GET/POST/DELETE /api/clinical-statements`, `lib/clinical-statements/saved.ts`, and a picker in the Review row (`rx-details-row.tsx`).

### Findings
No critical or high findings.

**Medium: the ids are validated with strict `z.uuid()`, which refuses the seeded demo and E2E ids, so the picker does nothing on demo data**
- **Where:**
  - `src/lib/clinical-statements/saved.ts`: `bodySchema` (`z.uuid()` for formulation_id and patient_id) and `isUuid()` (`z.uuid().safeParse`);
  - used by `src/app/api/clinical-statements/route.ts` GET (formulation_id, patient_id), POST (body) and DELETE (id).
- **Scenario:** zod 4's `z.uuid()` enforces the RFC version and variant bits. The seeded ids are not RFC v4:
  - E2E seed formulation `aaaaaaaa-0000-0000-0000-000000000032` (e2e/fixtures/seed.ts:58);
  - demo patients `a3000000-0000-0000-0000-00000000000x` (lib/poc/refresh-demo-data.ts);
  - also `a1…`, `a2…` and `a4…`.

  For a demo patient:
  - GET answers 400 "patient_id must be a UUID", and the row (rx-details-row.tsx:97-99) treats a non-ok answer as "no saved statements" with no message, so nothing is listed;
  - saving for that patient answers 400 "patient_id must be a UUID", which is shown to the provider.

  For the E2E formulation, GET is a 400 too, so the feature can never show a saved statement in E2E. Real rows (gen_random_uuid, v4) work.
- **How confirmed:**
  - with zod 4.6.7, `z.uuid().safeParse('a4000000-0000-0000-0000-000000000001').success` and `'f0000000-0000-0000-0000-00000000005e'` are both false; a v4 id is true;
  - code path: `isUuid(patientId)` in route GET gives the 400, then rx-details-row's `res.ok ? ... : { data: [] }`.
- **Context:** this is the same class as the 13 routes api-input-validation (26f1c9a6) fixed. There, the shared `uuid()` / `UUID_RE` in `lib/api/input` accept any 8-4-4-4-12 hex id for exactly this reason.
- **Fix:** use `uuid()` / `UUID_RE` from `lib/api/input` once the bundles are in (or a local any-hex regex until then) for all three ids. Add a test with a seeded id (`a3000000-...`) for GET and POST.

**Medium (a merge prerequisite): the route will fail bundle-security's `route-error-wrapper` test**
- **Where:** `src/app/api/clinical-statements/route.ts` exports `export async function GET/POST/DELETE`.
- **Scenario:** bundle-security's `src/app/api/__tests__/route-error-wrapper.test.ts` (from error-boundaries) asserts that no route.ts exports `export async function <METHOD>` and that every method is `withApiErrors('/api/...', ...)`. Merged onto the bundles as written, that test fails for this route.
- **How confirmed:** read the test on `origin/bundle-security` (lines 31-37) and the route's exports.
- **Fix:** when rebasing onto the bundles, rename to `getHandler/postHandler/deleteHandler` and export `withApiErrors('/api/clinical-statements', ...)`. Use `isClinicStaffRole` from `lib/auth/claims` (security-followups-3) instead of the local `STATEMENT_SAVE_ROLES` copy, and `parseJsonBody`/`badRequest` from `lib/api/input`.

**Low: a concurrent duplicate save answers 500 instead of returning the existing statement**
- **Where:** route.ts POST. The duplicate check is a read; the insert relies on `uq_saved_clinical_statements_scope`.
- **Scenario:** two saves of the same text for the same scope at the same moment. Both read "none", then the second insert hits the unique index (23505) and returns 500 "The statement could not be saved", although it is saved.
- **Fix:** on error code 23505, re-read and return the existing row (200).

**Low: any clinic role can delete any of the clinic's saved statements**
- **Where:** route.ts DELETE, scoped by `clinic_id` only.
- **Scenario:** a medical assistant can soft-delete a provider's practice statement, or a patient-scoped one. This matches favorites (any clinic member may save), and it is a soft delete (`deleted_at`), so it is not a security break. It is noted only because the task asked "who can save vs use": today every clinic role can save, use and delete.
- **Fix, if Sam wants it narrower:** limit DELETE to the creator or a clinic_admin.

### Checked and fine
- **Migration 20261024000009:**
  - RLS enabled;
  - clinic read policy: role in (clinic_admin, provider, medical_assistant) AND clinic_id from app_metadata;
  - ops_admin read;
  - no write policy;
  - `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ... FROM anon, authenticated` and `REVOKE DELETE, TRUNCATE ... FROM service_role`. These are exactly the lockdown rules of 000004 (rls-user-write-lockdown-v2) and of treatment_proposals 000002: written only through the server, soft-deleted.
  - `SELECT apply_pharmacy_admin_scope()` is the last statement before COMMIT.
- **Indexes:** `idx_saved_clinical_statements_lookup (clinic_id, formulation_id, created_at DESC) WHERE deleted_at IS NULL` serves the picker's read exactly. A unique live copy per clinic, formulation, scope and lower(statement).
- **Length:** `CHECK (char_length(statement) BETWEEN 20 AND 500)`, which matches the server's bounds (`MIN_OTHER_REASON_LENGTH` = 20, max 500, trimmed).
- **Foreign keys:** clinic, formulation and patient, ON DELETE NO ACTION. The only hard delete of either table is the Keragon sync undoing a patient it inserted moments before (lib/integrations/keragon/sync.ts:155). That patient cannot have a saved statement yet, so the FKs never block; patients and formulations are otherwise soft-deleted.
- **Down file:** refuses while any live statement exists, then drops the table. Atomic.
- **Order:** it only creates its own table, with no dependency on 000003 to 000008, so it applies cleanly after them.
  - Its edit of `proposals-migration-static.test.ts` ("000002 sorts right after 000001; later migrations may follow") says the same as perf-indexes' (228c147b) and the queued branches' edits. Expect a trivial textual conflict there; keep either version.
- **Server:**
  - GET is auth plus role gate (any clinic role), clinic from the session, then parse;
  - POST and DELETE are `refuseCrossSite` first, then auth and gate, then parse, then write.
  - The body is a zod strict object (unknown keys refused, statement trimmed and bounded).
  - The clinic is never taken from the body.
  - A patient_id on POST is checked to be in the caller's clinic (403 otherwise); the formulation must exist (404).
  - DELETE is scoped to the caller's clinic and to live rows.
  - Logs carry only `error.message`, never the statement or ids.
- **Patient scope:**
  - GET returns the practice's statements plus only the requested patient's (`patient_id.is.null,patient_id.eq.<checked uuid>`);
  - `visibleStatements` drops any other patient's as a second check;
  - the Review row asks only for the session patient.
  - RLS lets clinic staff read every patient's statements in their own clinic (the same reach they have on `patients`). The patient scoping is a display rule enforced by the API, not an access boundary between staff of one clinic.
- **Rx and fax are unchanged:** the diff touches no adapter, transformer or fax/PDF file. The chosen text goes in `rxDetails.clinicalDifference` exactly as a typed one did.

### clinic-help
**Not reviewed: not pushed.** There is no `origin/clinic-help`; 2cd8d9b is local to D. Review it once pushed, for: no PHI, secrets or internal URLs in the help text; labels that match the code; the route behind clinic auth; no external links.
