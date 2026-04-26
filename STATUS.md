# Engineering Status — In-Flight Work

**Last updated:** 2026-04-26 — R7-Bucket-1 (HIPAA bfcache + sign-out hard-nav) shipped via PR #44 (commit `fac1de2`). Chrome browser-agent smoke verified PASS on both in-scope checks (PHI sign-page Back-after-sign-out + dashboard KPI Back-after-sign-out). Stripe Link finding deferred to follow-up WO with HIGH severity (correct fix is client-side `wallets: { link: 'never' }` + `@stripe/stripe-js` SDK upgrade from ^4 to ^7.5+; currently active in production).

**Prior: 2026-04-25** — Demo-readiness round v2.4→v2.5 complete. PR #41 (cron cadence F2) + PR #42 (Favorites delete UI + DELETE clinic-scope guard F1) merged. Production Ketotifen residue (5 rows) cleared via UUID-targeted DELETE. Ready for the next browser-agent walkthrough on v2.5.

**Prior: 2026-04-21** — **E2E REFRESH CAMPAIGN COMPLETE.** All 15 merged PRs + 1 closed no-op. E2E now runs on push/PR with `continue-on-error` removed. Last dispatch 65 passed / 0 failed / 5 skipped in 2.1 min. PR #20 (unskip) green on its own push-event run.
**Purpose:** Durable record of outstanding work. Survives AI-assistant context compaction and is readable by any engineer picking up the repo. Update this as items complete.

---

## Quick state

**Live app:** https://functional-medicine-infrastructure.vercel.app
**Main branch:** commits `78735aa` (Toaster dedupe) + `cad82f6` (ESLint migration) + prior work through WO-87.
**Demo doc:** `docs/POC-DEMO-DETAILED.pdf` — validated through 6 rounds of Cowork QA with zero remaining findings.
**Mobile validation:** test plan at `docs/mobile-validation-test-plan.pdf`; user still needs to run on real iPhone + Android hardware.
**Launch-kit:** clinic outreach templates ready at `docs/launch-kit/*.docx`; nothing sent yet.

---

## Completed campaign: E2E test refresh (PRs 1–7, 2026-04-20 → 2026-04-21)

**Result:** The entire Playwright E2E suite is green and gating merges on push/PR. `continue-on-error: true` removed. Last dispatch 65 passed / 0 failed / 5 skipped in 2.1 min.

**Campaign principles that held up** (kept for future engineers working this repo):
- Two-agent review chain (internal Explore + external cowork) before non-trivial code.
- Dispatch-verify every PR before stacking the next.
- Don't hide things: no `test.skip` without a clear follow-up note; no production-code test hooks.
- Split coverage by layer when Playwright's abstraction fails (Option Z): unit-test state machines, E2E asserts mount + direct-DB downstream.
- "One more dispatch" boundary: any Playwright-internal theory-driven fix gets ONE dispatch to verify; if it fails, pivot to pre-committed fallback.

**What's left as post-launch polish** (see Backlog below):
- Populate `sk_test_*` `STRIPE_SECRET_KEY` in CI secrets so checkout Test B Phase 2 exercises the full Stripe test-mode round-trip.
- `storageState` auth pre-warm: replaces per-test logins with pre-authed session cookies. Eliminates rate-limit risk entirely. Durable long-term fix.
- Unit test for `BatchReviewForm` signature state transitions.
- API-level integration test for `/api/orders/{id}/sign` Twilio/Documo suppression.

## Pre-campaign context (preserved for reference)

### Why this campaign existed

The 5 Playwright E2E tests in `e2e/` have been silently rotting for months because the CI pipeline was broken at earlier jobs (Lint / Build) and never reached the E2E job. Once those earlier issues got fixed (this session), E2E failures surfaced. Shortcut options (`continue-on-error`, `skip` on push) were applied and then explicitly rejected by the user: *"we do not hide things or skip over things, when we find an issue we fix it."*

### Review chain

Every PR in this sequence is drafted, then reviewed by:
1. **Internal Claude Explore agent** — reads the code, checks claims against actual implementation
2. **External Cowork agent** — independent review via a prompt the user pastes into cowork

Only after both reviews converge does implementation start. This prevents the "Claude took the easy path" class of error.

### PR status dashboard

