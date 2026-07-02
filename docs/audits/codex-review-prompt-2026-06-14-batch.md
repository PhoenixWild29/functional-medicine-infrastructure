# Codex Batch Review Prompt — 2026-06-14

**Scope:** PRs #90–#94, opened together as a single parallel iteration after the 2026-06-11 Phase C work landed and was Codex-cleared. All five PRs are independent feature/polish work; all four schema migrations are **already applied to production**.

## Roll-up

| PR  | Title | Migration | Code merge state |
|-----|-------|-----------|------------------|
| #90 | Rename "Awaiting Payment" tab → "Pending Payment" | none | safe to merge any time |
| #91 | Disputes table fan-out (one row per group member) | 20260614000001 (LIVE) | safe to merge — migration is in prod |
| #92 | F-3 provider opt-in clinic-view toggle | 20260614000003 (LIVE) | safe to merge — graceful degradation |
| #93 | F-5 `patients.primary_provider_id` | 20260614000004 (LIVE) | safe to merge — graceful degradation |
| #94 | PHI ephemeral debug payload table + cron | 20260614000002 (LIVE) | safe to merge — flag-gated, off by default |

Quality state across the batch:
- All PRs: `tsc --noEmit` clean, `npm run lint` 0 errors, `npx jest` green on each branch.
- Cross-PR: jest totals shifted from 311 → ~325 as agents added coverage; no cross-PR test conflicts (each agent's work was isolated by worktree).
- Production verification (run separately): F-3 RLS confirmed working in prod. PHI redaction has no real adapter traffic yet to verify empirically (all `adapter_submissions` rows in prod are demo-seed with NULL payload).

## Codex Prompt (copy below)

You are reviewing **five parallel PRs** (#90–#94) of CompoundIQ, a healthcare SaaS for compounding-pharmacy prescription fulfillment. The prior Codex sweep (2026-06-11, rounds 1–3) cleared PRs #80–#84 and PR #84 merged with no findings. This batch is the next major iteration. All four schema migrations are already applied to production. Per-PR code is independently mergeable.

Provide a per-PR verdict: `PR #X: {PASS | PASS-with-followups | CHANGES-REQUIRED}` plus citation-grade rationale. For CHANGES-REQUIRED, cite file:line + quote + misbehavior + fix.

### Recent context Codex should know

- Phase C (multi-Rx Combine and Send) is **live in production** as of 2026-06-12. Flag `PHASE_C_GROUPS_ENABLED=true` in Vercel prod env.
- The 2026-06-11 sweep produced 5 CHANGES-REQUIRED items, all closed in PR #84's commit `8484df4` and round-2 commit `39b7371`. The sweep's "verify-before-report guardrail" remains the standing rule.
- PHI policy is **Option B** (redact at write, fingerprint in metadata). The new PR #94 layers a 24h ephemeral debug capture on top, **flag-gated** (`PHI_DEBUG_ENABLED=true`, currently OFF in prod).
- F-3 RLS is enforced at the DB (PR #87). PR #92 adds an additive opt-in policy for providers to broaden to the whole clinic via a per-request header.
- The `disputes` table existed before PR #86; PR #86's group dispute handler wrote a single anchor row per dispute. PR #91 fan-outs to one row per member order via a new `dispute_orders` junction.

### What changed per PR

#### PR #90 — Rename "Awaiting Payment" tab → "Pending Payment"

UX polish. Tab in `src/app/(clinic-app)/dashboard/_components/orders-dashboard.tsx` (and equivalent Kanban lane) is renamed because it intentionally buckets both `AWAITING_PAYMENT` and `PAYMENT_EXPIRED` — the old label was misleading.

**No migration. No status enum change. Per-row badge text unchanged.**

Specific scrutiny:
- Confirm the rename is consistent across the dashboard surfaces a clinic user navigates.
- Confirm no test asserted on the literal string "Awaiting Payment" as a tab/lane label.

#### PR #91 — Disputes table fan-out

Migration `20260614000001` creates `dispute_orders` (composite PK `(dispute_id, order_id)`, FK to both, indexed on `order_id`, RLS mirrors `disputes`). Handler `src/app/api/webhooks/stripe/handle-group-dispute.ts` now writes one `dispute_orders` row per member order on top of the single `disputes` row.

Specific scrutiny:
- Solo path: confirm it still writes exactly 1 `disputes` + 1 `dispute_orders` row.
- Group path: confirm N member orders → N `dispute_orders` rows, all referencing the same `dispute_id`.
- Idempotency: re-delivery of the same `charge.dispute.created` event should be a no-op (use ON CONFLICT or pre-SELECT — verify which).
- RLS: confirm `dispute_orders` RLS scopes by clinic via `(auth.jwt() -> 'user_metadata' ->> 'clinic_id')` (matching the codebase convention reaffirmed in `20260611000005`). Confirm cross-clinic isolation.
- `database.types.ts` was hand-edited (regen deferred). Confirm the hand-edit is structurally correct (Row/Insert/Update shapes + Relationships).
- The `disputes` table's `dp_%` PK CHECK constraint is preserved — no breaking change there.

#### PR #92 — F-3 provider opt-in clinic-view toggle

Migration `20260614000003` adds an **additive** policy `orders_provider_clinic_optin_select` on `orders`. The base `orders_role_aware_select` from PR #87 is unchanged. When a provider session sends header `x-provider-view-mode: clinic`, the additive policy grants SELECT on every order in their clinic (subject to clinic-scoping).

The header is forwarded by a new `extraHeaders` option on `src/lib/supabase/server.ts::createServerClient`. The dashboard `page.tsx` reads `?view=clinic` and mints a header-forwarding client only when the session is a provider. UI is a new `provider-view-toggle.tsx` segmented control.

Specific scrutiny:
- **Cross-clinic isolation must remain absolute.** Confirm the additive policy still gates on `clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID`. A provider opting into "clinic view" must NOT see other clinics.
- Confirm `current_setting('request.headers', true)` is wrapped to handle non-PostgREST contexts (psql, migrations, triggers). The agent noted the `nullif(..., '')::json` wrapping pattern — verify.
- Confirm the SSR client mint condition: only providers get the header-forwarding client; clinic_admin / MA / ops_admin sessions are unaffected.
- Confirm the toggle UI only renders for providers (no leak to other roles).
- Header-forging risk: could a non-provider session send the header manually and gain clinic-wide view? The base policy applies for them — verify the base policy's role-gate stops this.

#### PR #93 — F-5 `patients.primary_provider_id`

Migration `20260614000004` adds nullable `primary_provider_id UUID REFERENCES providers(provider_id) ON DELETE SET NULL` + partial reverse-lookup index. `POST /api/orders` auto-defaults `primary_provider_id` after a successful order insert when the patient's column is currently NULL — via an UPDATE with `.is('primary_provider_id', null)` predicate (idempotent: second call is a no-op).

Specific scrutiny:
- Confirm the auto-default UPDATE is non-fatal — if it fails, the order still returns 201.
- Confirm the `.is('primary_provider_id', null)` predicate prevents overwriting an existing primary provider when the patient gets a second order from a different provider.
- Confirm ON DELETE SET NULL semantics: if a provider row is deleted (rare), patient.primary_provider_id becomes NULL, not orphaned.
- Confirm no backfill — historical patients stay NULL until they get their next order.
- `database.types.ts` hand-edited (regen deferred). Confirm the hand-edit is structurally correct.

#### PR #94 — PHI ephemeral debug payload table

Migration `20260614000002` creates `adapter_submission_debug_payloads` (FK to `adapter_submissions` with `ON DELETE CASCADE`, strict RLS — **zero `TO authenticated` policies**, service_role only, indexed on `created_at` and `adapter_submission_id`).

`audit-trail.ts::markSubmitted` writes the **pre-redaction** raw payload to the side table when `PHI_DEBUG_ENABLED === 'true'` (exact string compare). Write is best-effort: warn + swallow on failure. Skipped when the primary submission UPDATE failed (no FK target) or when `requestPayload` is undefined.

New cron at `/api/cron/purge-phi-debug` (bearer-auth via `CRON_SECRET`) deletes rows older than 24 hours. `vercel.json` schedules it daily at 03:00 UTC.

Specific scrutiny:
- **PHI exposure surface:** confirm the side table is truly service-role only — no policy permits authenticated session reads. Confirm the table is not exposed via Supabase's auto-generated REST endpoints to anon/authenticated.
- Confirm the flag check is **exactly** `process.env['PHI_DEBUG_ENABLED'] === 'true'` (mirrors the `PHASE_C_GROUPS_ENABLED` pattern that the prior sweep verified).
- Confirm the write is conditional on primary submission success — never persist a debug payload without a parent `adapter_submission_id`.
- Confirm the cron handler is idempotent + handles 0-row deletes gracefully.
- Confirm the cron auth pattern matches existing cron handlers (look at one of `src/app/api/cron/*` for the bearer check).
- Confirm the memo update in `docs/audits/phi-policy-adapter-submissions.md` is accurate — section heading `## Ephemeral debug payloads (2026-06-14)`.
- The `as unknown as { from: … }` cast at the debug-table call site is documented (regen pending). Verify the cast doesn't mask a real type bug.

### Cross-PR dimensions to audit

1. **Type system consistency.** Three of the five PRs hand-edited `database.types.ts` because migrations weren't applied to prod yet (per agent instructions). All migrations are NOW applied. After PRs merge, the next `npm run db:types` will regenerate. Verify the hand-edits won't conflict with a clean regen.

2. **RLS across the new tables.** `dispute_orders` follows the `auth.jwt() -> 'user_metadata' ->> 'clinic_id'` convention. `adapter_submission_debug_payloads` has zero authenticated policies (service-role only). `orders_provider_clinic_optin_select` is additive and clinic-scoped. Confirm no policy uses the stale `auth.jwt() ->> 'clinic_id'` (always NULL) pattern that was identified + fixed in `20260611000005`.

3. **Migration deploy ordering.** All 4 migrations are LIVE in production right now (verified via `supabase migration list --linked`). Code merge order can be any. Flag any PR whose code, if merged WITHOUT its migration, would break — that's a tripwire we want to know about even though the migrations are already live.

4. **Test coverage gaps.** Highlight any logic in PRs #91, #92, #94 that lacks a test for an error path or a security boundary. Don't enumerate trivial gaps.

5. **Flag-gating consistency.** PR #94's `PHI_DEBUG_ENABLED` mirrors Phase C's `PHASE_C_GROUPS_ENABLED` pattern. Confirm the gate is consistent (exact string `'true'`, no truthy coercion, no untested off-state behavior).

### Verify-before-report guardrail

Same as the 2026-06-11 sweep:
1. Cite file:line.
2. Quote the line verbatim.
3. State the misbehavior in input/output terms.
4. Propose the exact fix.

Don't report without all four. If under 95% confident, mark as soft finding with a question.

### Out of scope

- F-4 (patient-detail view) — deferred to a separate effort, not in this batch.
- Phase C functional behavior already cleared in the 2026-06-11 round-3 review — don't re-audit.

### Output format

```
=== PR #90 ===
Verdict: PASS / PASS-with-followups / CHANGES-REQUIRED
Findings: …

=== PR #91 ===
…

=== PR #92 ===
…

=== PR #93 ===
…

=== PR #94 ===
…

=== Cross-PR Observations ===
…

=== Overall ===
{PASS | CHANGES-REQUIRED}
Recommendation: merge order (which to merge first, which to hold) + which PRs (if any) need fixes before merge.
```
