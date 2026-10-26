# Merge dry run 2, 2026-10-26

**Task:** C-2026-10-26-05.

**What I did:**
- Merged the 13 planned PRs, in order, into `origin/main` (2696ff24), each with `git merge --no-ff` at its latest `origin` head.
- The work was on a local throwaway branch, `integration-dry-run-2` (final commit 167497ec). It was **not pushed**.
- No other branch was changed.

This is the second dry run. A's first (`origin/dry-run-report`, `docs/qa/merge-dry-run-2026-10-25.md`) predates the HIPAA work and the bundles. Its fixes were applied where they came up again; each is marked "v1".

## Result in short

- **All 13 merge.** 2 are clean (#1, #10); 11 conflict.
  - Most conflicts are mechanical (imports, a test title, a `testMatch` list).
  - Four need a real decision. They are listed under "Problems only the combination shows".
- **Migrations:** 20261024000003 to 20261024000011.
  - Unique, in merge order, and each has a down file.
  - Every migration test passes.
- **Gates on the combined result:** after 4 dry-run fix commits, all pass.

| Gate | Result |
|---|---|
| `npm ci` | pass (906 packages; 20 `libc` markers, as on main) |
| `npm run lint` (`--max-warnings=0`) | pass |
| `tsc --noEmit` | pass |
| `jest --maxWorkers=4` | 697 suites, 7,954 tests, all pass, after the combination fixes. Before them: **14 failed in 5 suites** (problems 6 to 9). |
| `next build` (clean `.next`) | pass (compiled in 100 s) |

- **E2E (Playwright)** was not run: it needs the shared E2E database. The E2E conflicts were resolved by keeping both sides (problem 3).

## Heads merged

| # | Branch | Head |
|---|---|---|
| 1 | ops-fax-viewer-documo | da99864b |
| 2 | rls-user-write-lockdown-v2 | 9611fd23 |
| 3 | security-followups-2 | e53ec166 |
| 4 | signup-squatting | 9e139268 |
| 5 | rate-limit-db | 3c4791cf |
| 6 | bundle-security | b2d05dda |
| 7 | bundle-ci | a03ac017 |
| 8 | bundle-features | 8af58776 |
| 9 | bundle-hipaa | 0d68b3cc, then 726ded31 (one empty report commit pushed during the run; merged again, no change) |
| 10 | bundle-docs | ee98417d |
| 11 | perf-indexes | 228c147b |
| 12 | clinical-difference-saved | d21721a0 |
| 13 | signed-order-freeze | 495441f0 (contains order-transmission-integrity e2d293e1) |

**What the bundles contain:**
- bundle-hipaa contains phi-access-log-coverage (07a12024, with the L1 to L10 review fixes), auth-monitoring (438d960e), password-flows (1d0ed5e1) and audit-review-breakglass (7ef4590f).
- signed-order-freeze contains order-transmission-integrity. It does not contain the bundle-hipaa branches; they meet only in this merge.

## Merge log

| # | Branch | Result | Conflicting files | Resolution |
|---|---|---|---|---|
| 1 | ops-fax-viewer-documo | clean | | |
| 2 | rls-user-write-lockdown-v2 | conflict | `src/lib/proposals/__tests__/proposals-migration-static.test.ts` | Two equivalent relaxations of the "newest migration" test; kept #2's, which also checks the version is unique (v1). |
| 3 | security-followups-2 | conflict | same test | Kept the merged version (v1). |
| 4 | signup-squatting | conflict | same test | Same. |
| 5 | rate-limit-db | conflict | same test; `src/app/api/signup/route.ts` | Test: same. Route: kept #4's duplicate-email guard, with #5's limiter awaited: `const limit = await signupLimiter.check(ipKey)` (v1). |
| 6 | bundle-security | conflict | `ops/fax/_components/fax-triage-queue.tsx`, `api/ops/onboarding/clinics/[clinicId]/route.ts`, `lib/integrations/keragon/access.ts`; and 5 route handlers: `orders/batch-sign`, `patients/[patientId]/duplicate-flag`, `patients/face-sheet`, `patients`, `settings/signup-link` | Imports: kept both. keragon/access: bundle-security's comment. The 5 handlers: bundle-security's `xHandler` + `withApiErrors`, with its inline `sec-fetch-site` check replaced by #3's `refuseCrossSite` lines (v1 #19). Then problems 1 and 2. |
| 7 | bundle-ci | conflict | `ops/onboarding/[clinicId]/_components/clinic-review-details.tsx`, `ops/onboarding/_components/onboarding-admin.tsx` | Kept perf-bundles' client-safe `provider-review-copy` import and #4's `npi-claims` import (type-only imports, so client-safe) (v1 #12). |
| 8 | bundle-features | conflict | `e2e/clinic-app.spec.ts`, `playwright.config.ts`, `settings/page.tsx`; `new-prescription/_components/pharmacy-search-form.tsx` (delete/modify) | Spec: bundle-ci's `TEST_NPIS.providerB` plus bundle-features' new snapshot lines. Config: union of both `testMatch` lists, keeping the shard `grepInvert`. Settings: bundle-features' Notifications card and link (its `/settings/notifications` page is in the bundle). See problem 4 for the deleted file. |
| 9 | bundle-hipaa | conflict | 8 E2E specs and fixtures (`accessibility`, `clinic-onboarding-status`, `nav-after-redirect`, `pharmacy-onboarding-a11y`, `rbac`, `self-serve-signup`, `upload-size-limit`, `fixtures/seed`); `playwright.config.ts`; `dashboard/_components/orders-dashboard.tsx`; `ops/fax/page.tsx`; `api/plan/[token]/__tests__/route.test.ts`; `lib/audit/phi-access.ts` | E2E: problem 3. Config: union, as #8. Dashboard: kept perf-bundles' `dynamic` import; dropped `createBrowserClient` (bundle-hipaa moved the poll server-side, and nothing else uses it). Plan test: both imports. `phi-access.ts`: bundle-hipaa's resource list, which includes `inbound_fax`; #1's `fax_id` column handling merged cleanly. Fax page: problem 5. |
| 10 | bundle-docs | clean | | |
| 11 | perf-indexes | conflict | `proposals-migration-static.test.ts` | Title only; kept the merged version. |
| 12 | clinical-difference-saved | conflict | same test | Title only; same. |
| 13 | signed-order-freeze | conflict | `api/health/route.ts`, `api/ops/orders/[orderId]/action/route.ts`, `lib/adapters/tier2-portal.ts`, `lib/orders/batch-sign.ts`, the same test | Health: problem 6. Action route: both imports, and the union of both `select` lists (bundle-hipaa's `patient_id, clinic_id` for the log row, plus signed-order-freeze's `provider_signature_hash_snapshot`). batch-sign: both imports. tier2-portal: problem 7. Test: title only. Then problems 8 and 9. |

## Problems only the combination shows

None of these fails on its own branch. "Owner" is the branch that should fix it at the source: normally the one that merges second, since it is the one that meets the other.

1. **Duplicate import in `src/lib/integrations/keragon/access.ts`.**
   - Cause: security-followups-2 and bundle-security each add `import { refuseCrossSite } from '@/lib/security/same-origin'`, which fails tsc with TS2300 (v1 problem 5).
   - Dry-run fix: one import (95a6e55a).
   - **Owner: bundle-security**, by merging security-followups-2 first.
2. **The ops fax PDF route against the route guards (v1 problem 2).**
   - Cause: ops-fax-viewer-documo's `GET /api/ops/fax/[faxId]/pdf` is a bare `export async function GET` with an inline `sec-fetch-site` check. Two guards in bundle-security reject it: `route-error-wrapper.test.ts` and `same-origin-moved-routes.test.ts`.
   - Dry-run fix (5697f545): `getHandler`, `refuseCrossSite(request, 'Forbidden', { 'Cache-Control': 'no-store' })`, and `export const GET = withApiErrors('/api/ops/fax/[faxId]/pdf', getHandler)`. The route's tests and both guards pass.
   - **Owner: bundle-security**, or ops-fax-viewer-documo once main has the wrappers.
3. **Literal passwords back in the E2E specs (bundle-ci sharding against bundle-hipaa B9).**
   - Cause:
     - bundle-ci's e2e-shard-ready rewrote the E2E user constants to be shard-scoped (`shardEmail`, `shardId`, `shardPrefix`) and kept the literal passwords;
     - bundle-hipaa's auth-monitoring (B9) replaced every literal with `e2ePassword()`.
   - Conflict resolution (all 8 files): bundle-ci's shard-scoped ids, emails and prefixes, with every password the B9 way (`get password() { return e2ePassword() }`, `const PASSWORD = e2ePassword()`). Both imports kept.
   - **Silent case, no conflict:** `e2e/accessibility-all-routes.spec.ts:53`, from bundle-ci, still had a literal password for `MA_USER`.
     - Changed to `e2ePassword()` in the #9 merge commit. The spec creates or updates that user with `MA_USER.password`, so this is safe.
     - Separately, the spec's own comment asks to wrap its email in `shardEmail()` "when fixtures/shard.ts lands". It has landed, in bundle-ci itself; left for bundle-ci.
   - After the merge, no literal password remains in `e2e/`. The one remaining match is the deliberate wrong password in `hipaa-safeguards.spec.ts:90`, sent to an address with no account.
   - **Owner: bundle-hipaa**, which merges after bundle-ci: merge bundle-ci and apply the above.
4. **`pharmacy-search-form.tsx`: deleted on one side, edited on the other.**
   - Cause: bundle-ci's remove-dead-code (be108fb3) deletes it as dead; bundle-features' keyboard pass (8af58776) edits it.
   - Nothing imports it (`grep` over `src` and `e2e`), so the deletion stands.
   - **Owner: bundle-features:** take the deletion when it merges bundle-ci.
5. **The ops fax queue page: Documo links against signed URLs.**
   - Cause:
     - ops-fax-viewer-documo makes each row link to `/api/ops/fax/[faxId]/pdf`, fetched from Documo per view, with no storage URL;
     - bundle-hipaa's phi-access-log-coverage still mints signed storage URLs (`mapFaxRow(row, supabase)`) and its L6 guard is written around them.
   - Resolution in the #9 merge: bundle-hipaa's view logging (`logFaxQueueView`) and its no-actor guard (no queue at all without a resolvable user), followed by Documo's `mapFaxRow(row)` links. Comments updated.
   - Test fix (939aec59), in `ops/fax/__tests__/page-phi-access-log.test.tsx`: "the signed URLs are minted as before" is now "the queue renders with each fax linked to its PDF route" (no `createSignedUrl` call).
   - **Owner: phi-access-log-coverage** (bundle-hipaa): merge ops-fax-viewer-documo and adopt its links.
   - **Follow-up:** `logPhiAccessBatch` has no `faxId`, so the queue's rows still name the order only. Now that `phi_access_log.fax_id` exists (000003), the fax queue targets should carry it, as the PDF route's row already does.
6. **The health check: two secrets, two tests.**
   - Cause: bundle-hipaa fails `/api/health` in production without `PHI_ACCESS_LOG_HASH_SECRET`; signed-order-freeze fails it without `RX_BINDING_SECRET`. Each wrote its own version of the route.
   - Merged route (the #13 merge commit):
     - checks both and reports both (`checks: { phi_audit_hash_secret, rx_binding_secret }`), never the values;
     - fails when either is missing in production;
     - uses bundle-hipaa's definition of production (L10: `VERCEL_ENV`, or `NODE_ENV=production` with no `VERCEL_ENV`), which includes signed-order-freeze's `VERCEL_ENV === 'production'`.
   - Then each side's test failed, because it set only its own secret:
     - signed-order-freeze's `health/__tests__/route.test.ts` ("B review T1 ... fails (503) in production when it is missing");
     - bundle-hipaa's `health/__tests__/phi-audit-secret.test.ts` ("production with the secret: 200").
   - Test fix (939aec59): each test sets the other secret in `beforeEach`.
   - **Owner: signed-order-freeze** (it merges last). **For the deploy:** both `PHI_ACCESS_LOG_HASH_SECRET` and `RX_BINDING_SECRET` must be set in Vercel production before this merges, or the deploy verify step fails.
7. **Tier 2 portal: the order read moved.**
   - Cause:
     - bundle-hipaa added `clinic_id` to tier2-portal's own order `select`, for the disclosure row's system actor and clinic;
     - signed-order-freeze replaced that read with the transmission guard's `loadTransmittableOrder` (`SEND_ORDER_COLUMNS`, which already includes `clinic_id`).
   - Resolution: signed-order-freeze's guard-based block, with `clinic_id: string` added to its `OrderRow` type so the disclosure call type-checks.
   - **Owner: signed-order-freeze.**
8. **The disclosure tests against the transmission guard (10 failures).**
   - Cause: `src/lib/adapters/__tests__/phi-disclosure.test.ts` (bundle-hipaa) builds unsigned orders, which signed-order-freeze's guard (B6) correctly refuses ("has not been signed, so it was not sent"). Its Playwright mock also lacked `context.route`, which signed-order-freeze's https enforcement (T5) calls.
   - Test fix (939aec59): mock `loadTransmittableOrder` to hand the file's order back as verified, and add `route()` (plus `url()`) to the Playwright mock. All 10 pass.
   - **Owner: signed-order-freeze** (it changes the adapter contract and merges after bundle-hipaa).
9. **batch-sign's partial-sign case no longer happens (1 failure).**
   - Cause: in bundle-hipaa's L1 test "a partial sign names the orders that were not signed", an order leaves DRAFT after the checks. Under signed-order-freeze, its per-order binding write (`.eq('status', 'DRAFT')`) catches that before anything is signed. The result is 503 "The signature could not be recorded on the prescriptions. Nothing was signed; try again." rather than a 500 partial sign. That is the better outcome. The route's L1 handling writes a not_completed row for every logged order on a 503.
   - Test fix (939aec59): it now expects 503 and no `unsignedOrderIds`.
   - **Owner: signed-order-freeze.**

## Fixing it at the source

| Later branch | Merge this first | Then |
|---|---|---|
| rls-user-write-lockdown-v2, security-followups-2, signup-squatting | origin/ops-fax-viewer-documo | Keep one version of `proposals-migration-static.test.ts`. |
| rate-limit-db | origin/signup-squatting | `await signupLimiter.check(ipKey)` after the duplicate guard. |
| bundle-security | origin/security-followups-2, origin/ops-fax-viewer-documo | The 5 handlers: `xHandler` plus `refuseCrossSite`. One import in keragon/access (problem 1). Wrap the fax PDF route (problem 2). |
| bundle-ci | origin/signup-squatting | `provider-review-copy` plus `npi-claims` imports. |
| bundle-features | origin/bundle-ci | Take the `pharmacy-search-form` deletion (problem 4); `testMatch` union; keep `TEST_NPIS.providerB`. |
| bundle-hipaa | origin/bundle-ci, origin/ops-fax-viewer-documo | E2E passwords the B9 way on shard-scoped users, including `accessibility-all-routes` (problem 3). Fax page on Documo links (problem 5). Dashboard drops `createBrowserClient`. |
| signed-order-freeze | origin/bundle-hipaa | Health route and both tests (problem 6), tier2 `OrderRow.clinic_id` (problem 7), the action route's `select` union, the disclosure tests (problem 8), the batch-sign test (problem 9). |
| perf-indexes, clinical-difference-saved | (whatever precedes them) | Title-only test conflict. |

## Migrations

`supabase/migrations/` on the combined result:
- 92 files, all named `<14 digits>_<snake>.sql`;
- versions unique and sorted;
- the newest on main is 20261024000002.

New files:

| Version | File | Down file | Branch (merge position) |
|---|---|---|---|
| 20261024000003 | phi_access_log_fax_id | down/20261024000003_down.sql | ops-fax-viewer-documo (1) |
| 20261024000004 | rls_user_write_lockdown | down/20261024000004_down.sql | rls-user-write-lockdown-v2 (2) |
| 20261024000005 | member_reactivation_ban | down/20261024000005_down.sql | security-followups-2 (3) |
| 20261024000006 | npi_claimed_signup_deleted | down/20261024000006_down.sql | signup-squatting (4) |
| 20261024000007 | rate_limit_hits | down/20261024000007_down.sql | rate-limit-db (5) |
| 20261024000008 | perf_indexes | down/20261024000008_down.sql | perf-indexes (11) |
| 20261024000009 | saved_clinical_statements | down/20261024000009_down.sql | clinical-difference-saved (12) |
| 20261024000010 | signed_order_freeze | down/20261024000010_down.sql | signed-order-freeze (13) |
| 20261024000011 | order_signing_snapshots | down/20261024000011_down.sql | signed-order-freeze (13) |

- No bundle (6 to 10) adds a migration. The numbers follow the merge order: 000008 to 000011 merge after every lower one.
- The migration tests in Jest all pass, including `proposals-migration-static`, `perf-indexes-migration`, `signed-order-freeze`, `phi-access-log-migration`, `fax-pdf-migration-and-viewer-wiring` and the clinical-statements test.
- **Pre-existing, not from this merge:** 17 migrations already on main have no `down/<version>_down.sql`: 20260329000001/2, 20260408000001/2/3, 20260409000001, 20260411000001, 20260528000001, 20260609000001, 20260611000001/2/4/5, 20260614000001/2/3/4. Main has 66 down files; this merge adds the 9 above.

## For the merge itself

- **Production secrets:** set `PHI_ACCESS_LOG_HASH_SECRET` and `RX_BINDING_SECRET` in Vercel production before bundle-hipaa and signed-order-freeze deploy. Otherwise `/api/health` answers 503, and the deploy's verify step fails (Slack, no rollback).
- **E2E:** the first real run is the PR that brings each E2E change in. The specs touched by problem 3 deserve a look in that run.
