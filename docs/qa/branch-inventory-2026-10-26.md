# Branch inventory, 2026-10-26

D-2026-10-26-06. Every branch on origin (214, after `git fetch --prune` on 2026-10-26), so nothing is lost or merged twice. Read only: nothing was deleted, merged or pushed except this doc.

## How each status was decided

- **MERGED**: in main. Either the branch is an ancestor of `origin/main`, or merging it into main changes nothing (`git merge-tree`), or GitHub shows its pull request merged (squash merges leave no ancestry), with no commit pushed after the PR's head (checked for every one: none has a non-merge commit after its PR head). Where: the PR number.
- **QUEUED**: one of the 13 PRs of the current plan (runbook Part 2, bundle-docs ee98417d).
- **CONTAINED**: fully inside a queued branch: an ancestor of it (every commit is there). Where: every queued branch that contains it; the first one listed merges it.
- **SUPERSEDED**: replaced by another branch (named).
- **DOCS-ONLY**: review, report or design branches that change only `docs/`, `reviews/` or top-level `*.md`, not inside bundle-docs.
- **ORPHAN**: none of the above. Each is described below for a decision.
- **SPECIAL**: `main` and `orchestrator-tasks`.
- **Agents**: the agent letters found in the branch's own commit messages (task ids such as `D-2026-10-25-17`); "–" where the commits name none (most work before Oct 23).
- PR states come from the GitHub API (pull requests #73 to #272).

## Counts

| Status | Branches |
|---|---|
| MERGED | 156 |
| QUEUED | 13 |
| CONTAINED | 31 |
| SUPERSEDED | 2 |
| DOCS-ONLY | 6 |
| ORPHAN | 4 |
| SPECIAL | 2 |
| **Total** | **214** |

## Needs a decision

### ORPHAN (4): work in no PR, no bundle and not on main

- **`demo-payouts-live-key-guard`** (a6cb967b, 2026-10-24, C): H1 from the Oct 24 security review: `isDemoPayoutsEnabled` returns false when `STRIPE_SECRET_KEY` is a live key (sk_live_/rk_live_), with a red test (2 files, +84/-1). PR #267 merged the review with H1 split out (revert ad8effcb on security-review-oct24-no-h1), and no queued branch has it: main's `src/lib/clinics/demo-payouts.ts` has no live-key check. Real code, not merged anywhere: decide whether H1 ships (its own PR) or is dropped.
- **`dependabot/npm_and_yarn/npm_and_yarn-e7c415db2f`** (c8b0864b, 2026-10-25): Open Dependabot PR #272 (Oct 25): the npm_and_yarn group, 4 updates, package files only. Not in the plan. Decide merge or close; PR #270 (zod 4 and npm audit fix) merged the day before.
- **`middleware-to-proxy`** (fdd07568, 2026-10-25, D): Open PR #266 (D-2026-10-24-03, brought up to date with main on Oct 25): renames `src/middleware.ts` to `src/proxy.ts` (the Next 16 convention), 46 files, +378/-175, tests pinned. Not in the 13-PR plan. Real code. Every bundle edits `src/middleware.ts` (bundle-hipaa adds the password-reset and sign-in public paths), so if it merges after the bundles it needs those edits carried into `proxy.ts`; if it merges first, every bundle conflicts.
- **`request-access`** (a7f9f083, 2026-10-14): Oct 14: an `access_requests` table (migration `20261020000001_access_requests.sql`, down file, a static test), 3 files, no app code. That migration number is now taken on main by `20261020000001_self_serve_signup.sql` (PR #240), and main has no `access_requests` anywhere. Looks superseded by self-serve sign-up; if the table is still wanted it needs a new number. Real (migration) code.

### Commits not in their bundle

- **`order-transmission-integrity`** (f4b7487a) ships inside signed-order-freeze (#13), and has **2 commits signed-order-freeze does not have yet** (`git log origin/signed-order-freeze..origin/order-transmission-integrity`):
  - `f4b7487a fix(transmission): D's verification 1-7: redirect hops, key only where safe, key rotation, legacy cutoff from env`
  - `36cf5a31 test(transmission): red tests for D's verification findings 1-7`

  These are A's fixes for my verification (verify-transmission). Merge order-transmission-integrity into signed-order-freeze again before #13 merges.
- No other branch has commits outside the queued branch that contains it: every CONTAINED branch is an ancestor of its bundle, and every member merged into bundle-hipaa is at the head that was merged.

### DOCS-ONLY (6): not in bundle-docs

| Branch | Head | Last commit | Agents | Where |
|---|---|---|---|---|
| `bundle-review` | e2196818 | 2026-10-25 | C | not in bundle-docs |
| `design-patient-protocol-choice` | a269d26c | 2026-10-24 | D | not in bundle-docs |
| `docs-run-sheet-v3` | 526293e1 | 2026-10-26 | B, D | not in bundle-docs |
| `review-high-risk` | 380a96d0 | 2026-10-25 | C | not in bundle-docs |
| `review-hipaa-fixes` | e1aa579b | 2026-10-26 | B | not in bundle-docs |
| `verify-transmission` | 75c3256d | 2026-10-26 | D | not in bundle-docs |

None is on main or in bundle-docs. `docs-run-sheet-v3` and `design-patient-protocol-choice` read like docs meant to ship; the review and verification branches are records. Decide which go into bundle-docs (or their own docs PR); the rest can be kept as records or deleted after the plan merges.

## QUEUED (13)

| Branch | Head | Last commit | Agents | Where |
|---|---|---|---|---|
| `ops-fax-viewer-documo` | da99864b | 2026-10-25 | A, B, D | #1 fax (000003) |
| `rls-user-write-lockdown-v2` | 9611fd23 | 2026-10-25 | C, D | #2 lockdown v2 (000004) |
| `security-followups-2` | e53ec166 | 2026-10-25 | A, B, D | #3 sf-2 (000005) |
| `signup-squatting` | 9e139268 | 2026-10-25 | B | #4 signup-squatting (000006) |
| `rate-limit-db` | 3c4791cf | 2026-10-25 | A | #5 rate-limit-db (000007) |
| `bundle-security` | b2d05dda | 2026-10-25 | A, B, C | #6 bundle-security |
| `bundle-ci` | a03ac017 | 2026-10-25 | A, B, C, D | #7 bundle-ci |
| `bundle-features` | 8af58776 | 2026-10-25 | A, B, C, D | #8 bundle-features |
| `bundle-hipaa` | 726ded31 | 2026-10-26 | A, B, C, D | #9 bundle-hipaa |
| `bundle-docs` | ee98417d | 2026-10-25 | A, C, D | #10 bundle-docs |
| `perf-indexes` | 228c147b | 2026-10-25 | C | #11 perf-indexes (000008) |
| `clinical-difference-saved` | d21721a0 | 2026-10-25 | A, B, C, D | #12 clinical-difference-saved (000009) |
| `signed-order-freeze` | 495441f0 | 2026-10-26 | A, B, C, D | #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |

## CONTAINED (31)

| Branch | Head | Last commit | Agents | Where |
|---|---|---|---|---|
| `api-input-validation` | 26f1c9a6 | 2026-10-25 | C | #6 bundle-security; #7 bundle-ci; #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `audit-review-breakglass` | 7ef4590f | 2026-10-25 | A, B, C, D | #9 bundle-hipaa |
| `auth-monitoring` | 438d960e | 2026-10-25 | A, B, C, D | #9 bundle-hipaa |
| `checkout-token-out-of-url` | e040c711 | 2026-10-25 | A | #6 bundle-security; #7 bundle-ci; #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `ci-actions-node24` | 45e72119 | 2026-10-25 | A | #7 bundle-ci |
| `ci-playwright-container` | 87f7a7e3 | 2026-10-25 | A | #7 bundle-ci |
| `clinic-help` | 96f74e33 | 2026-10-25 | A, B, C, D | #9 bundle-hipaa |
| `docs-oct25` | 9358cca0 | 2026-10-25 | A | #10 bundle-docs |
| `docs-prod-clickthrough` | 0ed4ea77 | 2026-10-25 | D | #10 bundle-docs |
| `docs-requirements-coverage` | 21de8666 | 2026-10-25 | D | #10 bundle-docs |
| `dry-run-report` | 0508fd3d | 2026-10-25 | A | #10 bundle-docs |
| `e2e-axe-all-routes` | b7770f80 | 2026-10-25 | D | #7 bundle-ci |
| `e2e-hipaa` | 9dccacf7 | 2026-10-26 | A, B, C, D | #9 bundle-hipaa |
| `e2e-shard-ready` | 28133fad | 2026-10-25 | D | #7 bundle-ci |
| `error-boundaries` | c0bbcc7c | 2026-10-25 | B | #6 bundle-security; #7 bundle-ci; #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `favorites-frequent` | 76a6964e | 2026-10-25 | C, D | #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `flake-show-checklist` | dd257e53 | 2026-10-25 | A | #7 bundle-ci |
| `order-transmission-integrity` | f4b7487a | 2026-10-26 | A, B, C, D | #13 signed-order-freeze (000010, with order-transmission-integrity 000011); 2 newer commits not in it yet |
| `password-flows` | 1d0ed5e1 | 2026-10-25 | A, B, C, D | #9 bundle-hipaa |
| `patient-pages-mobile` | 250613f4 | 2026-10-25 | C | #7 bundle-ci |
| `perf-bundles` | c2355360 | 2026-10-25 | C | #7 bundle-ci |
| `phi-access-log-coverage` | 07a12024 | 2026-10-26 | A, B, C, D | #9 bundle-hipaa |
| `remove-dead-code` | 6f8eabf5 | 2026-10-25 | C | #7 bundle-ci |
| `rx-allergies-required` | 080519a1 | 2026-10-25 | A, C | #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `rx-quantity-shipping` | 9e2b075a | 2026-10-25 | D | #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `security-followups-3` | ea321e84 | 2026-10-25 | C | #6 bundle-security; #7 bundle-ci; #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `settings-notifications` | c1d9e765 | 2026-10-25 | B | #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `state-machine-enforcement` | b0bd60f8 | 2026-10-25 | B | #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |
| `test-data-cleanup-script` | 52f8f709 | 2026-10-25 | A, B | #7 bundle-ci |
| `todo-sweep` | bbd934d5 | 2026-10-25 | C | #7 bundle-ci |
| `token-pages-hardening` | 80785343 | 2026-10-25 | A | #6 bundle-security; #7 bundle-ci; #8 bundle-features; #9 bundle-hipaa; #12 clinical-difference-saved (000009); #13 signed-order-freeze (000010, with order-transmission-integrity 000011) |

## SUPERSEDED (2)

| Branch | Head | Last commit | Agents | Where |
|---|---|---|---|---|
| `e2e-mfa-spec` | 1108731e | 2026-10-11 | – | by e2e-mfa-spec-v2 (PR #223, merged); its own PR #221 was closed unmerged |
| `rls-user-write-lockdown` | 47db60da | 2026-10-24 | D | by rls-user-write-lockdown-v2 (queued #2) for 000004; its Oct 24 review commits merged through PR #267, except H1 |

## MERGED (156)

| Branch | Head | Last commit | Agents | Where |
|---|---|---|---|---|
| `a11y-landmarks` | 9572cfed | 2026-10-24 | C | PR #257 (squash) |
| `admin-lands-on-practice` | f9a41aba | 2026-10-06 | – | PR #192 (squash) |
| `auth-getuser-routes` | 9bb2033e | 2026-10-09 | – | PR #210 (squash) |
| `batch-sign-dashboard-fixes` | 05f38b50 | 2026-09-25 | – | PR #180 (squash) |
| `batch1-fail-loud` | 7004f1f9 | 2026-09-20 | – | PR #164 (squash) |
| `batch1-followup` | b596cf8a | 2026-09-21 | – | PR #165 (squash) |
| `batch2-followup` | 7e9c43ff | 2026-09-22 | – | PR #170 (squash) |
| `batch2a-webhook-expiry` | 71e2fa89 | 2026-09-21 | – | PR #167 (squash) |
| `batch2b-refunds` | cc67d8e6 | 2026-09-21 | – | PR #168 (squash) |
| `batch2c-refill-packages` | d278e49c | 2026-09-21 | – | PR #169 (squash) |
| `catalog-unit-corrections` | 15adc993 | 2026-09-26 | – | PR #183 (squash) |
| `ci-e2e-throughput` | d25b0cef | 2026-10-24 | D | PR #258 |
| `ci-install-deps-timeout` | 1b4a7d4d | 2026-10-23 | B | PR #249 |
| `ci-pin-supabase-cli` | f7d11f78 | 2026-10-14 | – | PR #237 |
| `clinic-agreements` | 761e95c1 | 2026-10-11 | – | PR #228 (squash) |
| `clinic-drawer-failure-reason` | a90dba13 | 2026-10-24 | C | PR #251 (squash) |
| `clinic-signup-link` | 8956b2eb | 2026-10-15 | – | PR #239 (squash) |
| `clinic-ui-fixes-oct14` | 65071159 | 2026-10-15 | – | PR #238 (squash) |
| `compliance-compounding-fields` | 20e1e6de | 2026-10-09 | – | PR #211 (squash) |
| `compliance-consent-intake-foundations` | f5cb28a7 | 2026-10-06 | – | PR #196 (squash) |
| `compliance-controlled-substances` | 63fb1660 | 2026-10-07 | – | PR #201 (squash) |
| `compliance-headers-trackers` | 5084b487 | 2026-10-06 | – | PR #195 (squash) |
| `compliance-mfa` | 44836d35 | 2026-10-06 | – | PR #193 (squash) |
| `compliance-pharmacy-licensure` | f85d8844 | 2026-10-07 | – | PR #203 (squash) |
| `compliance-phi-access-log` | 179e8032 | 2026-10-06 | – | PR #199 (squash) |
| `compliance-prescriber-verification` | c7410773 | 2026-10-07 | – | PR #202 (squash) |
| `compliance-stripe-phi` | da4625c1 | 2026-10-06 | – | PR #194 (squash) |
| `compliance-wcag-checkout-intake` | ab25dc87 | 2026-10-09 | – | PR #206 (squash) |
| `count-units-pellet-supp` | 9ab5e5db | 2026-09-27 | – | PR #182 (squash) |
| `cycling-dose-math` | 4a706a5d | 2026-09-25 | – | PR #179 (squash) |
| `cycling-migration` | b451cdc0 | 2026-09-24 | – | PR #178 (squash) |
| `demo-data-oct23` | 387cae53 | 2026-10-23 | – | PR #245 (squash) |
| `deps-next-16-4-3` | 217f5046 | 2026-10-24 | B | PR #252 (squash) |
| `docs-baa-draft-v0-1` | 7e411a7d | 2026-10-09 | – | PR #213 (squash) |
| `docs/demo-v212-ma-flow-rbac-stripe-safety` | baae6004 | 2026-09-10 | – | PR #126 (squash) |
| `docs/demo-v213-draft-count` | f481f7f3 | 2026-09-10 | – | PR #127 (squash) |
| `docs/demo-v214-remove-unverified-claims` | d65fb780 | 2026-09-10 | – | PR #128 (squash) |
| `draft-sign-checks` | 48fa79d2 | 2026-09-21 | – | PR #166 (squash) |
| `drop-status-history-trigger` | 8b137c2d | 2026-09-15 | – | PR #145 (squash) |
| `e2e-flake-first-run-checklist` | e9ef4b69 | 2026-10-24 | C | PR #255 (squash) |
| `e2e-mfa-spec-v2` | 658ba09a | 2026-10-11 | – | PR #223 (squash) |
| `e2e-oct24-coverage` | 5727e34a | 2026-10-24 | B | PR #262 (squash) |
| `e2e-refill-nav-provider` | b42db23e | 2026-09-19 | – | PR #158 (squash) |
| `ehr-sync-keragon` | c29674cc | 2026-10-13 | – | PR #231 (squash) |
| `epcs-verify-fix` | 104f9255 | 2026-09-22 | – | PR #171 (squash) |
| `eslint-config-next-16-4` | 8e68053a | 2026-10-24 | A | PR #261 |
| `face-sheet-hide-without-key` | 53149ee6 | 2026-10-24 | C | PR #260 |
| `feat/gap3-linkage-writer` | 8b93c5a1 | 2026-08-22 | – | PR #120 (squash) |
| `feat/ops-catalog-clarity-and-demo-warmup` | 759b0e3e | 2026-09-10 | – | PR #123 (squash) |
| `first-run-onboarding` | 88ecf279 | 2026-10-20 | – | PR #244 (squash) |
| `fix-auto-submit-paid-orders` | 0cb3eefb | 2026-10-06 | – | PR #190 (squash) |
| `fix-csp-and-log-followups` | 1d1dabb6 | 2026-10-06 | – | PR #200 (squash) |
| `fix-dashboard-cards-refill` | 53afd16f | 2026-10-05 | – | PR #189 (squash) |
| `fix-demo-npi-guard` | d4cb5b3d | 2026-10-07 | – | PR #204 |
| `fix-dosing-and-connect-role` | 6ee099d0 | 2026-10-06 | – | PR #197 (squash) |
| `fix-draft-titration-loss` | 94a9f055 | 2026-09-20 | – | PR #155 (squash) |
| `fix-margin-draft-race` | d0cb5434 | 2026-09-17 | – | PR #154 (squash) |
| `fix-notifications-copy` | dab41db5 | 2026-10-14 | – | PR #236 |
| `fix-order-record-timeline-session` | 8ca010f8 | 2026-09-14 | – | PR #143 (squash) |
| `fix-pharmacy-wizard-refresh` | 43777541 | 2026-10-11 | – | PR #222 (squash) |
| `fix-protocol-edit-quantities` | 68e9bdd7 | 2026-10-06 | – | PR #191 (squash) |
| `fix-protocol-line-pricing` | 91a38bd0 | 2026-10-05 | – | PR #188 (squash) |
| `fix-qa-batch-1` | 6598733d | 2026-10-07 | – | PR #205 (squash) |
| `fix-refill-fail-loud` | b2edae68 | 2026-09-19 | – | PR #156 (squash) |
| `fix-refill-nav-race` | 3c61e5b8 | 2026-09-19 | – | PR #157 (squash) |
| `fix-slack-no-free-text` | 21de4fe0 | 2026-10-06 | – | PR #198 (squash) |
| `fix-sms-tracking-url` | 64cf34c1 | 2026-10-13 | – | PR #235 |
| `fix-status-history-writers` | a0a16371 | 2026-09-15 | – | PR #144 |
| `fix-stripe-double-transfer` | d7a061b9 | 2026-09-14 | – | PR #140 (squash) |
| `fix/auth-refresh-race` | 7f424571 | 2026-09-11 | – | PR #129 (squash) |
| `fix/drawer-post-combine-group-state` | e4a7d0bb | 2026-08-17 | – | PR #119 (squash) |
| `fix/gap3-protocol-order-linkage` | 587425a3 | 2026-08-22 | – | PR #118 |
| `fix/ops-console-hanging-routes` | 31ff0c20 | 2026-09-09 | – | PR #122 (squash) |
| `fix/protocol-partial-load-and-demo-doc-v210` | 27fd9b27 | 2026-09-09 | – | PR #121 (squash) |
| `fix/remove-inpage-auth-clinic-routes` | 10684d8a | 2026-09-10 | – | PR #125 (squash) |
| `fix/remove-poc-credential-sync-cron` | c44e8e24 | 2026-09-11 | – | PR #130 (squash) |
| `fix/session-refresh-cookie-propagation` | d9276a42 | 2026-09-10 | – | PR #124 (squash) |
| `intake-face-sheet` | e8d7e393 | 2026-10-23 | B | PR #246 (squash) |
| `intake-self-service` | f289e4e0 | 2026-10-11 | – | PR #227 (squash) |
| `invite-accept-rate-limit` | a4042064 | 2026-10-11 | – | PR #218 (squash) |
| `lauren-polish-oct23` | 2e59acde | 2026-10-24 | B, C | PR #248 (squash) |
| `legal-pharmacy-terms` | a274f900 | 2026-10-11 | – | PR #224 (squash) |
| `legal-public-pages` | 1de45766 | 2026-10-11 | – | PR #225 (squash) |
| `legal-v1-final` | 9e179da6 | 2026-10-12 | – | PR #229 |
| `lint-supabase-errors` | c5b37319 | 2026-10-02 | – | PR #185 (squash) |
| `lint-warnings-zero` | e805578f | 2026-10-24 | B | PR #254 (squash) |
| `nav-after-redirect-audit` | eb87578e | 2026-10-24 | A | PR #253 (squash) |
| `next-16-4-followthrough` | 96f8e53a | 2026-10-24 | D | PR #256 |
| `onboarding-clinic` | a208d588 | 2026-10-10 | – | PR #215 (squash) |
| `onboarding-pharmacy` | 80fa9e24 | 2026-10-11 | – | PR #220 (squash) |
| `ops-onboarding-review` | 6de2e3c3 | 2026-10-11 | – | PR #226 (squash) |
| `ops-pipeline-tier-filter` | cff6277b | 2026-10-24 | B, D | PR #259 (squash) |
| `ops-review-self-signup` | f1afb2fd | 2026-10-23 | A | PR #247 (squash) |
| `package-unit-conversion` | c934d686 | 2026-09-26 | – | PR #181 (squash) |
| `patient-csv-import` | 45f58100 | 2026-10-12 | – | PR #230 (squash) |
| `payments-ledger` | 185e4d86 | 2026-10-13 | – | PR #232 (squash) |
| `peptides-orderable` | 28d9dd93 | 2026-10-10 | – | PR #214 (squash) |
| `pharmacy-license-upload-4mb` | 5c046f7c | 2026-10-24 | A | PR #250 (squash) |
| `pharmacy-live-only` | 8d6568ed | 2026-09-23 | – | PR #174 (squash) |
| `platform-fee-off` | 0a4ce334 | 2026-10-18 | – | PR #241 (squash) |
| `portal-clinic-payout-copy` | 44c9f024 | 2026-10-11 | – | PR #219 (squash) |
| `proposals-pr1-data-model` | 13e40956 | 2026-10-24 | C | PR #268 (stacked: an ancestor of proposals-pr5-e2e, the head #268 merged) |
| `proposals-pr2-provider-propose` | 06ccf28a | 2026-10-24 | B, C | PR #268 (stacked, as above) |
| `proposals-pr3-patient-page` | 8f3f83ae | 2026-10-24 | C | PR #268 (stacked, as above) |
| `proposals-pr4-sign-choice` | 5c579c15 | 2026-10-24 | B, C | PR #268 (stacked, as above) |
| `proposals-pr5-e2e` | 6596c8dc | 2026-10-24 | B, C, D | PR #268 |
| `protocol-create` | 1f109db1 | 2026-10-19 | – | PR #242 (squash) |
| `qa-batch-2` | d6b202d9 | 2026-10-11 | – | PR #216 (squash) |
| `qa-batch-3` | 2297b6b1 | 2026-10-13 | – | PR #233 (squash) |
| `react-19` | d07756ab | 2026-10-24 | C | PR #263 |
| `refill-current-dosage-form` | fcb05bbd | 2026-10-01 | – | PR #184 (squash) |
| `retention-foundations` | eb49c41f | 2026-10-09 | – | PR #209 (squash) |
| `security-app-metadata-roles` | 6daea736 | 2026-10-08 | – | PR #208 (squash) |
| `security-followups-oct24` | 089551b8 | 2026-10-24 | D | PR #264 |
| `security-review-oct24` | f9f69049 | 2026-10-24 | D | PR #267 (security-review-oct24-no-h1 contains it and reverts H1 in ad8effcb: see demo-payouts-live-key-guard) |
| `security-review-oct24-no-h1` | 79e3ff13 | 2026-10-24 | C, D | PR #267 |
| `self-serve-signup` | 95e7e703 | 2026-10-18 | – | PR #240 (squash) |
| `settings-admin-only` | bee54aab | 2026-09-23 | – | PR #177 (squash) |
| `stripe-webhook-gaps` | e5df9c96 | 2026-10-11 | – | PR #217 (squash) |
| `supabase-errors-crons-webhooks` | fa1c14ec | 2026-10-03 | – | PR #186 (squash) |
| `supabase-errors-write-routes` | 96634dd9 | 2026-10-05 | – | PR #187 (squash) |
| `team-invites` | 0f0700e8 | 2026-10-19 | – | PR #243 (squash) |
| `tier2-no-auto-fax` | f60138df | 2026-10-08 | – | PR #207 (squash) |
| `ui-polish-oct12` | 2b992d56 | 2026-10-13 | – | PR #234 (squash) |
| `waiting-268` | 05b807fd | 2026-10-24 | B |  |
| `waiting-268-c` | 0f173cdf | 2026-10-24 | C |  |
| `wcag-mfa-unauthorized` | bbf2ae38 | 2026-10-09 | – | PR #212 (squash) |
| `wo-100-provider-self` | bc0c2158 | 2026-09-13 | – | PR #132 (squash) |
| `wo-101-packages` | d64c6e34 | 2026-09-14 | – | PR #137 (squash) |
| `wo-101a-multi-vial` | 79e2e3dd | 2026-09-14 | – | PR #138 (squash) |
| `wo-101b-package-sizes` | 4a4fec35 | 2026-09-14 | – | PR #142 (squash) |
| `wo-102-shipping` | 82514eb0 | 2026-09-14 | – | PR #139 (squash) |
| `wo-103-search-favorites` | 73580eb7 | 2026-09-13 | – | PR #133 (squash) |
| `wo-104-favorites` | a2f3cc0b | 2026-09-14 | – | PR #141 (squash) |
| `wo-96-fix-derived-fields` | cc051c65 | 2026-09-13 | – | PR #136 (squash) |
| `wo-96-rx-fields` | fad82a25 | 2026-09-12 | – | PR #131 (squash) |
| `wo-97-allergies` | 8cea20f0 | 2026-09-13 | – | PR #135 (squash) |
| `wo-98-edit-review` | b891a58f | 2026-09-13 | – | PR #134 (squash) |
| `wo105-code` | db763bd4 | 2026-09-16 | – | PR #147 (squash) |
| `wo105-docs` | a7234941 | 2026-09-16 | – | PR #148 (squash) |
| `wo105-migration` | 95f24eaf | 2026-09-15 | – | PR #146 |
| `wo105-rounding-comment` | c1dee9fc | 2026-09-16 | – | PR #149 |
| `wo105-steps-leak` | ae4e58de | 2026-09-16 | – | PR #150 (squash) |
| `wo106-below-cost-guard` | c5ad10f0 | 2026-09-20 | – | PR #161 (squash) |
| `wo106-code` | f4af37da | 2026-09-18 | – | PR #153 (squash) |
| `wo106-docs` | f73305cf | 2026-09-22 | – | PR #151 |
| `wo106-migration` | 2e53e19e | 2026-09-18 | – | PR #152 (squash) |
| `wo106-refill-notes` | 59b3d26b | 2026-09-19 | – | PR #159 (squash) |
| `wo106-refresh-survives` | 593b07d8 | 2026-09-19 | – | PR #160 (squash) |
| `wo107-migration` | 0dc993ee | 2026-09-23 | – | PR #175 (squash) |
| `wo107-practice` | b304c99b | 2026-09-23 | – | PR #176 (squash) |
| `wo108-reprice-refill` | 2837b755 | 2026-09-20 | – | PR #163 (squash) |
| `wo108-work-order` | 26fe7b0a | 2026-09-20 | – | PR #162 |
| `wo99-batch-sign` | bbf206b6 | 2026-09-22 | – | PR #172 (squash) |
| `wo99-followup` | 7489ecfc | 2026-09-22 | – | PR #173 (squash) |
| `zod-4` | 8690c549 | 2026-10-25 | B, D | PR #270 |

## SPECIAL (2)

- `main`: the default branch.
- `orchestrator-tasks`: the orchestrator's task files. Never edited by the agents.

## Safe to delete after all 13 PRs merge (nothing deleted now)

Delete only once the whole plan is on main, and re-run the ancestry check first:

1. **Every MERGED branch** (156): their work is on main.
2. **Every CONTAINED branch** (31), once the queued branch named for it is merged. `order-transmission-integrity` only after its 2 newer commits are in signed-order-freeze and that PR is merged.
3. **The 13 QUEUED branches**, each after its PR merges.
4. **SUPERSEDED**: `e2e-mfa-spec` (PR #221 closed; v2 merged) and `rls-user-write-lockdown` (after lockdown v2 merges, and after the H1 decision: its H1 commit `4b6d8745` is the other copy of demo-payouts-live-key-guard).

Keep: `main`, `orchestrator-tasks`, the ORPHANs until each is decided, and the DOCS-ONLY branches until their docs are either merged or no longer needed.