| # | Title | State | Branch | Notes |
|---|---|---|---|---|
| #4 | `fix(a11y): remove duplicate sonner Toaster` | ✅ **MERGED** | ~~fix/dedupe-toaster~~ | Accessibility bug + source of "2 alerts" strict-mode test failure |
| #5 | `fix(lint): migrate ESLint off FlatCompat` | ✅ **MERGED** | ~~fix/eslint-flatcompat~~ | Lint gate is now genuinely enforcing. 48 warnings remain as backlog. |
| #3 | Dependabot: next 16.2.4 + follow-redirects | ✅ **all checks green, pending human merge** | `dependabot/npm_and_yarn/npm_and_yarn-690c4e3fa7` | Had to populate Dependabot-specific secret store separately from repo secrets. |
| #6 | `chore(e2e): isolate E2E tests on dedicated Supabase project` | ✅ **MERGED** (83fdc8b) | ~~chore/e2e-supabase-isolation~~ | Dedicated Supabase project `pythornowwddvkhwmsbd`, 37 migrations applied, 4 E2E_* secrets populated, all E2E paths hard-fail without E2E_* env vars, CI has migration-sync step. |
| #7 | `fix(e2e): idle-timeout warning selector no longer hits strict mode` | ✅ **MERGED** (c56459e) | ~~fix/idle-timeout-selector-strict-mode~~ | Replaced `.or()` union locator (matched dialog + inner `<p>` simultaneously) with `getByRole('dialog', { name: /Session Expiring Soon/i })`. Internal + cowork review both confirmed via static analysis — diagnostic PR skipped. |
| PR 4 (schema) | Fix PHI seed + orders insert schema drift | ❌ **CLOSED, NO-OP** | — | Both reviews walked every `orders` migration; empirical insert proved the schema is sound. Original hypotheses wrong. |
| #8 | `test(e2e): rewrite clinic-app.spec for cascading prescription builder` | ✅ **MERGED** | ~~rewrite/clinic-app-spec-cascading-builder~~ | Rewrote `navigateToReviewPage` for the 4-step cascading flow; extended `seedStaticData` with V3 hierarchical catalog (ingredient / salt_form / formulation / pharmacy_formulation) + smoke-test assertion; added `aria-label` to medication search input + 4 sig-builder selects (pure a11y, no behavior change). |
| #9 | `test(e2e): rewrite feature-flags Twilio test for cascading builder` | ✅ **MERGED** | ~~rewrite/feature-flags-spec-cascading-builder~~ | Mechanical repeat of PR #8's pattern on feature-flags.spec. |
| #10 | `ci(e2e): build + npm run start instead of next dev` | ✅ **MERGED** | ~~ci/e2e-build-and-start~~ | Option B' approved by both reviews; eliminated the 50+ min `next dev` hang in CI. E2E job now deterministic: `npm run build` → `next start` → Playwright. Zero Vercel changes required. |
| #11 | `fix(e2e): auth strict-mode + HIPAA clock timing + ops pipeline selector` | ✅ **MERGED** | ~~fix/e2e-mechanical-auth-and-ops~~ | 3 mechanical fixes — wrong-password filter + HIPAA clock install before goto + ops pipeline h2 selector. |
| #12 | `test(hipaa-timeout): move timer coverage to unit tests` | ✅ **MERGED** | ~~fix/hipaa-timeout-unit-test~~ | **First unit test in repo.** Option Z: jest.useFakeTimers covers the 30-min timer state machine; E2E only asserts a hidden sentinel (`data-testid="hipaa-timeout-root"`) is mounted. Added @testing-library/react + jest-dom. Follow-up removed unenforced 80% coverage threshold from jest.config.ts. |
| #13 | `fix(e2e): signature canvas uses pointer events + correct text string` | ✅ **MERGED** (partial) | ~~fix/e2e-signature-canvas-pointer-events~~ | Text-string bug fixed (`'✓ Signature captured'` → `'Signature captured'`). Pointer-event dispatch did NOT work — superseded by #14. |
| #14 | `fix(e2e): signature canvas uses native PointerEvent via page.evaluate` | ✅ **MERGED** (didn't fix root issue) | ~~fix/e2e-signature-canvas-native-pointerevent~~ | Per cowork review #5: Playwright's `locator.dispatchEvent('pointerdown')` creates a plain Event with coords discarded. Switched to `page.evaluate` + native `new PointerEvent()`. Still failed dispatch verification — headless signature_pad rejects even correctly-typed synthetic events. |
| #15 | `fix(e2e): signature canvas path-B fallback — mount-only + direct insert` | ✅ **MERGED** | ~~fix/signature-canvas-path-b-unit-test-and-mount-only~~ | Hard-boundary pivot per cowork review #5: stop fighting Playwright's input synthesis. E2E walks cascading builder → asserts canvas mounted + Sign & Send disabled. 8-step Stripe test seeds AWAITING_PAYMENT directly (bypassing UI sign). Twilio test skipped with follow-up note to convert to API-level. |
| PR 6.3 | Stripe Elements checkout cross-browser fix | ⏳ **NEXT** | — | Current failures: `checkout.spec.ts:67` on firefox / webkit / mobile-chrome (chromium passes). USER CONSTRAINT: keep all browsers covered (do NOT gate to Chromium-only — iPhone Safari is a real patient-facing target). Four options drafted for cowork review #6: (1) debug Stripe init in headless non-chromium, (2) page.route-stub js.stripe.com, (3) convert to API-level test of `/api/checkout/payment-intent`, (4) combo 2+3. Awaiting cowork verdict. |
| PR 6.4 | Ops reroute status transition investigation | ⏳ | — | `ops-dashboard.spec.ts:40` (chromium only). Test inserts SUBMISSION_FAILED order, clicks Reroute, polls 15s for "Reroute Pending" status — never appears. Real application-layer issue, not a selector fix. Options: polling interval, RLS with service-role insert, API timing. Needs investigation before fixing. |
| PR 7 | Re-enable E2E on push/PR (no skip, no continue-on-error) | ⏳ | — | Final PR. Remove `if: github.event_name == 'workflow_dispatch'` + `continue-on-error: true` from the `e2e` job. Only merges after PR 6.3 + 6.4 are green on dispatch. |

