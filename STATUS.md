# Engineering Status — In-Flight Work

**Last updated:** 2026-08-15 — **CATALOG-RESEED FALLOUT FIXED + R10 WALKTHROUGH PASS.** Production at commit `9771f1d`+. The user found that the V3 catalog reseed had orphaned the provider quick actions — favorites 404'd on click (foreign keys still pointed at old-catalog rows) and protocol templates loaded with $0.00 stub pricing. Remediation: a **prod data fix** (favorites/protocol items remapped to the reseeded V3 catalog; new product **Ketotifen Capsule 1mg** added at $22 wholesale) plus three PRs merged — **#109** (protocols load real wholesale pricing + clinic-default markup; stale-favorite hardening so dangling FKs degrade gracefully instead of 404ing), **#110** (Review & Send signature/validation feedback: disabled-send hint "Sign in the signature box above to enable sending" replacing the silent no-op), **#111** (bundle-link recovery: "Part of a Payment Bundle" drawer panel + Copy Bundle Payment Link via new `/api/orders/[id]/group-link`, plus a specific "part of a combined payment bundle" message when an old solo link is opened for a bundled order; a tsc pass during the PR caught a polling regression before merge). The **R10 walkthrough ran against prod** (2026-08-15, all roles) — report at `docs/qa-reports/qa-poc-demo-round10-report.md`: **PASS across provider / clinic-admin / ops**, 0 open blockers, including a live 4-prescription bundle checkout render at $444.80 (payment intentionally not executed — live Stripe key). Demo doc bumped to v2.8 to match. **Open items unchanged:** Lauren 503B email, local PDF/DOCX regeneration + git pull, secrets rotation out of `.env.local`.

**Prior: 2026-07-08** — **DOC-DEBT CLEARED + R9 + DEPENDABOT #97 + LOW BACKLOG FIXES (#107).** Production at commit `ab29457`. Since the 07-07 entry, the doc-audit execution ran (#101–#104: demo doc v2.6 with the 166-product catalog + Phase C Combine-and-Send narration; README/DEPLOYMENT/ARCHITECTURE/technical-ref refresh; ERD table-count + $286 bundle-total fixes), the **R9 walkthrough ran against prod** (2026-07-07) — confirming the V3 catalog is live in production — and produced two doc corrections (#105, demo doc → v2.7: retail defaults to the 40% markup / $133, with $190 as the explicit 2× scenario; Semaglutide surfaces 5 direct formulations) plus one code fix (#106: Sign & Send UI gated to providers). This session (new-agent takeover): committed the three **local-only handoff docs** STATUS.md was referencing (`docs/handoff/project-state-2026-06-14.md`, `project-assessment-2026-07-02.md`, `documentation-audit-2026-07-07.md` — written locally but never pushed due to the local git-auth issue); merged dependabot **#97** (@opentelemetry/core 2.8.0 + form-data 4.0.6 security fix; branch updated from main first, full CI green); shipped **#107** closing both LOW follow-ups from the 2026-07-02 batch review (solo-path `dispute_orders` junction write + `purge-phi-debug` unit test). **Next:** rotate live secrets out of `.env.local` (user action, open since 07-02), regenerate the demo-doc PDF/DOCX from the v2.7 markdown (local `npm run docs:pdf` / `docs:docx`), then revenue tracks — clinic outreach (ready since 2026-05-27, still unsent), Lauren 503B email, LegitScript, 6 vendor BAAs — and mobile validation on real devices.

