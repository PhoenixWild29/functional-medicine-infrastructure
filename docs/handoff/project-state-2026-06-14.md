# CompoundIQ — Project Handoff for Next Agent (2026-06-14)

You are taking over development of **CompoundIQ**, a healthcare SaaS platform for compounding-pharmacy prescription fulfillment. Read this entire document before doing any work. The project is mid-flight in a 4–6 week investor + clinic onboarding window; the user expects fast, parallel execution.

---

## 1. What CompoundIQ is

A multi-tenant SaaS that lets clinics dispatch compounded prescriptions to partner pharmacies, collect patient payment via Stripe, and track fulfillment end-to-end.

**Three apps, one codebase:**
- **Clinic app** (`/dashboard`, `/new-prescription/*`, `/settings`) — for clinic users to issue prescriptions, manage orders, see revenue.
- **Patient checkout** (`/checkout/[token]`) — guest, JWT-authenticated payment surface. Zero PHI rendered (per HIPAA boundary).
- **Ops dashboard** (`/ops/*`) — internal admin for monitoring adapter submissions, pharmacy integrations, and webhook events.

**Live production URL:** `https://functional-medicine-infrastructure.vercel.app`

---

## 2. Tech stack

- **Frontend:** Next.js 16 App Router, React Server Components, Tailwind CSS, semantic-token design system.
- **Backend:** Next.js API route handlers + Supabase Postgres with strict Row-Level Security.
- **Auth:** Supabase Auth (session + JWT). Custom `app_role` and `clinic_id` claims live under `user_metadata`. RLS policies read them via `auth.jwt() -> 'user_metadata' ->> '...'`.
- **Payments:** Stripe Connect Express. **LIVE keys only** — no test-mode provisioning (see Section 7 constraints).
- **Comms:** Twilio (SMS) for patient checkout links + Documo (fax) for Tier 4 pharmacy submissions.
- **Observability:** Sentry with PHI-scrubbing transport.
- **Hosting:** Vercel (Fluid Compute) with cron jobs registered in `vercel.json`.
- **Type generation:** `src/types/database.types.ts` is auto-generated via `npm run db:types` (regenerates from the linked Supabase production project).

---

## 3. Roles + auth model