### Current dispatch state

Run 24723347780 (2026-04-21, post-PR #15):
- 57 passed, 4 failed, 3 skipped
- Delta from original (PR #10 first dispatch): 49→57 passed, 13→4 failed
- Remaining 4 failures all have PRs planned (6.3 + 6.4 above)

### Durable lessons captured during this campaign

These are cross-campaign principles surfaced by repeatedly being wrong about Playwright internals. Memory files store the permanent version for future sessions; summarising here so anyone reading this file also sees them.

**The Playwright-abstraction limit.** For browser-native interactions (timers, canvas input, iframe comms, pointer events, fake clocks), Playwright's abstraction layer does NOT behave like a real user event:

- `page.clock.install()` is CDP-scoped on Chromium — does not survive navigations (PR #11 partial miss).
- `page.getByRole('alert')` matches framework-injected elements you don't own (Next.js's `__next-route-announcer__` broke PR #11 round 1).
- `page.mouse.*` dispatches MouseEvents; libraries that listen only to pointer events (signature_pad v4) ignore them entirely (PR #13 miss).
- `locator.dispatchEvent('pointerdown', {...})` constructs a plain `Event`, NOT a `PointerEvent`. Coordinate properties are silently dropped (PR #14 miss).
- `page.evaluate` + native `new PointerEvent()` still doesn't register in every case — some libraries (signature_pad in headless) reject programmatic input at a layer no external dispatch can reach (PR #15 fallback).

**Corollary — Option Z.** When Playwright can't reliably drive a browser-native interaction, split coverage by layer: unit-test the state machine in jest, E2E assert only mount/integration. HIPAA timer (PR #12) and signature canvas (PR #15) both followed this pattern.

**Review chain is load-bearing.** The two-agent review (internal Explore + external cowork) caught multiple would-have-burned-a-cycle bugs BEFORE implementation — notably the `'✓ Signature captured'` checkmark mismatch cowork spotted in review round 2, which would have made PR #13 silently fail even if pointer events had worked.

**"One more dispatch" boundary.** Cowork review #5 established: any theory-driven Playwright-internal fix gets ONE dispatch verification. If it fails, immediate pivot to the pre-committed fallback. No more iteration. This stopped the signature canvas debate from consuming more cycles.

### Review findings archive (decisions already made)

**Toaster duplication (PR #4, merged):**
- Confirmed real bug: `src/app/layout.tsx` root + `src/components/providers.tsx` both mounted `<Toaster />`. Every authenticated page got 2 live regions.
- Fix: remove the root Toaster. Public routes (`/login`, `/unauthorized`, `/checkout/*`) don't use `toast()`, so they didn't need one.
- Decision: **fix the UI, not the test selectors.** Using `.first()` would mask the a11y bug.

**ESLint FlatCompat (PR #5, merged):**
- Root cause: `@eslint/eslintrc` FlatCompat wrapping `next/core-web-vitals` threw `TypeError: Converting circular structure to JSON` on ESLint 9. `eslint-config-next@16.x` ships native flat configs; FlatCompat was double-wrapping plugins with circular refs.
- Fix: drop FlatCompat; `import coreWebVitals from 'eslint-config-next/core-web-vitals'` directly.
- Removed `continue-on-error: true` from Lint job.
- Removed `--max-warnings 0` from npm script (standard: errors block, warnings inform).
- 12 React 19 Compiler rule findings downgraded to warnings transitionally (see backlog).
- `react-hooks/purity` turned off for server components (`app/**/page.tsx`, `**/layout.tsx`, `api/**/route.ts`) because they render once per request — `Date.now()` is correct there.

**Key constraints identified by reviewers:**
- Don't fix both app AND tests at once — causes regression risk.
- The clinic-app.spec.ts flow is NOT stale selectors — it's testing a **wizard that no longer exists**. Full rewrite required.
- Check if E2E Supabase = production demo project before re-enabling CI. If same project, test runs could corrupt demo data.
- React 19 Compiler rules (set-state-in-effect, static-components, purity) are best-practice hints, not bugs. Real patterns work; refactoring needs care.

### Key file locations for remaining PRs

| Area | Path |
|---|---|
| Failing E2E specs | `e2e/auth.spec.ts`, `e2e/clinic-app.spec.ts` |
| PHI seed helper | bottom of `e2e/clinic-app.spec.ts` (test order insert around line 316) |
| Static seed | `e2e/fixtures/` (deterministic UUIDs) |
| Playwright config | `playwright.config.ts` (webServer block lines 79-89) |
| Global setup | `e2e/global-setup.ts` |
| Current UI flow (for rewrite) | `src/app/(clinic-app)/new-prescription/` — patient selector → cascading builder → margin → review |
| CI workflow | `.github/workflows/ci.yml` — `e2e` job at line ~168 |
| Orders schema | `supabase/migrations/` (latest: `20260411000001_orders_formulation_support.sql`) |

### Commands for the next engineer to pick this up

```bash
# Sync + see where you are
git checkout main && git pull origin main

# Run tests locally (what CI does)
npm run lint
npm run type-check
npm test
npm run test:e2e  # will likely fail locally same way as CI; that's the point

# Check outstanding PR status
gh pr list --repo PhoenixWild29/functional-medicine-infrastructure --state open

# Create PR 2 branch (first up)
git checkout -b chore/verify-e2e-supabase-isolation
```

---

## Backlog (not in the E2E campaign)

### Short-term

- **Refactor 11 React 19 Compiler findings** — `react-hooks/set-state-in-effect` (8 sites), `react-hooks/static-components` (3 in `sidebar-nav.tsx`). Currently downgraded to warnings via `eslint.config.mjs`. Files affected: `src/app/(clinic-app)/dashboard/_components/order-drawer.tsx`, `src/app/(clinic-app)/new-prescription/_context/prescription-session.tsx`, `src/app/(ops-dashboard)/ops/pipeline/_components/order-detail-drawer.tsx`, `src/components/main-content-offset.tsx`, `src/components/sidebar-nav.tsx`. Estimated 2-4 hrs careful work. Open a separate PR after PR 7 merges.
- **Clean up 37 `no-unused-vars` warnings** — all cosmetic. Either remove or prefix with `_`. Mostly in test files, utility scripts, and a few components.
- **Fix Foundry Data Layer blueprint edit-tool bug** — 8090.ai platform bug where `edit_blueprint` returns "old_text does not match" for all edits on blueprint ID `3a3f585a-eec5-4283-bbb6-040331dc6611`. Workaround used: paste-back from local file. Report to 8090.ai support so future updates don't hit the same wall.
- **Populate `STRIPE_SECRET_KEY` for CI E2E with a test-mode key (`sk_test_*`)** — current GH secret was pulled from Vercel production env, which is a LIVE key. As a result, Test B Phase 2 in `e2e/checkout.spec.ts` (Stripe `pm_card_visa` confirmation) skips on every CI run. The skip is logged as a test annotation so it's visible. To unlock Phase 2: grab the TEST secret key from Stripe dashboard (test-mode toggle) → `gh secret set STRIPE_SECRET_KEY --repo PhoenixWild29/functional-medicine-infrastructure` (repo scope + `--app dependabot` scope). Vercel production env stays on the live key. After that, Phase 2 covers the Stripe test-mode PI confirmation round-trip for every PR.

### Medium-term

- **First real clinic outreach** — `docs/launch-kit/clinic-outreach-email.docx` Template 1 to 5-8 warm contacts. Highest-leverage unblocker for revenue.
- **LegitScript certification application** — $975 + BAA paperwork. `docs/launch-kit/legitscript-application-checklist.docx`. 2-4 week turnaround.
- **6 vendor BAA requests** — Supabase, Stripe, Twilio, Documo, Vercel, Sentry. See `docs/launch-kit/pre-launch-checklist.docx` bucket 1.6. Some take 1-2 weeks.
- **Mobile validation on real devices** — `docs/mobile-validation-test-plan.pdf`. 30-min run on iPhone + Android. User side.

---

## Principles to hold (from prior user feedback)

1. **Don't hide things, don't skip over things.** When CI fails, fix the underlying issue. `continue-on-error` and `skip` conditions are band-aids that get called out. Use them only with explicit time-boxed backlog commitment.
2. **Review before acting on non-trivial changes.** Both internal agent and external cowork. Prevents rabbit-hole and premature implementation.
3. **Small, reviewable PRs.** Each PR digestible in one sitting; merge before opening the next. User wants to check between each.
4. **Production safety first.** The live demo is always working. Every change is tested locally before pushing.
5. **Document the why, not the what.** Comments should explain non-obvious decisions, not restate code.

---

## Recent context worth preserving

### Session 2026-04-25/26 — R7-Bucket-1 HIPAA bfcache + sign-out hard-nav

Round-7 browser-agent walkthrough surfaced 12 findings, triaged into four buckets. Bucket 1 (three HIPAA findings) shipped via PR #44 with one mid-flight scope adjustment.

- **Shipped (PR #44 / fac1de2):** Three layers of bfcache defense — middleware `applySecurityHeaders` helper applied to 6 return paths sets `Cache-Control: no-store, no-cache, must-revalidate, private` + `Pragma: no-cache` + `Expires: 0` on every authenticated/PHI response while explicitly skipping `/login` + `/auth/callback` + `/api/webhooks` + `/api/cron` + `/api/health` + `/api/checkout` (Supabase OAuth code-exchange relies on auth-callback caching); new `BfcacheGuard` component with `pageshow` listener that reloads when `event.persisted === true` (Chrome's bfcache is more aggressive than no-store alone handles); new `redirectToLogin()` wrapper around `window.location.replace` threaded through all four sign-out call sites (NavSignOutButton, /unauthorized SignOutButton, SidebarNav, HipaaTimeout). Chrome smoke verified PASS post-merge.
- **Mid-flight scope adjustment:** Original commit 3/3 attempted server-side Stripe Link suppression via `payment_method_options.link.display = 'never'` — Stripe API rejected it as unknown parameter. Forward-revert (no force-push, per repo convention). Cowork's post-failure review identified that the correct fix is client-side `PaymentElement.options.wallets.link: 'never'`, but our `@stripe/stripe-js@4.10.0` doesn't expose `link` in `PaymentWalletsOption` until ^7.5.0 — three-major-version SDK upgrade required. Walked back to DEFER, scoped as a follow-up WO. Cast-through-`Record<string, unknown>` was the warning sign neither pre-flight reviewer respected. See [feedback_stripe_api_verify_against_live.md](../../.claude/projects/c--Users-ssham-OneDrive-Functional-Medicine/memory/feedback_stripe_api_verify_against_live.md).
- **Smoke-test mishap:** First Chrome smoke run reported FAIL because the smoke prompt pointed at production while PR #44 was still open. Production served pre-merge `main`, agent correctly reproduced the actual production bfcache leak. Re-run post-merge confirmed PASS. See [feedback_smoke_test_url_match_PR_state.md](../../.claude/projects/c--Users-ssham-OneDrive-Functional-Medicine/memory/feedback_smoke_test_url_match_PR_state.md).
- **Open follow-ups (HIGH-priority HIPAA Link finding still active in prod):**
  - Stripe Link client-side fix + `@stripe/stripe-js` SDK upgrade (HIGH severity, currently active in production)
  - Lint guard against `as Record<string, unknown>` / `as any` in Stripe-touching files
  - PR-template / CONTRIBUTING checklist requiring API-doc URL + parameter quote when SDK types don't expose a parameter
  - Live Stripe test-mode CI smoke call (gated on a 30-min audit of secret authenticity, Connect-account state, fork-PR access, rate limits, flake handling, test location)
  - Cosmetic polish: post-bfcache `?redirectTo=` value reflects last-served authenticated route rather than the back-target page (security correct, UX slightly stale)

### Session 2026-04-24/25 — Demo-readiness round v2.4→v2.5

Browser-agent walkthrough of v2.4 surfaced two LOW findings; both closed.

- **F2 (PR #41 / fee2a73's parent 9a785cb):** Every Adapter Health card rendered as "Degraded" because `refresh-demo-data` anchors the freshest row at `now − 2min` while the cron ran hourly — cards crossed the 15-min green threshold ~13 min after each tick. Fix: cron cadence `0 * * * *` → `*/10 * * * *` (one-line `vercel.json` change). Cowork rejected an earlier classifier-widening plan — that would have regressed real production alerting (a real pharmacy silent for an hour would no longer alarm). See [feedback_cadence_vs_classifier.md](../../.claude/projects/c--Users-ssham-OneDrive-Functional-Medicine/memory/feedback_cadence_vs_classifier.md).
- **F1 (PR #42 / fee2a73):** 5 "Ketotifen QID test" / "QID retest" favorites in production from Phase 18 QA validation, no in-app way for the provider to remove them. Shipped: trash icon + two-step Confirm/Cancel pattern in `quick-actions-panel.tsx`, plus a clinic-scope guard on `DELETE /api/favorites` (was open to any logged-in user pre-PR). 6 new tests lock the 401/403/400/404/403/200 contract. Production residue cleaned by UUID-targeted DELETE 2026-04-25 — 4 canonical seeds (`c1000000-...0001..0004`) verified intact. See [feedback_qa_residue_pattern.md](../../.claude/projects/c--Users-ssham-OneDrive-Functional-Medicine/memory/feedback_qa_residue_pattern.md).
- **Process:** Reviewer agent + cowork second opinion before code on both findings. Cowork's reviewer-line-citation drift flag (cited line 35 in a 34-line file, lines 694-700 in a 577-line file) is a recurring meta-issue worth an eventual retro item.

### Session 2026-04-20 highlights (pre-compaction)

- Repo went private (Priority 1 repo hygiene pass) → reverted to public same day due to Vercel/GitHub integration confusion. Decision: stay public for now.
- 13 GitHub repo secrets populated from Vercel env (one-time).
- 13 Dependabot-scoped secrets populated separately (Dependabot uses its own secret store for security — repo secrets aren't exposed to Dependabot PRs).
- LICENSE file added (proprietary, all rights reserved).
- CONTRIBUTING.md added at repo root.
- README.md got 4 badges (CI, license, Next.js 16, TypeScript strict).
- CI workflow `Deploy` (custom one) disabled — Vercel's GitHub integration handles all deploys.
- Dual `main`/`master` branch situation resolved: master deleted, main is the default, all future work targets main.
- `claude/mystifying-zhukovsky` stale local branch + orphan worktree removed.
- Dependabot PR #3 (next 16.2.4, follow-redirects, axios) merged as part of this session.

### Older context summaries (if needed, pull from memory or older commits)

- Phases 1-19 + WO-87 hotfix all shipped (orders.formulation_id dual-catalog support, EPCS 2FA, drug interactions, cascading builder, provider favorites, protocol templates, credential drift prevention).
- POC credentials synced daily via `/api/cron/poc-credential-sync` cron + `/ops/demo-tools` in-app reset button.
- Software factory (Refinery + Foundry on 8090.ai) synced through WO-87.
- Investor memo v3.0 updated and PDF-rendered.
- Launch-kit with 6 Word docs (outreach, LOI, checklists) all committed to repo.

---

## Meta: How to update this file

When completing a PR: move it from "⏳" to "✅ MERGED" in the dashboard and note the commit SHA.
When discovering new context: add to the appropriate section, don't delete prior entries.
When compaction happens: this file is the source of truth — re-read it fully.
Keep under ~500 lines. Archive detailed context to `docs/archive/` if it grows.
