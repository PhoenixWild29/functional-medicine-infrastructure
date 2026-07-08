# CompoundIQ — Full Project Assessment

**Date:** 2026-07-02 · **Method:** 3 parallel assessment agents (codebase, docs/roadmap, CI/ops) + live GitHub/production verification
**Production:** https://functional-medicine-infrastructure.vercel.app — **UP**, `/api/health` 200, version `d5c212a` (= last main commit, 2026-06-14)

---

## Where we are

The project is **paused mid-handoff since 2026-06-15**. The last engineering session (Jun 9–14) shipped Phase C (multi-Rx "Combine and Send" bundled checkout — live in prod, flag ON since Jun 14), cleared two Codex sweeps, implemented PHI redaction Option B, then staged **6 open PRs (#90–95)** and wrote `docs/handoff/project-state-2026-06-14.md`. Nothing has moved since: no commits, no PR updates, no new docs.

STATUS.md is **~7 weeks stale** (authoritative only through 2026-04-27 / R8 QA round) — it does not mention Phase C, the role-audit work (F-1..F-6), the PHI policy, or the venture-studio track.

### Timeline reconstructed (post-STATUS.md)

| When | What |
|---|---|
| May 24–27 | **Venture Studio Strategy** track begins (Partnership Package for Lauren Perkins / "Manly" + 503B pharmacy asset; CompoundIQ positioned as studio's proof-of-capability). Draft unsent. |
| May 27–28 | Discovery sprint: role audit (F-1..F-6 RBAC spec), ops-dashboard gap list, E2E friction audit (flagged multi-Rx checkout friction → became Phase C) |
| Jun 9–14 | Phase C built + shipped in 5 stages; 2 Codex sweeps (caught 1 CRITICAL solo-PI-bypass + 1 CRITICAL RLS clinic_id path bug, both fixed); PHI redaction shipped; F-3/F-5 role work |
| Jun 14–15 | 5 feature PRs (#90–94) + Codex prompt PR (#95) opened; handoff doc written; **work stops** |

### Verified current state

- **CI:** real and gating (lint → typecheck → jest → build → Playwright E2E on isolated Supabase project). No hidden skips. Last known green: 311–325 tests passing per PR bodies.
- **Codebase:** mature — 56 API routes, 44 migrations, 28 unit-test files, 6 E2E specs, WO-87 Stripe SDK upgrade confirmed (`@stripe/stripe-js ^7.9.0`), WO-92 type-check smoke present.
- **Prod DB is ahead of prod code:** PR #95 confirms all 4 Jun-14 migrations (dispute fan-out, F-3 opt-in policy, F-5 primary_provider_id, PHI debug table) are already applied to prod. Benign by design (each PR documents ordering), but the longer PRs sit unmerged, the more drift risk (hand-edited `database.types.ts` in 3 PRs awaiting post-merge regen).

---

## Risks / issues found

1. **`.env.local` contains live secrets in a OneDrive-synced folder** — `sk_live_` Stripe key, Supabase service-role JWT, DB password, Sentry token. It IS git-ignored (verified), but cloud-syncing live production payment/database credentials is an exposure. Recommend moving to `vercel env pull` on demand + rotating the Stripe/service-role keys.
2. **Broken cron:** `vercel.json` schedules `/api/cron/adapter-health-check` every 10 min but no route exists (verified: 9 of 10 cron routes implemented) → 404s in prod every 10 minutes. Remove from vercel.json or implement.
3. **Stale docs:** STATUS.md (Apr 27), DEPLOYMENT.md (describes the disabled deploy.yml pipeline; `/api/health` response shape wrong). The handoff doc partially compensates but STATUS.md is the declared "source of truth."
4. **E2E coverage gap:** Phase C payment-group flow (new Stripe payment surface incl. webhooks + disputes) has unit tests but zero Playwright coverage.
5. **PR staleness:** #89 (dependabot esbuild security bump) and #90–95 open ~3 weeks. #94's PHI-debug cron (`purge-phi-debug`) isn't live until merged.
6. **Compliance open items:** 6 vendor BAAs not requested; LegitScript not applied; empirical PHI-redaction verification never run against prod data.

---

## Where to proceed (recommended order)

**Track 0 — resume engineering (unblocks everything, ~1 session):**
1. Run the staged Codex sweep (PR #95 prompt) over PRs #90–94 → fix findings → merge in documented order → regen `database.types.ts` → merge dependabot #89 → update STATUS.md header/state.
2. Quick fixes alongside: remove/implement `adapter-health-check` cron; rotate + un-sync live secrets.

**Track 1 — close the security/compliance loop:**
3. Empirical PHI-redaction verification in prod; add Playwright E2E for group checkout; mobile validation on real devices (30 min, user-side).

**Track 2 — revenue (highest-leverage, zero code):**
4. Send clinic outreach (launch-kit ready since May 27, nothing sent); kick off LegitScript ($975, 2–4 wk) + 6 vendor BAAs in parallel.

**Track 3 — strategic (user + partner decisions):**
5. Venture Studio Partnership Package: fill Lauren Perkins' bracketed sections, send to "Manly," schedule structure/economics working session.
6. Unblock LF-4..8 pharmacy integrations (waiting on Lauren: credentials + BAA) and F-4 patient-detail view (2–3 day spec, ready to build).

**Known deferred (fine to leave):** 11 React 19 Compiler warnings, 37 no-unused-vars, second provider `user_id` link, ops-dashboard 500-order cap/search gaps.