**Prior: 2026-07-07** — **CATALOG SHIPPED + TYPES CLEANUP + DOC AUDIT.** Production at commit `e5d2bff`. Three PRs merged since the 07-02 batch: **#98** (166-product demo catalog CSV at `docs/research/catalog-seed/compoundiq-catalog-seed-v1.csv`), **#99** (completed `adapter_submission_debug_payloads` in `database.types.ts` + removed the two `as unknown as` casts — hand-completed from migration `20260614000002`; publish gotcha was CRLF-vs-LF line endings, not the code), **#100** (V3 hierarchical catalog importer: `scripts/import-catalog-v3.ts` / `npm run seed:catalog` + `scripts/generate-catalog-sql.py`). The catalog — 76 ingredients / 56 salt forms / 166 formulations (33 combos), synthetic demo pricing across BHRT, thyroid, peptides, GLP-1, sexual health, dermatology, LDN, IV therapy — loads into the V3 tables via `npm run seed:catalog` or a paste-ready SQL seed for the Supabase editor. A full documentation audit (`docs/handoff/documentation-audit-2026-07-07.md`) found the demo doc + technical refs stale for Phase C and the catalog. **⚠ Seed note:** the seed keys idempotency on deterministic UUIDs, not natural keys — if the V3 catalog already holds the older 5-med hand-seed, loading adds duplicate name rows; check before running. **Next:** load catalog into prod, then demo-doc rewrite + R9 walkthrough, then revenue tracks (clinic outreach still unsent; Lauren 503B email unblocks real pricing).

**Prior: 2026-07-02** — **JUN-14 PR BATCH CLEARED + FULL PROJECT ASSESSMENT.** After ~7 weeks idle (last activity 2026-06-15), a full assessment ran (3 parallel agents + live GitHub/prod verification; report at `docs/handoff/project-assessment-2026-07-02.md`). The stalled 2026-06-14 batch was then reviewed per PR #95's prompt and merged: #90 (Pending Payment rename, PASS), #91 (dispute_orders fan-out, PASS-w/f — description corrected: solo path writes 0 junction rows), #92 (F-3 clinic-view toggle, PASS-w/f — cross-clinic isolation verified absolute), #93 (F-5 primary_provider_id, PASS), #94 (PHI debug table, PASS-w/f — **MEDIUM fixed on-branch:** purge cron daily→hourly; daily 03:00 sweep allowed ~48h worst-case PHI residence vs the documented 24h, now ~25h), #95 (review-prompt doc), dependabot #89 (esbuild security), and new #96 (removed orphan `adapter-health-check` cron that 404'd in prod every 10 min — no route ever existed). Root cause of the Jun-15 E2E failures on #92/#93/#94: **migration-history mismatch on the shared E2E Supabase project** — #91's run applied `20260614000001` remotely, so sibling branches lacking it failed `supabase db push` in ~70s; fixed by updating each branch from main and running CI serially. Production at commit `c9d79c1`. **Next:** regen `database.types.ts` (removes the hand-edits + 2 documented casts), then revenue tracks — clinic outreach (ready since 2026-05-27, nothing sent), LegitScript, 6 vendor BAAs — and the venture-studio partnership package (bracketed sections awaiting Lauren Perkins). **Security note (user action):** `.env.local` holds live Stripe/Supabase/DB/Sentry secrets in the OneDrive-synced folder — rotate keys and switch to `vercel env pull` on demand.

