# Bundle merge resolution review (2026-10-25)

Task C-2026-10-25-12. This review checks that no merge resolution in the bundles silently dropped one side's change. The bundles were built by A. I did not build them, and I checked every merge from the code: the merge commits, both parents' diffs from their merge-base, and the bundle tips. The merge bodies and A's dry-run report (`origin/dry-run-report`, `docs/qa/merge-dry-run-2026-10-25.md`) were used only to tell deliberate removals from accidental ones.

Two independent reviewers took one bundle each. I re-checked every finding against the code and ran the full Jest suite on the tip. Nothing was pushed to any bundle branch.

## Scope

| Bundle | Tip | Merges reviewed | Status |
|---|---|---|---|
| bundle-security (A) | b4b2cf8b | 5: error-boundaries, api-input-validation, security-followups-3, token-pages-hardening, checkout-token-out-of-url | Reviewed |
| bundle-ci (A) | 2b671408 | 11 on top of bundle-security, plus 2 non-merge commits | Reviewed |
| bundle-features (B) | not pushed | none | **Not reviewed.** No `origin/bundle-features`, and no remote branch carries B's merges on top of b4b2cf8b as of this review. Review it once pushed. |

## Summary

| Bundle | High | Medium | Low | Verdict |
|---|---|---|---|---|
| bundle-security | 0 | 0 | 0 | No change from any parent was lost. |
| bundle-ci | 0 | 1 | 1 | Restore the lockfile's libc markers before merge. |

Whole-tip checks on bundle-ci, which includes bundle-security:
- tsc is clean.
- Jest: 617 suites and 6735 tests, all passing.
- Every test file present on any of the 16 source branches is present on the tip, except `pharmacy-search-form-filter.test.tsx`. remove-dead-code (6f8eabf5) deleted it on purpose with the dead `PharmacySearchForm` it tested.

## Problems

### bundle-ci, medium: package-lock.json lost all 20 `"libc"` markers
- **Where:** `package-lock.json` on the tip (2b671408). The missing markers are the `libc` fields on the `@img/sharp-*linux*` and `@next/swc-linux-*` entries.
- **Lost from:** both parents of the remove-dead-code merge **44a6594f**. Each parent and every incoming branch head has 20.
- **How confirmed:** `grep -c '"libc"'` on each ref:

  | Ref | Count |
  |---|---|
  | origin/main | 20 |
  | bundle-security b4b2cf8b | 20 |
  | 44a6594f^1 | 20 |
  | remove-dead-code 6f8eabf5 | 20 |
  | 44a6594f | **0** |
  | 2b671408 (tip) | **0** |

  `git diff 6f8eabf5 44a6594f -- package-lock.json` is 60 libc lines removed (20 × 3) plus the zod hunk. The merge body says the lockfile was regenerated with `npm install --package-lock-only`. npm 10 on Windows drops these fields, which is why remove-dead-code restored them by hand.
- **Effect:**
  - `npm ci` on Linux no longer tells glibc from musl packages, so it installs both variants.
  - The lockfile will churn on the next npm run that writes the field.
  - It is not functionally broken: `npm ci` passed in the dry run.
- **Fix:**
  1. Start from `git show 6f8eabf5:package-lock.json`.
  2. Re-apply only the zod bump from 44a6594f^1 (`"zod": "^4.6.7"` and the 4.6.7 resolved/integrity lines).
  3. Check that `grep -c '"libc"'` gives 20 and that `npm ci` installs cleanly.

### bundle-ci, low: a leftover `ts-jest` override (not a merge loss; corrects my own C-2026-10-25-03 report)
- **Where:** `package.json` `overrides` still has `"ts-jest": { "handlebars": "^4.7.9" }`, although ts-jest was removed.
- **Lost from:** nothing. remove-dead-code's own head (6f8eabf5:package.json:89) has it. My C-2026-10-25-03 commit body said the override went with ts-jest, but on 6f8eabf5 it is present. Either it came back with the later merge of main into that branch, or it was never removed.
- **Effect:** none (an override for a package that is not installed).
- **Fix:** delete the four lines in a follow-up.

## Verified

### bundle-security: route handlers (error-boundaries + api-input-validation + security-followups-3)
- **Merges:**
  - 3f5ab002 (error-boundaries): no conflicts.
  - 2af5cc1c (api-input-validation): 61 route.ts conflicts.
  - a60160ca (security-followups-3): 38.
  - cb91d10b (token-pages-hardening): 1, `api/intake/[token]`.
  - dfc4c640 (checkout-token-out-of-url): none.
- **Scripted comparison over all 139 route.ts** on main, c0bbcc7c, 26f1c9a6, ea321e84 and the tip:
  - **Counts:** for each file, calls to `withApiErrors`, `refuseCrossSite`, the parse helpers and uuid checks, `CLINIC_STAFF_ROLES` and `safeEqual`. On no file is the tip below base plus each branch's additions.
  - **Wrapper:** the 157 `export const X = withApiErrors(...)` lines are identical on error-boundaries and the tip. No async handler is exported unwrapped, except `auth/callback`, which error-boundaries also leaves unwrapped.
  - **Added lines kept:** every line any of the five branches added to a route.ts is on the tip. The only exceptions are the `export async function` → `xHandler` signature merges, and two patient-phases lines that security-followups-3 rewrote on purpose (advanced_by from the caller); the tip has that version.
  - **Removed lines stay removed:** no line a branch removed is back. A control run against base flags about 490 lines, so the check works.
  - **Nothing extra:** `git diff ea321e84 b4b2cf8b -- 'src/app/**/route.ts'`, minus the wrapper lines, holds only token-pages-hardening's own changes to `intake/[token]` and `plan/[token]`. The order inside every handler is therefore security-followups-3's own.