Four `app_role` values:
- `clinic_admin` — full access within their clinic.
- `provider` — restricted to their own orders by default (F-3 RLS). Can opt into clinic-wide view via the F-3 toggle (PR #92).
- `medical_assistant` — full access within their clinic, but cannot sign prescriptions (F-2 signer enforcement).
- `ops_admin` — cross-clinic visibility, internal CompoundIQ staff.

**Identity-binding chain:**
- F-1 (live): `providers.user_id` FK to `auth.users` lets RLS resolve "which provider row is this auth user."
- F-2 (live): sign-and-send route verifies `provider.user_id === session.user.id` before EPCS signing.
- F-3 (live): RLS on `orders` enforces visibility by role — provider sees own, admin/MA sees clinic, ops_admin sees all.
- F-4 (open): no patient-detail page yet — deferred to next major iteration.
- F-5 (just shipped, PR #93 open): `patients.primary_provider_id` column + auto-default on first order.
- F-6 (deferred): more granular internal CompoundIQ roles beyond `ops_admin`.

---

## 4. Phase C — multi-Rx Combine and Send (just shipped + LIVE)

The headline feature for this iteration: a clinic can bundle N AWAITING_PAYMENT orders for the **same patient + same provider** into ONE Stripe PaymentIntent. The patient pays once for all N prescriptions; the webhook atomically transitions all N member orders.

**Five stages, all live in production as of 2026-06-12, gated behind `PHASE_C_GROUPS_ENABLED=true`:**

| Stage | Surface | Notes |
|-------|---------|-------|
| 1 | `payment_groups` table + `orders.payment_group_id` FK | Stage 1 RLS path corrected by `20260611000005` (was using stale `auth.jwt() ->> 'clinic_id'`). |
| 2 | `POST /api/checkout/payment-group` | Clinic-side group creation. Delegates to `src/lib/payment-group/create-group.ts`. |
| 2.5 | Solo route rejects grouped orders + CAS stamp-back | `payment-intent/route.ts` reads `payment_group_id` and 409s; CAS predicate `.is('payment_group_id', null)`. |
| 3 | Webhook `payment_intent.succeeded` group branch | `handle-group.ts` with dependency injection; throws on partial failure → route returns 500 → Stripe redelivers. |
| 4 | Clinic UI in order drawer | "Combine with other prescriptions…" picker auto-renders when siblings exist. |
| 5 | Patient `/checkout/[token]` group flavor | Recognizes `groupId` JWT, fetches `payment_groups`, renders "Prescription Bundle · N prescriptions." |

**Group dispute handling (PR #86 + #91):** `charge.dispute.created` resolves PI → group, marks group DISPUTED, writes per-member rows in the new `dispute_orders` junction table (PR #91, migration 20260614000001 live).

**Phase C is PASS-cleared by Codex** (rounds 1–3) and verified end-to-end in production via browser-agent smoke on 2026-06-14.

---

## 5. PHI policy + adapter submissions

`adapter_submissions` is the audit trail for outbound pharmacy adapter calls. The original design stored the full request payload (patient name, DOB, sig, medication) — too much PHI sitting at rest.

**Option B (live, PR #88):** at write time, `markSubmitted` in `src/lib/adapters/audit-trail.ts` runs `redactAdapterRequestPayload` (`src/lib/phi/redact-adapter-payload.ts`) which strips PHI keys and persists only structural shape + a SHA-256 fingerprint under `metadata.phi_fingerprint`.

**24h debug carve-out (PR #94, open):** new flag-gated side table `adapter_submission_debug_payloads` captures the **pre-redaction** payload for 24 hours. Strict service-role-only RLS. Cron at `/api/cron/purge-phi-debug` daily at 03:00 UTC sweeps anything older. Flag `PHI_DEBUG_ENABLED` is **OFF in prod**; ops flips it when triage window is needed.

**HIPAA boundary, always:**
- Stripe metadata may contain ONLY `{order_id | payment_group_id, clinic_id, platform, order_count}`. Never patient names, medication names, DOBs.
- Logs (`console.log/warn/error`) use IDs only.
- Patient checkout pages render zero PHI — only price + clinic name + generic copy.

---

## 6. Workflow + execution style

**Standing user preference (codified in memory `feedback_parallel_execution_framework.md`):**

> Default to high-parallelism execution. Fan out via parallel sub-agents in a single message. Open multiple PRs in flight rather than serializing. Triage after major iterations rather than per-PR.

**Phase build workflow (memory `feedback_phase_build_workflow.md`):** 10-step process for full-phase work. Read it at the start of any phase. Key points: WOs go `in_progress` → `in_review` → `completed` (only after cowork pass).

**Verify-before-report guardrail:** before reporting any finding (good or bad), cite file:line, quote the line verbatim, state input/output, propose the fix. The prior Codex sweep had a 28% false-positive rate before this rule was added; dropped to 0% after.

**Memory system:** `C:/Users/ssham/.claude/projects/c--Users-ssham-OneDrive-Functional-Medicine/memory/`. `MEMORY.md` is the index. Read relevant memories at session start.

---

## 7. Hard constraints (do not violate)

1. **Stripe LIVE keys only.** No `sk_test_*` provisioning. No live-API CI smoke. POC uses production Stripe. See `project_constraint_stripe_live_key_only.md` in memory. Smoke tests stop BEFORE clicking Pay.
2. **HIPAA boundary** (Section 5).
3. **F-2 signer enforcement.** Provider sessions signing prescriptions must have `provider.user_id === session.user.id`. Enforced in `sign-and-send/route.ts` and `create-group.ts`.
4. **Cross-clinic isolation is absolute.** Every RLS policy MUST gate on `clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID`. Never use the stale `auth.jwt() ->> 'clinic_id'` (always NULL) — that bug was found + fixed via `20260611000005`.
5. **Never commit secrets, `.env*`, or credentials.**
6. **Never use `git add -A` or `git add .`** — this repo has stale junk at the root (`AGENTS.md`, `.codex/`, `Venture Studio Strategy/`, `copy 1.docx`) that should never be committed. Stage explicit paths.
7. **POC mode placeholder:** clinics with `stripe_connect_account_id = 'poc_placeholder'` get a Stripe PaymentIntent with NO Connect routing (`application_fee_amount`, `transfer_data` omitted). Real clinics must have an ACTIVE Connect account.
8. **No backwards-compatibility hacks.** Don't leave `_unused`, `// removed`, or shim re-exports. Delete dead code completely.
9. **Hooks must not be skipped** (no `--no-verify`, `--no-gpg-sign`) without explicit user authorization. Fix the underlying issue.

---

## 8. Where we are right now (2026-06-14)

### Open PRs (5 feature + 1 docs)

| PR | Title | Migration state | Codex state |
|----|-------|-----------------|-------------|
| #90 | Rename "Awaiting Payment" tab → "Pending Payment" | none | not yet reviewed |
| #91 | Disputes table fan-out (one row per group member) | 20260614000001 LIVE in prod | not yet reviewed |
| #92 | F-3 provider opt-in clinic-view toggle | 20260614000003 LIVE in prod | not yet reviewed |
| #93 | F-5 `patients.primary_provider_id` + auto-default | 20260614000004 LIVE in prod | not yet reviewed |
| #94 | PHI ephemeral debug payload table + 24h cron | 20260614000002 LIVE in prod | not yet reviewed |
| #95 | Batch Codex review prompt (docs) | — | — |

### Production state

- All migrations through `20260614000004` applied to prod (`supabase migration list --linked` confirms).
- `PHASE_C_GROUPS_ENABLED=true` flipped in Vercel prod env on 2026-06-14.
- `PHI_DEBUG_ENABLED` is **NOT set** (i.e., defaults off).
- Phase C verified live via browser-agent smoke 2026-06-14: provider login → drawer auto-discovers siblings → Combine and Copy → patient checkout renders "Prescription Bundle · 2 prescriptions" with correct total + Stripe form.

### Earlier this week (2026-06-09 through 2026-06-14)

- Shipped F-1, F-2, F-3 (RLS + middleware), LF-1/2/3, POC credential gate, Phase C Stages 1–5, group dispute handling, PHI redaction, plus all post-Codex fix bundles.
- Two Codex sweeps applied: 2026-06-09 (PRs #73–79) and 2026-06-11 (PRs #80–84). Both cleared.
- One major iteration of 6 parallel sub-agents on 2026-06-14 produced the current open-PR set.

---

## 9. Where we are going

### Immediate next step

**Run Codex on PRs #90–94 using the prompt in PR #95** (`docs/audits/codex-review-prompt-2026-06-14-batch.md`). User pastes the prompt into Codex. When the verdict returns:
- For each PASS: merge in any order (migrations are live, code is independent).
- For each CHANGES-REQUIRED: apply fixes, push to the same branch, request re-review.
- After all merge: run `npm run db:types` to regenerate `src/types/database.types.ts` (replaces the three hand-edits with a clean regen).

### Near-term (after this iteration clears)

1. **Empirical PHI redaction verify.** Fire a real adapter call in prod (signed prescription → dispatcher) and inspect the resulting `adapter_submissions` row. Confirm `request_payload` has redacted keys + `metadata.phi_fingerprint` is a 64-char hex. Production currently has only demo-seed rows with NULL payloads, so the redactor hasn't been empirically exercised yet.
2. **F-4 — patient-detail view.** New routes `/patients` + `/patients/[patientId]`. 2–3 day effort. Unblocks Lauren's multi-provider visibility ask. Spec lives in `docs/audits/role-audit-and-data-model.md` §F-4.
3. **Provider link gap.** Only 1 of 2 production providers has `user_id` populated (Dr. Chen). The second provider needs to be linked to an auth user, or the F-3 provider RLS branch never applies for them.

### Medium-term backlog

- **F-6:** more granular CompoundIQ internal roles (deferred per user direction).
- **Phase B2 + Phase D + Track 2:** scoped in software-factory MCP but not yet planned in detail. Read `MEMORY.md` for status.
- **LF-4..8:** blocked on Lauren Perkins delivering credentials + BAA for additional pharmacy network integrations.
- **Mobile validation:** test plan in `docs/mobile-validation-test-plan.pdf`; user still needs to run on real iPhone + Android hardware.
- **Clinic outreach launch kit:** `docs/launch-kit/*.docx` is ready; nothing has been sent yet.

### Strategic context

- **4–6 week investor + clinic onboarding window.** User wants speed without compromising quality gates (Codex review, smoke tests, F-2/F-3 enforcement).
- **POC demo-ready status:** validated through 6 rounds of cowork QA with zero remaining findings. See `project_poc_demo_readiness.md` in memory.
- **Lauren Perkins is the strategic framing partner** for messaging and additional pharmacy integrations.

---

## 10. Key file landmarks

| File | Purpose |
|------|---------|
| `src/middleware.ts` | Edge middleware: auth + JWT verification + checkout-token forwarding. |
| `src/lib/auth/checkout-token.ts` | HMAC-SHA256 JWT for patient checkout. orderId XOR groupId invariant. |
| `src/lib/supabase/server.ts` | Session-tier Supabase client. Now supports `extraHeaders` for F-3 toggle. |
| `src/lib/supabase/service.ts` | Service-role client (bypasses RLS). Use sparingly. |
| `src/lib/payment-group/create-group.ts` | Shared payment-group creation + cancel helper. F-2 carryover lives here. |
| `src/app/api/webhooks/stripe/route.ts` | Webhook entry. Dedup logic, partial-failure 500 handling, branch routing. |
| `src/app/api/webhooks/stripe/handle-group.ts` | Group payment success handler. Throws on partial failure. |
| `src/app/api/webhooks/stripe/handle-group-dispute.ts` | Group dispute → DISPUTED status + dispute_orders fan-out (PR #91). |
| `src/lib/adapters/audit-trail.ts` | `markSubmitted` write site. PHI redactor + optional debug-table hook. |
| `src/lib/phi/redact-adapter-payload.ts` | PHI redactor + SHA-256 fingerprint. |
| `src/lib/orders/status-config.ts` | Status enum → label/color mapping. |
| `supabase/migrations/` | Schema + RLS. Naming convention: `YYYYMMDDNNNNNN_description.sql`. |
| `docs/audits/role-audit-and-data-model.md` | F-1 through F-6 spec + chosen approaches. |
| `docs/audits/phi-policy-adapter-submissions.md` | PHI policy memo + Option B implementation notes. |
| `docs/POC-DEMO-DETAILED.pdf` | Demo walkthrough doc (validated through 6 rounds of cowork QA). |
| `STATUS.md` (repo root) | In-flight PRs + review findings + backlog. Read first when resuming. |

---

## 11. Common commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Local dev server. Hot-reload. |
| `npx tsc --noEmit` | Typecheck the whole repo. Must be clean before merge. |
| `npm run lint` | ESLint. 0 errors required; warnings are acceptable (49 pre-existing). |
| `npx jest` | Unit + integration tests via Jest. Currently 325+ tests across 30 suites. |
| `npm run db:types` | Regenerate `src/types/database.types.ts` from linked Supabase production project. Run after every migration deploy. |
| `npx supabase migration list --linked` | List applied vs pending migrations on production. |
| `npx supabase db push --linked` | Apply pending local migrations to production. Use carefully. |
| `gh pr create --head <branch> --title "..." --body "..."` | Open a PR. From any branch; `--head` is required if not on the branch. |
| `gh pr merge <num> --squash --delete-branch` | Squash-merge + delete branch. Auto-merge is disabled on this repo. |
| `gh pr comment <num> --body "..."` | Comment on a PR. Use for fix-bundle summaries. |

---

## 12. Test credentials

| Role | Email | Password |
|------|-------|----------|
| Clinic Admin | `admin@sunrise-clinic.com` | `POCClinic2026!` |
| Provider | `dr.chen@sunrise-clinic.com` | `POCProvider2026!` |
| Medical Assistant | `ma@sunrise-clinic.com` | `POCMA2026!` |
| Ops Admin | `ops@compoundiq-poc.com` | `POCAdmin2026!` |

Canonical source: `docs/archive/source/POC-DEMO-QUICKSTART.md`. Memory may be stale; verify from that doc if a login fails.

**Dr. Sarah Chen's auth uid:** `fdadca09-9070-4722-8400-8b0bce957c73` (the F-1 link target).

---

## 13. Final operating principles

1. **Be decisive.** The user prefers fast forward motion. When you have enough information to act, act. Don't re-derive what's already established.
2. **Fan out aggressively.** Default to parallel sub-agents on independent work.
3. **Triage in batches.** Open multiple PRs, then send a single Codex prompt covering the lot.
4. **Verify before reporting.** File:line + quote + input/output + fix. Always.
5. **Stop at the Pay button.** Smoke tests don't actually charge cards in prod.
6. **Update memory liberally.** Save user preferences, strategic context, project decisions. Skip code patterns (those live in code).
7. **When in doubt, read STATUS.md and MEMORY.md.** Both survive context compaction.

Welcome to the project. Start by reading `STATUS.md` at the repo root, then `MEMORY.md` in the memory folder, then check the open PRs (`gh pr list`).