**Prior: 2026-04-27 (Late)** — **R7-BUCKET-1 FOLLOW-UP CAMPAIGN COMPLETE + R8 BACKLOG SHIPPED.** Production at commit `1cd99cc`. Both R8 backlog items (WO-93 Fax panel overflow + WO-94 cross-tier demo orders) and the meta-WO-95 walkthrough-prompt template all shipped (PRs #55, #56, #57). MCP statuses: WO-87, 88, 89, 91, 92, 93, 94, 95 → completed; WO-90 → wontfix under live-key constraint. Demo + production are in sync; partner-facing PDFs re-rendered to match. Demo doc fixed for the "Sla→SLA" tab caps that PR #51 introduced and a soft-update for cross-tier narration now that WO-94's seed exposes T1/T2/T3/T4 in the Ops pipeline. Ready for next-track planning (investor / clinic-onboarding tracks per the post-R8 sequencing review).

**Prior: 2026-04-27 (PM)** — **R7-BUCKET-1 FOLLOW-UP CAMPAIGN COMPLETE.** All six phases shipped (PRs #46, #48, dependabot #49, #50, #51, #52, #53; production at commit `add0cac`). R8 browser-agent walkthrough verdict: **PASS** with 1 LOW finding + 0 false-positives. R7's 28% false-positive rate dropped to 0% after the verify-before-report prompt update — process change paid for itself. All seven targeted regression checks PASS: bfcache PHI fix, bfcache KPI fix, Stripe Link suppression, Ops drawer Tier field, "SLA" tab capitalization, Fax Triage panel readability, clinic name in checkout header. WO statuses (at-time): WO-87, 88, 89, 91, 92 → completed; WO-90 → wontfix under live-key constraint; WO-93 + WO-94 filed in backlog. Production verified live via curl headers + R8 walkthrough.

**Prior: 2026-04-27 (AM)** — R7-Bucket-1 follow-up sequencing locked. PR #46 (WO-89 PR-template + CONTRIBUTING.md doc-citation rule) shipped (commit `37301cd`). Phase 0 audits revealed: WO-87 is Tier S, WO-90 must wontfix under the project constraint "Stripe live key only in CI; no `sk_test_*` provisioning," Bucket 2 is "4 cosmetic + 1 MEDIUM 'Tier —' split + 2 dropped non-bugs." WO-90 closed wontfix with reopen triggers; WO-92 filed as the type-check smoke replacement. WO-91 audit reduced scope to a 1-line BfcacheGuard change (folded into Phase 3).

**Prior: 2026-04-26** — R7-Bucket-1 (HIPAA bfcache + sign-out hard-nav) shipped via PR #44 (commit `fac1de2`). Chrome browser-agent smoke verified PASS on both in-scope checks (PHI sign-page Back-after-sign-out + dashboard KPI Back-after-sign-out). Stripe Link finding deferred to follow-up WO with HIGH severity (correct fix is client-side `wallets: { link: 'never' }` + `@stripe/stripe-js` SDK upgrade from ^4 to ^7.5+; currently active in production).

**Prior: 2026-04-25** — Demo-readiness round v2.4→v2.5 complete. PR #41 (cron cadence F2) + PR #42 (Favorites delete UI + DELETE clinic-scope guard F1) merged. Production Ketotifen residue (5 rows) cleared via UUID-targeted DELETE. Ready for the next browser-agent walkthrough on v2.5.

**Prior: 2026-04-21** — **E2E REFRESH CAMPAIGN COMPLETE.** All 15 merged PRs + 1 closed no-op. E2E now runs on push/PR with `continue-on-error` removed. Last dispatch 65 passed / 0 failed / 5 skipped in 2.1 min. PR #20 (unskip) green on its own push-event run.
**Purpose:** Durable record of outstanding work. Survives AI-assistant context compaction and is readable by any engineer picking up the repo. Update this as items complete.

---

## Quick state

**Live app:** https://functional-medicine-infrastructure.vercel.app
**Main branch:** commit `9771f1d` (2026-08-15) — through PR #111. Post-reseed fixes (#109 protocol real pricing + stale-favorite hardening, #110 Review & Send signature/validation feedback, #111 bundle-link recovery + bundled-order checkout message) merged on top of the 07-08 state (#101–#107 + dependabot #97). Phase C multi-Rx groups live; F-3/F-5 role features shipped; V3 catalog live in prod (verified by R9; re-verified with real pricing by R10).
**Demo doc:** source at v2.7 (R9-corrected, `docs/archive/source/POC-DEMO-DETAILED.md`); `docs/POC-DEMO-DETAILED.pdf`/`.docx` exports still need local regeneration via `npm run docs:pdf` / `docs:docx`. Validated through 9 rounds of walkthrough QA.
**Mobile validation:** test plan at `docs/mobile-validation-test-plan.pdf`; user still needs to run on real iPhone + Android hardware.
**Launch-kit:** clinic outreach templates ready at `docs/launch-kit/*.docx`; nothing sent yet.
**Assessment:** `docs/handoff/project-assessment-2026-07-02.md` — current risks + recommended track order. Prior handoff: `docs/handoff/project-state-2026-06-14.md`. (Both committed to the repo 2026-07-08 — they were local-only before.)

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
- ~~Populate `sk_test_*` `STRIPE_SECRET_KEY` in CI secrets so checkout Test B Phase 2 exercises the full Stripe test-mode round-trip.~~ **WONTFIX 2026-04-27** under the project constraint "Stripe live key only in CI; no `sk_test_*` provisioning." Replacement coverage via Stripe SDK type-check smoke (WO-92). See `project_constraint_stripe_live_key_only.md` for reopen triggers.
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
| PR 6.3 | Stripe Elements checkout cross-browser fix | ✅ **RESOLVED** | — | Resolved during the E2E refresh campaign via Option 3 (convert to API-level test). Current `e2e/checkout.spec.ts` shape: Test A (server-rendered render check) runs on all 4 browsers; Test A.2 (Link suppression, structural) runs on all 4 browsers; Test B (PaymentIntent client_secret) is browserless + chromium-only by design (`test.skip(browserName !== 'chromium')`) since running browserless API logic 4× wastes CI minutes without coverage gain. Stripe's own iframe is Stripe's responsibility — not ours to drive in tests. iPhone Safari coverage of OUR code remains via Tests A / A.2 / C on `webkit` + `mobile-chrome`. Verified green on every post-campaign main run (latest: 71 passed / 0 failed / 5 skipped). |
| PR 6.4 | Ops reroute status transition investigation | ✅ **RESOLVED** | — | Closed via PR #18 (`8bf19b5`) "fix(e2e): ops reroute assertion matches actual status label" + PR #19 (`47e8fb7`) "fix(e2e): ops reroute DB-truth + checkout amount aria-label (PR 6.4.1)". The rewrite shape: instead of polling 15s for "Reroute Pending" UI text, the test now asserts (a) the order row disappears from the SUBMISSION_FAILED filter view, and (b) the DB reflects `status === 'REROUTE_PENDING'` via a polling loop on `supabase.from('orders').select('status')` — DB as source of truth, not UI text. See `e2e/ops-dashboard.spec.ts:88-117`. Test runs green on every post-campaign main CI run. |
| PR 7 | Re-enable E2E on push/PR (no skip, no continue-on-error) | ✅ **MERGED** | — | Shipped as PR #20 (campaign-close). E2E now runs on every push/PR with `continue-on-error: true` removed — see campaign-summary at top of this file ("Last dispatch 65 passed / 0 failed / 5 skipped in 2.1 min. PR #20 (unskip) green on its own push-event run.") |

### Current dispatch state (post-campaign-close)

Most recent main-branch CI (2026-04-27, post-PR #58):
- **71 passed, 0 failed, 5 skipped (1.6m)**
- 5 skipped are by-design (Test B's non-chromium variants + signature-canvas Option Z mounts) — not regressions

E2E refresh campaign closed 2026-04-21 with all planned PRs landed; no outstanding work in this section.

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
| Orders schema | `supabase/migrations/` (latest: `20260614000004_f5_patients_primary_provider_id.sql`) |

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

# Regenerate DB types (removes the hand-edits + casts from the Jun-14 batch)
npm run db:types
```

---

## Backlog (not in the E2E campaign)

### Short-term

- ~~**Regen `database.types.ts`** — all 4 Jun-14 migrations are live in prod and their PRs merged; `npm run db:types` then remove the two documented `as unknown as` casts in `src/lib/adapters/audit-trail.ts` + `src/app/api/cron/purge-phi-debug/route.ts`. Mechanical.~~ **DONE 2026-07-07 via PR #99** — types hand-completed from migration `20260614000002`, both casts removed. A clean `npm run db:types` regen when a local env is available remains a nice-to-have.
- ~~**Solo-path `dispute_orders` junction write** — LOW from the 2026-07-02 review of PR #91: `handleSoloChargeDisputeCreated` writes 0 junction rows, so ops JOIN queries through `dispute_orders` only cover group disputes. Small follow-up.~~ **DONE 2026-07-08 via PR #107** (`ab29457`).
- ~~**Unit test for `/api/cron/purge-phi-debug`** — LOW from the PR #94 review: 0-row delete + `deleted` count surfacing untested.~~ **DONE 2026-07-08 via PR #107** (`ab29457`).
- **Rotate live secrets out of `.env.local`** (user action) — live `sk_live_`, Supabase service-role JWT, DB password, Sentry token sit in the OneDrive-synced project folder. Git-ignored, but cloud-synced. Rotate + use `vercel env pull` on demand.
- **Regenerate demo-doc exports** — `docs/POC-DEMO-DETAILED.pdf`/`.docx` are still rendered from v2.5/v2.6; the markdown source is at v2.7 (PR #105). Needs local `npm run docs:pdf` / `docs:docx`.
- **Refactor 11 React 19 Compiler findings** — `react-hooks/set-state-in-effect` (8 sites), `react-hooks/static-components` (3 in `sidebar-nav.tsx`). Currently downgraded to warnings via `eslint.config.mjs`. Files affected: `src/app/(clinic-app)/dashboard/_components/order-drawer.tsx`, `src/app/(clinic-app)/new-prescription/_context/prescription-session.tsx`, `src/app/(ops-dashboard)/ops/pipeline/_components/order-detail-drawer.tsx`, `src/components/main-content-offset.tsx`, `src/components/sidebar-nav.tsx`. Estimated 2-4 hrs careful work. Open a separate PR after PR 7 merges.
- **Clean up 37 `no-unused-vars` warnings** — all cosmetic. Either remove or prefix with `_`. Mostly in test files, utility scripts, and a few components.
- **Fix Foundry Data Layer blueprint edit-tool bug** — 8090.ai platform bug where `edit_blueprint` returns "old_text does not match" for all edits on blueprint ID `3a3f585a-eec5-4283-bbb6-040331dc6611`. Workaround used: paste-back from local file. Report to 8090.ai support so future updates don't hit the same wall.
- **Populate `STRIPE_SECRET_KEY` for CI E2E with a test-mode key (`sk_test_*`)** — current GH secret was pulled from Vercel production env, which is a LIVE key. As a result, Test B Phase 2 in `e2e/checkout.spec.ts` (Stripe `pm_card_visa` confirmation) skips on every CI run. The skip is logged as a test annotation so it's visible. To unlock Phase 2: grab the TEST secret key from Stripe dashboard (test-mode toggle) → `gh secret set STRIPE_SECRET_KEY --repo PhoenixWild29/functional-medicine-infrastructure` (repo scope + `--app dependabot` scope). Vercel production env stays on the live key. After that, Phase 2 covers the Stripe test-mode PI confirmation round-trip for every PR.

### Medium-term

- **First real clinic outreach** — `docs/launch-kit/clinic-outreach-email.docx` Template 1 to 5-8 warm contacts. Highest-leverage unblocker for revenue.
- **LegitScript certification application** — $975 + BAA paperwork. `docs/launch-kit/legitscript-application-checklist.docx`. 2-4 week turnaround.
- **6 vendor BAA requests** — Supabase, Stripe, Twilio, Documo, Vercel, Sentry. See `docs/launch-kit/pre-launch-checklist.docx` bucket 1.6. Some take 1-2 weeks.
- **Mobile validation on real devices** — `docs/mobile-validation-test-plan.pdf`. 30-min run on iPhone + Android. User side.
- **E2E coverage for Phase C group checkout** — the payment-group flow (Stripe webhooks + disputes) has unit tests but zero Playwright coverage (flagged in the 2026-07-02 assessment).
- **F-4 patient-detail view** — spec'd in `docs/audits/role-audit-and-data-model.md`, 2–3 day build, not started.
- **Empirical PHI-redaction verification** — never run against real (non-seed) adapter traffic; blocked until a real pharmacy submission exists (LF-4..8 awaiting Lauren Perkins credentials + BAA).

---

## Principles to hold (from prior user feedback)

1. **Don't hide things, don't skip over things.** When CI fails, fix the underlying issue. `continue-on-error` and `skip` conditions are band-aids that get called out. Use them only with explicit time-boxed backlog commitment.
2. **Review before acting on non-trivial changes.** Both internal agent and external cowork. Prevents rabbit-hole and premature implementation.
3. **Small, reviewable PRs.** Each PR digestible in one sitting; merge before opening the next. User wants to check between each.
4. **Production safety first.** The live demo is always working. Every change is tested locally before pushing.
5. **Document the why, not the what.** Comments should explain non-obvious decisions, not restate code.

---

## Recent context worth preserving

### Session 2026-07-08 — New-agent takeover: doc-debt closed + #97 + #107

Full re-assessment by an incoming agent (GitHub-verified; the OneDrive checkout remains unreliable for git/bash — all work went through the GitHub API per the standing workaround). Actions:

- **Committed the three local-only handoff docs** (`1b7310c`): `docs/handoff/project-state-2026-06-14.md`, `project-assessment-2026-07-02.md`, `documentation-audit-2026-07-07.md`. STATUS.md had been referencing them but they'd never been pushed (local git-auth issue). Verified first that the POC demo credentials quoted in the 06-14 handoff are already public in 10 repo files (README, poc-setup, seed-poc.ts, …) — no new exposure.
- **Merged dependabot #97** (`68a00c9`): @opentelemetry/core 2.6.0→2.8.0 + form-data 4.0.5→4.0.6 (security: CR/LF/quote escaping in field names). Branch was 6 days stale and #100 had also touched `package.json`, so the branch was updated from main first and full CI re-ran green before merge (serial-merge lesson from 07-02 applied).
- **Shipped PR #107** (`ab29457`): solo-path `dispute_orders` junction write in `handleSoloChargeDisputeCreated` (idempotent upsert on the composite PK, non-fatal on error — mirrors the group fan-out) + first unit test for `/api/cron/purge-phi-debug` (auth gating, deleted-count surfacing incl. 0-row + null-count, ~24h cutoff boundary, delete-failure 500, 405s). Both were LOW findings from the 2026-07-02 batch review.
- **Verified the V3 catalog is live in prod** via R9 evidence (PR #105's corrections describe the live catalog behavior: $95 wholesale, 5 direct Semaglutide formulations, 40%-markup retail default).
- **Still open for the user:** secrets rotation (`.env.local`), clinic outreach send, Lauren 503B email, LegitScript, BAAs, mobile validation, demo-doc PDF/DOCX regeneration (needs local env).

### Session 2026-07-02 — Full project assessment + Jun-14 batch cleared

Project had been idle since 2026-06-15 with 6 PRs staged for review. This session:

- **Assessment first:** 3 parallel agents (codebase, docs/roadmap, CI/ops) + live GitHub/prod verification. Report: `docs/handoff/project-assessment-2026-07-02.md`. Reconstructed the May–June timeline (venture-studio strategy track, discovery-sprint audits, Phase C build + 2 Codex sweeps).
- **Batch review executed** per PR #95's prompt (4 parallel review agents, verify-before-report guardrail): #90 PASS · #91 PASS-w/f · #92 PASS-w/f · #93 PASS · #94 PASS-w/f. Verdicts recorded as PR comments.
- **MEDIUM fixed pre-merge (PR #94):** daily 03:00 UTC purge sweep allowed ~48h worst-case PHI residence vs the documented 24h. Cron bumped to hourly (`b879128`) — worst case now ~25h. Same cadence-over-classifier reasoning as PR #41's F2.
- **PR #91 description corrected:** solo dispute path writes 0 `dispute_orders` rows (the old text claimed 1); follow-up filed in backlog.
- **E2E failure root cause (Jun-15 runs on #92/#93/#94):** migration-history mismatch on the shared E2E Supabase project — #91's green run applied `20260614000001` remotely; sibling branches lacking it failed `supabase db push` in ~70s. **Durable lesson: parallel PRs that each carry a migration will break each other's E2E runs once the first one syncs. Update branches from main and run CI serially.**
- **Merged (serial, CI-green each):** #90, #91, #94, #92, #93, #95, #89 (dependabot esbuild security), #96.
- **PR #96 (new):** removed the orphan `adapter-health-check` cron from `vercel.json` — scheduled every 10 min since inception with no route handler (404s in prod). Adapter Health freshness is handled by `poc-credential-sync` (which also runs `refresh-demo-data`).
- **Security flag (user action pending):** `.env.local` in the OneDrive-synced folder holds live Stripe secret key, Supabase service-role JWT, DB password, Sentry token. Git-ignored but cloud-synced — rotate and switch to `vercel env pull`.
- **Not done here (needs local env):** `npm run db:types` regen — first item in Short-term backlog.

### Session 2026-04-27 (Late) — R8 backlog + meta-WO walkthrough template shipped + docs sync

Three small PRs landed after the R8 walkthrough campaign closed; brought all R8-surfaced findings to "completed" + captured the prompt-template process improvement:

- **PR #55 (`56450a2`)** — WO-93 Fax Details panel overflow CSS fix. One-line `break-words` Tailwind class on the orderStatus `<dd>` so long enums like `PHARMACY_ACKNOWLEDGED` wrap instead of forcing a horizontal scrollbar.
- **PR #56 (`08e1f2c`)** — WO-95 walkthrough-prompt template at `docs/qa-templates/walkthrough-prompt-base.md`. Captures R8's verify-before-report guardrail (the change that produced 0% false-positive rate) as a reusable structure for R9, R10, … rounds. Cross-referenced from CLAUDE.md so future agents discover it without re-deriving.
- **PR #57 (`1cd99cc`)** — WO-94 cross-tier demo orders. Seeds T1 (Quick Rx), T2 (Portal Plus), T3 (Hybrid Labs) demo orders alongside the existing T4 (Strive) order in `ensureDemoScaffolding`. Closes R8's verification gap (Tier-— fix could only be validated on T4) AND retroactively adds `pharmacy_id` + `submission_tier` to the original T4 demo order which were missing — that's why the drawer rendered '—' for it even after PR #51's join fix.

Plus a docs-sync pass:

- STATUS.md header bumped to point production at `1cd99cc`
- `docs/archive/source/POC-DEMO-DETAILED.md` line 355 fixed (Sla → SLA, matching PR #51's UI fix)
- Demo doc line 343 narration softly updated to acknowledge cross-tier order diversity now that WO-94's seed exposes T1/T2/T3/T4 in the Ops pipeline (was "Tier icon (Fax)" implying single-tier)
- `docs/POC-DEMO-DETAILED.docx` + `docs/POC-DEMO-DETAILED.pdf` re-rendered to match the markdown source

**Open queue (post-R8 sequencing review, locked):** investor + clinic onboarding both in 4-6 week target window per user. Reviewer + cowork ruled "investor-first lead, clinic pre-track parallel for procurement only." Tracks 1/2/3 await user green-light on contractor option, bundling preference, ordering, mobile validation timing.

### Session 2026-04-27 (PM) — R7-Bucket-1 follow-up campaign COMPLETE

Final phase batch (Phases 2b through 6) plus campaign-close audit. Shipped without blocking findings.

**PRs landed:**
- #50 (`911140c`) — WO-88 ESLint guard against type-bypass casts in Stripe-touching files. Fires correctly on `as Record<string, unknown>` / `as any` / `as unknown` patterns; three pre-existing webhook casts grandfathered with explicit doc-URL eslint-disable comments.
- #51 (`758dc57`) — Bucket 2 polish bundle: Tier-— data-binding fix (MEDIUM) + 4 cosmetic items (Sla→SLA caps, fax panel readability, clinic-name truncation, p50/p95/p99 seed-data note) + WO-91 BfcacheGuard 1-line fold.
- #52 (`8268ec1`) — R8 walkthrough prompt at `docs/qa-reports/qa-poc-demo-round8-prompt.md` with verify-before-report instruction targeting R7's 28% false-positive rate.
- #53 (`add0cac`) — WO-92 Stripe SDK type-check smoke at `src/__type-checks__/stripe-payment-element-options.ts` running in the existing `tsc --noEmit` CI step (no new CI job; live-key-constraint-compatible substitute for the wontfixed WO-90).

**Dependabot #49 (`2acd965`)** also landed during this batch: postcss 8.5.8→8.5.10 patch + uuid removal. Benign.

**R8 walkthrough PASS:**
- 7/7 targeted regression checks pass (bfcache PHI, bfcache KPI, Stripe Link, Tier field, SLA caps, fax panel readability, clinic name)
- 0% false-positive rate (R7 was 28%) — verify-before-report instruction caught all three known non-bugs before the agent reported them
- TOTP-from-Base32 path verified end-to-end (R7 only got the modal correct; R8 actually computed and submitted a valid code)
- 1 LOW finding (Fax panel "PHARMACY_ACKNOWLEDGED" overflow → WO-93)
- 1 observation (no API-routed order in seed; agent could only validate Tier fix on T4 fax → WO-94)

**Process improvements that paid off:**
- The "verify-before-report" guardrail in the R8 prompt explicitly forbade re-filing R7's two known non-bugs (KPI MTD vs all-time scope difference; post-EPCS `/dashboard?sent=N` redirect target). Both were correctly classified as observations in R8's report. **Recommend reusing this guardrail pattern in every future walkthrough prompt** — it's the cheapest false-positive-rate reduction available.
- Phase 0 parallel-audits-first sequencing (cowork's recommendation in PR #44 retrospective) prevented multiple guess-driven scoping errors. WO-87 turned out to be Tier S in 20 minutes of audit; WO-90 turned out to be wontfix in 30 minutes; Bucket 2 turned out to be "5 items not 7" in 10 minutes. Total Phase 0 audit cost: ~1 hour. Without it, the campaign would have spent days on the wrong path before discovering the gates.

### Session 2026-04-27 (AM) — R7-Bucket-1 follow-up sequencing + Stripe live-key constraint

Phase 0 audits + reviewer-cowork sequencing review locked the post-PR-44 follow-up plan. Material outcomes:

- **WO-89 shipped (PR #46 / `37301cd`):** PR template + CONTRIBUTING.md addition for the third-party API parameter doc-citation rule. Cheapest of three process-defense layers; docs-only.
- **Project constraint surfaced + memorialized:** "Stripe live key only in CI; no `sk_test_*` provisioning" — clarified by user, saved as `project_constraint_stripe_live_key_only.md` with explicit reopen triggers.
- **WO-90 closed wontfix** under that constraint. Original work-order content preserved in the WO description with reopen-trigger documentation.
- **WO-92 filed** as type-check smoke replacement: a single TS file under `src/__type-checks__/` that imports the SDK type and asserts a representative parameter object compiles. Catches the WO-44 commit-3/3 compile-time failure mode without API calls or test-mode keys. Critical detail (cowork-flagged): file MUST live under `src/` with the production `tsconfig.json` to avoid type-config drift.
- **WO-91 scope reduced** via 5-min code-read: the original "BfcacheGuard + auth middleware" framing was a guess; actual fix is a 1-line change at `src/components/bfcache-guard.tsx:29` (replace `window.location.reload()` with `window.location.replace('/login')` to bypass the middleware-redirect dance). Foldable into Phase 3 polish bundle.
- **Bucket 2 right-sized to 5 items:** 4 cosmetic + 1 MEDIUM "Tier —" data-binding fix split. Two original findings dropped as non-bugs (KPI MTD-only is intentional scope; post-EPCS redirect goes to `/dashboard?sent=1` correctly per `draft-sign-form.tsx:126`). Documented in this file so the R8 walkthrough doesn't re-file them.
- **STATUS.md backlog item "populate `sk_test_*`"** also closed wontfix under the same constraint. See the line above this section for the in-place strikethrough.
- **Constrained-live-mode smoke (idempotency + metadata + cancel)** explicitly rejected on cowork's maintenance-liability analysis (Radar fraud-signal tuning, on-call docs, accounting reconciliation, cleanup-failure handling).

**Locked execution sequence:**
- Phase 1 ✅ WO-89 (PR #46)
- Phase 2a — WO-87 SDK upgrade + wallets fix + Playwright assertion + manual preview smoke (DOM-only, no `confirmPayment` step to avoid live-account PI accumulation)
- Phase 2b — WO-88 ESLint guard
- Phase 3 — Bucket 2 PR (4 cosmetic + Tier-— split with PR-description hierarchy) + WO-91 1-line fold-in + non-bug docs
- Phase 4 — R8 walkthrough prompt update (verify-before-report instruction to reduce 28% false-positive rate from R7)
- Phase 5 — WO-92 type-check smoke (after WO-87 lands so the SDK upgrade is in place)

### R7 walkthrough non-bugs (do NOT re-file in R8)

- **KPI total vs. tab badge differ by N**: intentional. KPI is MTD-only filtered at `src/app/(clinic-app)/dashboard/page.tsx:152` (`createdAt >= mtdStart`). Tab counts all orders including prior months. Both correct.
- **Post-EPCS-sign redirect**: lands on `/dashboard?sent=1` per `src/app/(clinic-app)/new-prescription/sign/[orderId]/_components/draft-sign-form.tsx:126`. R7 walkthrough observed the wrong code path; ignore that report line.

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
