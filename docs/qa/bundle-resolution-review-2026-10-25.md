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

---

## bundle-features (B), reviewed later the same day (C-2026-10-25-13)

`origin/bundle-features` at **f75138e7**, on bundle-security b4b2cf8b. Reviewed the same way as above, by a fresh reviewer, with my own checks. Nothing newer than f75138e7 was on the branch when this was written; B's planned E2E spec on top was not yet pushed.

### Summary
**Nothing lost.** 0 high, 0 medium; 3 low items, all from the branches themselves, not the merges.

Whole tip f75138e7:
- tsc is clean.
- Jest: 626 suites and 6860 tests, all passing.
- The reviewer's targeted run (orders, proposals, adapters, favorites API, orders API, new-prescription) passed 108 suites and 1560 tests in a fresh worktree.

### Merges
| Merge | Branch | Conflicts | Result |
|---|---|---|---|
| be017540 | state-machine-enforcement (b0bd60f8) | none | The branch's diff landed exactly |
| f921db66 | rx-quantity-shipping (9e2b075a) | margin-builder-form, batch-sign-form, new-protocol-form | The branch's diff landed exactly; bundle-security's lines untouched |
| 4d2c9608 | rx-allergies-required (080519a1) | allergy-notice, lib/proposals/propose.ts, sign-choice.ts | Same |
| e6ce2e20 | favorites-frequent (76a6964e) | quick-actions-panel, wo104-favorites-model.test, favorites/recent/route.ts (modified by bundle-security, deleted by the rename) | Only the combination fixes stated in the commit body, each read |
| 98af5fb4 | settings-notifications (c1d9e765) | none | The branch's diff landed exactly |
| f75138e7 | (report) | none | Splits the dispense-bound test in two. Sound: 50,000 gets the route's own limit message, 5e9 gets the schema 400, nothing is inserted in either |

- **How the merges were compared:** for each merge, every file the incoming branch changed was compared two ways: the branch's own diff (merge-base 2696ff24 to `^2`) against what the merge changed (`M^1` to `M`). They were identical except for e6ce2e20's stated fixes.
- **No undoing:** no later merge touched a file outside its own branch's diff, so none undid an earlier resolution.
- **Untouched since b4b2cf8b:** playwright.config.ts, `.github`, package.json, the lockfile, and the error and global-error pages.
- **E2E:** no spec was deleted.

### Files
Every file on the six source heads is present on f75138e7, except `src/app/api/favorites/recent/route.ts` and its bundle-security test `favorites/recent/__tests__/staff-role-gate.test.ts`. That is the deliberate rename to `/frequent`. The test moved to `favorites/frequent/__tests__/staff-role-gate.test.ts` with only URLs and labels changed, and nothing in `src` or `e2e` references `/api/favorites/recent`.

### Checks asked for
- **Route handlers:** these merges only add lines to bundle-security's handlers (actorRole, dispenseCount, a select column, spec text). Nothing was removed or reordered.
  - `favorites/frequent` GET:
    - withApiErrors (:142);
    - getUser (:45);
    - isClinicStaffRole → 403 (:48);
    - UUID_RE → 400 (:56);
    - then the SQL-windowed read (:89).
  - `orders` POST (refuseCrossSite :50, dispenseCount :379) and `orders/[orderId]` PATCH/DELETE (:175/:334, dispenseCount :294) keep the order cross-site, then auth, then parse, then write.
- **State machine:** all 36 non-test `casTransition` call sites pass `actorRole`, matching who acts:
  - `system`: crons, Documo, pharmacy and Stripe webhooks, the routing engine, tier4-fax, proposal expiry;
  - `ops_admin`: 7 in the ops order action, 2 in the ops fax action;
  - the clinic actor via `clinicActorRole` in propose.ts:428-442 and sign-choice.ts:104-108;
  - the ops reroute keeps its `patch` (reroute_count, pharmacy_id) in one UPDATE, and payment-expiry keeps its casTransition;
  - no direct `orders.status` update came back.
- **Quantity and unit (rx-quantity-shipping):**
  - `dispenseCount` (rx-details.ts:967) and `formatQuantity` are intact;
  - tier1, tier2, tier4 and the transformers still select package_label, package_count, dispense_quantity and dispense_unit;
  - the fax PDF prints "Quantity: N unit(s)" (prescription-pdf.ts:191), and the OpenAPI has `quantityUnit`;
  - against 9e2b075a, these files are byte-identical except one actorRole line in tier4;
  - D's fix for the 2026-10-25 review's HIGH (one meaning for quantity, with its unit) is c0653d42 with test 1b55c12a, and it survived.
- **Allergies gate:**
  - batch-sign keeps both `missing_snapshot` (:108, :312) and `allergies_required` (:122, :676, :805);
  - propose.ts returns the single `ALLERGIES_REQUIRED` / `PLAN_ALLERGIES_REQUIRED_MESSAGE` refusal (:35, :183-184);
  - the prompts survive: batch-review-form (:801, :941, `promptFor="plan"` :1340), batch-sign-form :279, allergy-notice `promptFor` (:42, :125).
- **Favorites rename:**
  - `/api/favorites/recent` and `onLoadRecent` are gone;
  - the panel's only "Recent" is the intended fallback label;
  - make-favorite-dialog keeps `patientDoses` (:48, :85) and the reset on a patient change (:71-78);
  - input-validation and frequent-route tests target `/frequent`, with bundle-security's "403 for another clinic's provider" assertion carried over;
  - the E2E uses the `favorites-frequent` and `frequent-item` test ids, which the component has.
- **Settings Notifications card** (settings/page.tsx:259-272): it states what is sent ("CompoundIQ does not send email", with a link "See what is sent") and makes no "coming soon" promise. The no-email claim holds: the only email-like code is the invite resend, and the daily digest goes to Slack.

### Considered, not confirmed (low, from the branches, not the merges)
- `settings/notifications/page.tsx:46` (from c1d9e765) says "Notification settings are coming", a future promise on the sub-page. Sam's call whether to keep it, in line with the TODO sweep's removal of "Coming soon" from the Settings card.
- `e2e/clinic-app.spec.ts:1566, :1598` and `fixtures/seed.ts:876` still say "Recent" in a header comment, a describe title and a helper name (as on 76a6964e). The test body checks Frequently used. Cosmetic.
- `recentFormulations` and `RECENT_LIMIT` (lib/orders/favorite-presets.ts:361, :387) are now used only by their own unit test. Dead code (as on 76a6964e).