- **Order:** checked per handler in the reviewer's table. Cross-site check, then auth/role gate (or safeEqual, HMAC or token for machine and public routes), then parse, then read or write. The table is in the bundle-security reviewer output, summarised in this report's commit.
- **Tests:** Jest on the tip for `src/app/api`, `src/lib/security` and `src/lib/api`: 188 suites and 2250 tests pass. That includes route-error-wrapper, same-origin-writes, constant-time, input and every staff-role-gate test.

### bundle-ci
- **Merges:**
  - No conflicts: ccdd5478 flake-show-checklist; 4c82a0d4 ci-playwright-container; 064c91a6 perf-bundles; 2020150d test-data-cleanup-script; 1fd3c805 todo-sweep; dff82711 bundle-security report.
  - Conflicted:
    - 44a6594f remove-dead-code: package.json, package-lock.json;
    - 38502963 e2e-axe-all-routes: patient-protocol-choice.spec, playwright.config, error.tsx, global-error.tsx;
    - 71553f5d e2e-shard-ready: checkout.spec, playwright.config;
    - c09df845 ci-actions-node24: ci.yml;
    - c36cc72b patient-pages-mobile: playwright.config, (patient-checkout)/error.tsx, checkout/error.tsx.
- **playwright.config.ts:**
  - **Coverage:** all 27 specs under `e2e/` are in a project. The default testMatch is `**/*.spec.ts` with no exclusions.
  - **Projects:**
    - **chromium** runs all 27, with `@serial` inverted only when sharded.
    - **serial** (sharded only) runs clinic-app, where all four `@serial` describes live.
    - **firefox** and **webkit** run auth and checkout.
    - **mobile-chrome** runs checkout.
  - **Sharding:** e2e-shard-ready's sharding survives in full: shard env, per-shard port and base URL, outputDir, and the report and junit suffixes.
  - **New specs:** accessibility-all-routes, error-pages and patient-pages-mobile are added to chromium.
- **E2E spec conflicts:**
  - patient-protocol-choice.spec.ts:300-303 keeps every axe check. The last moved to bundle-security's neutral heading ("Plan link, no longer active").
  - checkout.spec.ts keeps both sides.
  - clinic-app.spec.ts equals e2e-shard-ready's.
- **Error pages:**
  - error.tsx keeps error-boundaries' `ErrorScreen` (main and h1).
  - global-error.tsx:20-24 keeps `lang` and #10's `<title>`.
  - patient-pages-mobile's per-`[token]` error pages (`plan/[token]`, `intake/[token]`, `join/[token]` and `components/patient/patient-error.tsx`) were replaced by error-boundaries' segment-level `plan/`, `intake/` and `join/` pages. The bundle's `patient-pages-mobile.test.tsx` was updated to those paths. It still pins a 44px "Try again", 16px text and an h1, and it passes on the tip. This is a deliberate, tested consolidation; it is listed so it is not mistaken for a loss.
- **ci.yml:**
  - **Jobs:** all 7 jobs survive (lint, typecheck, test, build, changes, e2e, e2e-sharded-trial), with every step from main, bundle-security, ci-playwright-container, ci-actions-node24 and e2e-shard-ready.
  - **e2e job:** runs in the pinned Playwright container (`v1.58.2-noble`, `--user 1001`) with the image-match check.
  - **Versions:** NODE_VERSION is '20' everywhere. All actions are on the Node 24 majors: checkout@v7, setup-node@v7, upload-artifact@v7, cache@v6.
  - **Tests:** the ci-actions, ci-playwright-container, image-guard and e2e-shards tests pass.
- **package.json:**
  - The 20 packages remove-dead-code removed are imported nowhere on the tip.
  - No dependency or script from any incoming head is missing. zod is at ^4.6.7, as intended.
- **perf-bundles:**
  - the `dynamic()` kanban (orders-dashboard.tsx:43) and QR code (plan-link-panel.tsx:19) are present;
  - `signOutInBrowser` is used in hipaa-timeout, sidebar-nav, nav-sign-out-button and unauthorized sign-out;
  - its tests pass.
- **todo-sweep:**
  - order-drawer.tsx:16 has the "No Rx PDF preview" comment and no placeholder;
  - settings/page.tsx:259 has no "Coming soon";
  - the F5 diagnostic is gone;
  - its tests pass.
- **remove-dead-code's code edits** are identical on the tip, and its tests pass.
- **Non-merge commits:** 17c99f48 adds placeholder names only to `.env.example` (no values, no duplicates); 2b671408 is the report commit.

## Considered, not confirmed
- **Four writes with "no cross-site check"** (the reviewer's script searched only for `crossSite`): group-and-send, checkout-link, batch-sign and POST /api/patients. All four have an inline `sec-fetch-site` same-origin check on the tip, so they are covered and this is not a gap.
- **`providers/[providerId]/licenses` and `npi-check` do not uuid-check providerId before `clinicAdminForProvider`.** api-input-validation never touched these files, so it is not a merge loss. The helper checks the id: api-input-validation's review recorded "clinicAdminForProvider checks the uuid".
- **e2e/accessibility-all-routes.spec.ts:51-53 is not shard-aware.** It hard-codes `test-a11y-ma@compoundiq.test` under a comment asking for `shardEmail()`, and AUTH_DIR (:49) has no shard suffix. With no `fullyParallel`, the file runs on one shard, so no failure was shown. A cheap follow-up.
- **e2e-sharded-trial still runs on `ubuntu-latest`** and installs browsers itself. The dry-run report notes this as deliberate.
