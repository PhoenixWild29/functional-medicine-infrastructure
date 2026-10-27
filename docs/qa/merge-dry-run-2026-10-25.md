# Merge dry run, 2026-10-25

Task A-2026-10-25-10. I merged the 25 waiting branches into `origin/main` (2696ff2) in the planned PR order, each with `git merge --no-ff`. The work was done on a local throwaway branch, `integration-dry-run` (final commit f88bf267), which was **not pushed**. I did not push any change to any other branch.

## Result in short

- **All 25 merge.** 9 merge cleanly (#1, 6, 7, 9, 10, 13, 14, 16, 25). 16 conflict, and every conflict is mechanical: each side made the same or neighbouring edits for different reasons. None is a design clash.
- **Migrations:** numbered 20261024000003 to 000007, no duplicates, and in the merge order.
- **Gates on the combined result:**
  - `npm ci`, lint (0 warnings), tsc and `next build` pass.
  - Jest (`--maxWorkers=3`): 2 failures out of 7,000 tests, both caused by the combination and both fixed in the dry run. With those fixes, every gate passes.
  - E2E was not run (it needs the shared E2E database).
- **Six problems appear only in the combination** (no single branch shows them). See "Problems only the combination shows" below.

## Merge log

| # | Branch | Result | Conflicting files | Resolution in the dry run |
|---|---|---|---|---|
| 1 | ops-fax-viewer-documo | clean | | |
| 2 | rls-user-write-lockdown-v2 | conflict | `src/lib/proposals/__tests__/proposals-migration-static.test.ts` | #1 and #2 relax the same "000002 is the newest migration" test in two equivalent ways. Kept #2's (it also checks the version is unique). |
| 3 | security-followups-2 | conflict | the same test | The same change again; kept the version already merged. |
| 4 | signup-squatting | conflict | the same test | Same as #3. |
| 5 | rate-limit-db | conflict | the same test; `src/app/api/signup/route.ts` | Test: as #3. Signup route: kept #4's duplicate-email guard and made #5's limiter call async: `const limit = await signupLimiter.check(ipKey)`. |
| 6 | flake-show-checklist | clean | | |
| 7 | ci-playwright-container | clean | | |
| 8 | remove-dead-code | conflict | `package.json`, `package-lock.json` | The branch is behind main's zod 4 bump (#270). Kept `"zod": "^4.6.7"` and the branch's removal of `zustand` and the other unused packages. Regenerated the lockfile from main's with `npm install --package-lock-only`. No merged branch imports a removed package (checked `pg`, `react-pdf`, `recharts`, `zustand`, `ts-jest` and the rest). |
| 9 | docs-oct25 | clean | | |
| 10 | e2e-axe-all-routes | clean | | |
| 11 | e2e-shard-ready | conflict | `playwright.config.ts` | Kept #11's `grepInvert: SERIAL` and #10's `accessibility-all-routes.spec.ts` in the chromium `testMatch`. |
| 12 | perf-bundles | conflict | `ops/onboarding/[clinicId]/_components/clinic-review-details.tsx`, `ops/onboarding/_components/onboarding-admin.tsx` | Kept #12's client-safe `provider-review-copy` import and #4's `npi-claims` import. `npi-claims` has only type imports, so it is safe in a client bundle. |
| 13 | test-data-cleanup-script | clean | | |
| 14 | docs-prod-clickthrough | clean | | |
| 15 | ci-actions-node24 | conflict | `.github/workflows/ci.yml` | Kept #7's container E2E job: no browser cache or install-deps steps, so #15's `actions/cache@v6` edits on those steps fall away. **Also** bumped #11's new `e2e-sharded-trial` job from `@v4` to the Node 24 majors (combination problem 1). |
| 16 | todo-sweep | clean | | |
| 17 | token-pages-hardening | conflict | `e2e/patient-protocol-choice.spec.ts` | #17's neutral heading "This link is no longer active" plus #10's axe check, relabelled `'Plan link, no longer active'`. |
| 18 | checkout-token-out-of-url | conflict | `e2e/checkout.spec.ts` | #11's `TEST_CLINIC_NAME` plus #18's "token out of the URL" assertions. |
| 19 | error-boundaries | conflict | `playwright.config.ts`, `src/app/error.tsx`, `src/app/global-error.tsx`, `ops/fax/_components/fax-triage-queue.tsx`, and 7 route handlers: `intake/[token]`, `ops/onboarding/clinics/[clinicId]`, `orders/batch-sign`, `patients/[patientId]/duplicate-flag`, `patients/face-sheet`, `patients`, `settings/signup-link` | See "#19 in detail" below. |
| 20 | api-input-validation | conflict | 61 route handlers | 29 files had import-only conflicts: kept both. The rest: kept #20's validation code and #19's `xHandler` + `withApiErrors` naming. Batch-sign lost its handler header in the resolution; restored it with #3's `refuseCrossSite`. Merged duplicate imports. |
| 21 | security-followups-3 | conflict | 39 files (38 route handlers, `lib/integrations/keragon/access.ts`) | Each handler: #19's `xHandler` name plus #21's `refuseCrossSite` lines. Imports from one module merged into one statement (e.g. `claims` with `isClinicStaffRole`). |
| 22 | rx-quantity-shipping | conflict | `margin-builder-form.tsx`, `batch-sign-form.tsx`, `new-protocol-form.tsx` | Imports only: #19's `userMessage` plus #22's multi-pharmacy imports. Dropped `computeBundleShipping`, which #22 replaced and nothing uses any more. |
| 23 | rx-allergies-required | conflict | `review/_components/allergy-notice.tsx` | Imports only: #19's `userMessage` plus #23's `ALLERGIES_REQUIRED_MESSAGE` and `AllergyEditor`. |
| 24 | favorites-frequent | conflict | `quick-actions-panel.tsx`, `api/favorites/frequent/route.ts` (renamed from `recent`), `api/favorites/__tests__/wo104-favorites-model.test.ts` | Took #24's Frequently-used panel and its test move. The renamed route keeps #19's wrapper, #20's provider_id uuid check and #21's staff-role gate. See combination problem 3. |
| 25 | docs-requirements-coverage | clean | | |

### #19 (error-boundaries) in detail
- **`error.tsx` / `global-error.tsx`:** #10 added minimal root boundaries; #19 has the fuller `ErrorScreen` versions.
  - Took #19's for both files.
  - Added #10's `<head><title>Something went wrong | CompoundIQ</title></head>` to `global-error.tsx`, because #19's version has `lang` but no title (WCAG 2.1 A, which #10 was fixing).
- **`playwright.config.ts`:** the merged line plus #19's `error-pages.spec.ts`.
- **`fax-triage-queue.tsx`:** both imports (`FaxPdfViewer` from #1, `userMessage` from #19).
- **`intake/[token]`:** #17's `NOT_ACTIVE` constant plus #19's `postHandler`.
- **`ops/onboarding/clinics/[clinicId]`:** both import groups (#4's `npi-claims` and `delete-signup`; #19's `withApiErrors`).
- **The other five routes** (`orders/batch-sign`, `patients/[patientId]/duplicate-flag`, `patients/face-sheet`, `patients`, `settings/signup-link`):
  - #19 renames `export async function POST` to `async function postHandler` (exported through `withApiErrors`), and still carries the inline `sec-fetch-site` check that main had.
  - #3 replaced that inline check with `refuseCrossSite`.
  - Resolution: #19's handler name with #3's `refuseCrossSite` body.

## Problems only the combination shows

None of these fails on its own branch.

1. **CI: the sharded-trial job still uses `@v4` actions.** `e2e-shard-ready` (#11) adds the `e2e-sharded-trial` job with `checkout`, `setup-node`, `cache` and `upload-artifact` at `@v4`. `ci-actions-node24` (#15) was written without it, so its own guard test (`src/__tests__/ci-actions.test.ts`) fails on the combination.
   - Dry run: bumped the job's actions (checkout@v7, setup-node@v7, cache@v6, upload-artifact@v7).
   - Also: that job still runs on `ubuntu-latest` and installs browsers itself rather than using #7's Playwright container. Worth aligning with the E2E job when the sharded trial is adopted.
2. **Ops fax PDF route vs the two route guards.** `ops-fax-viewer-documo` (#1) adds `GET /api/ops/fax/[faxId]/pdf` with a plain `export async function GET` and an inline `sec-fetch-site` check. Two guards added later reject it:
   - `src/app/api/__tests__/route-error-wrapper.test.ts` (#19): every handler must be `withApiErrors('/api/…', handler)`;
   - `src/lib/security/__tests__/same-origin-moved-routes.test.ts` (#21): no route reads Sec-Fetch-Site itself.

   Dry-run fix (commit f88bf267): `async function getHandler`, `refuseCrossSite(request, 'Forbidden', { 'Cache-Control': 'no-store' })` and `export const GET = withApiErrors('/api/ops/fax/[faxId]/pdf', getHandler)`. The route's own tests still pass.
3. **favorites-frequent vs the route-wide changes.** `favorites-frequent` (#24) renames `/api/favorites/recent` to `/api/favorites/frequent`. Three earlier branches touched the old route:
   - `security-followups-3` (#21) adds a test at `src/app/api/favorites/recent/__tests__/staff-role-gate.test.ts`, which imports the deleted route;
   - `api-input-validation` (#20) adds `src/app/api/favorites/__tests__/input-validation.test.ts`, which imports `../recent/route`;
   - #24's own `frequent-route.test.ts` signs in a user with **no `app_role`** (refused by #21's staff gate, 403) and uses provider id `'provider-in'` (refused by #20's uuid check, 400). It also expects 403 for `provider_id=x`, which is now 400.

   Dry-run fixes:
   - moved the staff-role test to `frequent/__tests__/` and pointed both tests at `/api/favorites/frequent`;
   - in `frequent-route.test.ts`: `app_role: 'provider'`, a uuid provider id, and 400 for `x`;
   - in the route: `withApiErrors('/api/favorites/frequent', …)` (the merged route had kept the old `'/api/favorites/recent'` label).
4. **Unused import after #22.** `margin-builder-form.tsx` would import `computeBundleShipping`, which #22 replaced and nothing uses (lint `no-unused-vars`). Dropped in the dry run.
5. **Duplicate imports.** After #20 and #21, these files imported from one module twice (tsc TS2300):
   - `pharmacies/shipping`, `favorites/recent` (renamed), `favorites`, `orders/[orderId]/record`, `orders/[orderId]/timeline-actors`, `orders/compliance-check`, `orders/refill`, `orders/route`, `orders/shipping`, `lib/integrations/keragon/access.ts`.

   This is a resolution artefact rather than a bug on any branch: merged into one import each.
6. **`global-error.tsx` title.** See #19: taking #19's file as is would drop #10's `<title>`. `e2e-axe-all-routes`' axe pass checks the error page for a title, so E2E would fail.

## Fixing it at the source

The task says `git merge origin/main` on a later branch is not enough, because main does not have the earlier branch yet. These are the merges that make each later branch merge cleanly and pass on top of the ones before it, listed as **branch ← what it should merge**. "← main" means that is enough because the conflict is with something already on main.

| Later branch | Merge this first | Then |
|---|---|---|
| rls-user-write-lockdown-v2 (#2) | origin/ops-fax-viewer-documo | Take either version of `proposals-migration-static.test.ts` (they are equivalent); keep one. |
| security-followups-2 (#3) | origin/ops-fax-viewer-documo | Same test; take the merged version. |
| signup-squatting (#4) | origin/ops-fax-viewer-documo | Same test. |
| rate-limit-db (#5) | origin/signup-squatting | Signup route: `const limit = await signupLimiter.check(ipKey)` after the duplicate guard. Same test. |
| remove-dead-code (#8) | origin/main | Keep zod 4.6.7 without zustand; regenerate `package-lock.json`. |
| e2e-shard-ready (#11) | origin/e2e-axe-all-routes | `testMatch` gets `accessibility-all-routes.spec.ts` next to `grepInvert`. |
| perf-bundles (#12) | origin/signup-squatting | Import `provider-review-copy` and `npi-claims` in the two ops onboarding components. |
| ci-actions-node24 (#15) | origin/ci-playwright-container **and** origin/e2e-shard-ready | Keep the container E2E job; bump the sharded-trial job's actions to the Node 24 majors (problem 1). |
| token-pages-hardening (#17) | origin/e2e-axe-all-routes | Neutral heading plus the axe check in `patient-protocol-choice.spec.ts`. |
| checkout-token-out-of-url (#18) | origin/token-pages-hardening (its base) **and** origin/e2e-shard-ready | `TEST_CLINIC_NAME` plus the new assertions. |
| error-boundaries (#19) | origin/ops-fax-viewer-documo, origin/security-followups-2, origin/signup-squatting, origin/e2e-axe-all-routes, origin/e2e-shard-ready, origin/token-pages-hardening | Resolutions as in "#19 in detail". **Also wrap the new ops fax PDF route** (problem 2). |
| api-input-validation (#20) | origin/error-boundaries (after #19 has done the row above) | The `xHandler` naming plus validation; batch-sign keeps `refuseCrossSite`; one import per module. |
| security-followups-3 (#21) | origin/error-boundaries and origin/api-input-validation | `xHandler` plus `refuseCrossSite`; one import per module. **Also** move the ops fax PDF route to `refuseCrossSite` if #19 has not (problem 2). |
| rx-quantity-shipping (#22) | origin/error-boundaries | Imports; drop `computeBundleShipping`. |
| rx-allergies-required (#23) | origin/error-boundaries | Imports. |
| favorites-frequent (#24) | origin/error-boundaries, origin/api-input-validation, origin/security-followups-3 | Problem 3: move the two tests to `frequent`; fix its own test's role and ids; set the `withApiErrors` label to `/api/favorites/frequent`. |

**A reorder that saves most of this.** Three branches change the route handlers in bulk: `error-boundaries` (#19, about 70 handlers), `api-input-validation` (#20, about 60) and `security-followups-3` (#21, about 40). They account for the six largest conflicts (#19 to #24, about 110 files between them) and 3 of the 6 combination problems (2, 3 and 5).

- Move them to positions 6, 7 and 8, straight after `rate-limit-db`. Then rebase or merge them in that order: each merges the one before it.
- After that, every feature branch that follows only needs `git merge origin/main` at its turn, because main then has all three. That holds for `perf-bundles`, `token-pages-hardening`, `checkout-token-out-of-url`, `rx-quantity-shipping`, `rx-allergies-required` and `favorites-frequent`.
- `ops-fax-viewer-documo` (#1) goes first either way. So #19 or #21 must take its fax PDF route (problem 2), or #1 can adopt `refuseCrossSite` and `withApiErrors` itself once they are on main.

The four CI and E2E branches (#7, #10, #11, #15) still need the merges in the table, whichever order is used.

## Migration numbering

New files under `supabase/migrations/` against `origin/main` (highest on main: `20261024000002_treatment_proposals.sql`):

| Migration | Down file | Branch | Merge position |
|---|---|---|---|
| 20261024000003_phi_access_log_fax_id.sql | down/20261024000003_down.sql | ops-fax-viewer-documo | 1 |
| 20261024000004_rls_user_write_lockdown.sql | down/20261024000004_down.sql | rls-user-write-lockdown-v2 | 2 |
| 20261024000005_member_reactivation_ban.sql | down/20261024000005_down.sql | security-followups-2 | 3 |
| 20261024000006_npi_claimed_signup_deleted.sql | down/20261024000006_down.sql | signup-squatting | 4 |
| 20261024000007_rate_limit_hits.sql | down/20261024000007_down.sql | rate-limit-db | 5 |

No duplicates, no gaps, and they apply in merge order. No other branch adds or changes a migration. If the order changes, these five must still merge in this relative order: each was numbered after the previous one.

## Gates on the combined result

All run on `integration-dry-run` after all 25 merges, starting from a clean `.next`.

| Gate | Result |
|---|---|
| `npm ci` (with the regenerated lockfile) | pass |
| `npm run lint` (`--max-warnings=0`) | pass |
| `tsc --noEmit` | pass |
| `jest --maxWorkers=3` | 644 suites, 7,000 tests: **2 failed** (`route-error-wrapper`, `same-origin-moved-routes`, both problem 2). After the f88bf267 fix, both suites and the fax route's tests pass. |
| `npm run build` | pass |

The other combination problems (1, 3, 4, 5, 6) were caught and fixed while merging, by tsc, lint and the targeted Jest runs, so they do not appear in the final counts.

E2E (Playwright) was not run: it needs the shared E2E Supabase project. The E2E spec conflicts above (#11, #17, #18, #19) were resolved by keeping both sides' assertions. Their first real run is the PR that brings each one in.
