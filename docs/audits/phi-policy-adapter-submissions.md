# PHI Policy Decision — `adapter_submissions.request_payload`

**Author:** session 2026-06-09 (Codex full-session review Section 5 follow-up)
**Audience:** AI agents + the user. Not partner-facing.
**Status:** **DECISION REQUIRED — pre-blocker for first real pharmacy API traffic.**

## What Codex flagged

> "The bigger issue is tier1-api stores full pharmacyPayload in adapter_submissions.request_payload. Decide whether that is acceptable under the HIPAA logging/storage policy; if not, redact or omit PHI at audit-trail write time."

## Current state (verified from code)

`src/lib/adapters/audit-trail.ts` (and the tier1-api submission path) writes a full snapshot of the outbound pharmacy payload to `adapter_submissions.request_payload` (column type `jsonb`). That payload — for any non-Tier4 pharmacy — contains:

- Patient first name + last name + date of birth + full mailing address
- Provider full name + NPI + DEA + license state
- Medication name + form + dose + quantity + sig text (= directions = controlled-substance prescription detail)

All of this is **PHI** under HIPAA §164.514 (it identifies the individual + relates to past, present, or future provision of health care).

Other things in the same row:
- `response_payload` jsonb — may include PHI back from the pharmacy
- `error_message` text — usually doesn't, but could (e.g., "patient X address invalid")

## Why this is a policy decision, not a coding question

There are three defensible options, each with different operational + compliance tradeoffs. The user (or counsel) needs to pick one before real pharmacy API traffic.

### Option A — Store full payload (current behavior)

- **Pro:** Best debugging. When a submission fails, ops can see the exact bytes sent and reconstruct what the pharmacy received.
- **Pro:** Best audit trail for disputes. Pharmacy claims "we never got the right address" → we have proof.
- **Con:** Every adapter_submissions row is a PHI record. Backup retention, replica copies, Sentry traces, Supabase logs may all ingest it.
- **Compliance lift:** Treat the table as PHI. Apply minimum-necessary retention. Cover under the existing BAA scope. Audit access. Verify Supabase's encryption-at-rest covers it (default yes, but document).
- **HIPAA §164.502(b):** disclosing PHI to a business associate (the pharmacy) is permitted; storing the disclosure record for audit is permitted under §164.514 if minimum-necessary is observed.

### Option B — Redact at write time

- **Pro:** Reduces blast radius. If the table leaks, no PHI leaks.
- **Pro:** Logs and traces never see PHI.
- **Con:** Lost debugging detail. "What did we send?" is now "I don't know — we redacted it."
- **Con:** Reconstructing a dispute requires either re-running the transformer or hoping the pharmacy logs match.
- **Implementation:** wrap `audit-trail.ts:createSubmissionRecord` to strip patient name + DOB + address + medication + sig from the payload before insert. Keep order_id, pharmacy_id, transformer name, status.
- **What to keep:** just enough to know "submission X for order Y went to pharmacy Z and got response code N."

### Option C — Hybrid (redact-by-default, opt-in retention window)

- **Pro:** Most flexibility. Debug retention for N days; PHI-free retention for the legally-mandated 6 years.
- **Con:** Two columns (or two tables) doubles the surface area.
- **Implementation:**
  1. Keep current write path (full payload)
  2. Add a daily cron that redacts payloads on rows older than 30 days (or whatever window)
  3. After redaction, only metadata + status remain for the long-tail audit

## Code locations relevant to any change

- `src/lib/adapters/tier1-api.ts` — the submission flow that calls `createSubmissionRecord`
- `src/lib/adapters/audit-trail.ts` — the helpers that insert/update adapter_submissions
- `src/types/database.types.ts:adapter_submissions` — column types
- `supabase/migrations/20260317000003_create_v2_adapter_tables.sql` (or wherever the table was created) — for schema lineage

## Related Codex Section 5 follow-ups (defer or bundle)

- Add a runtime assertion that the transformer output never appears in any `console.log` (defense in depth). Codex called this "narrow" — agreed.
- LifeFile fixtures with recorded sandbox samples once Lauren delivers them. Out of scope here.

## Recommendation

**Option B (redact at write time)** for the start of real pharmacy traffic, with one carve-out: keep the **first 24 hours** of full payload via a separate ephemeral table or column that auto-purges. That gives you debugging recency without long-tail PHI exposure.

Then revisit after 90 days of real operation. If debugging proves impossible without longer retention, move to Option C with a documented retention window.

This is a recommendation, not a decision. The user needs to confirm.

## Action items once a path is chosen

1. **Confirm BAA scope with Supabase** covers `adapter_submissions` (or use a separate Vault-encrypted column for the payload).
2. **Update `audit-trail.ts`** to apply the chosen redaction strategy.
3. **Migration** if Option C: add a `payload_redacted_at` timestamp column + the redaction cron.
4. **Update the PHI inventory doc** (does the project have one? if not, create it under Track 2 alongside the RLS audit doc).
5. **Update Sentry SDK config** to scrub PII patterns from any payload-bearing error report — this matters regardless of the storage policy.
6. **Verify logging** — ensure no `console.log` / structured logger emits the request_payload in any path.

## Open questions for the user

1. Has Supabase's BAA been verified to cover this table specifically, or does it need a separate provision?
2. Is there an internal retention/compliance doc this policy should be added to?
3. Is Sentry already configured to scrub PII patterns? (`beforeSend` hook in `sentry.server.config.ts`?)
4. What is the desired retention window for adapter_submissions (HIPAA min 6 yr, but does redacted metadata count as "retained" for that requirement)?

## Implementation

**Decision (2026-06-11):** Option B — redact at write time.

**Redaction helper:** [`src/lib/phi/redact-adapter-payload.ts`](../../src/lib/phi/redact-adapter-payload.ts)

- `redactAdapterRequestPayload(raw)` returns `{ redactedPayload, fingerprint }`.
- Recursive key-based redaction: every PHI leaf (patient name/DOB/address/contact, medication name/form/dose/quantity/sig, provider DEA, MRN/SSN) is replaced with the literal token `"[REDACTED]"`. Container keys (`patient`, `prescriber`, `medication`, `body`, …) are preserved so the structural shape stays inspectable for ops.
- Contextual rules cover ambiguous bare keys: `state` / `country` inside a `patient` container; `form` / `strength` / `route` / `frequency` inside a `medication` / `prescription` / `rx` container.
- Fingerprint is a SHA-256 hex digest of a deterministic canonical (sorted-key) JSON encoding of the **original** payload. Stable across replays, distinct across distinct inputs — used by ops to correlate retries / disputes without re-reading PHI.

**Persistence:**

- Redacted payload → `adapter_submissions.request_payload` (existing JSONB column, unchanged shape).
- Fingerprint → `adapter_submissions.metadata.phi_fingerprint` (existing JSONB column, new reserved key). **No schema migration needed.**

**Wiring:** [`src/lib/adapters/audit-trail.ts:markSubmitted`](../../src/lib/adapters/audit-trail.ts) — the sole write site for `request_payload`. Tier 1 / Tier 2 / Tier 4 adapters all funnel through this helper.

**What is unchanged:**

- The outbound HTTP body sent to the pharmacy API is **identical** — redaction only affects what we store locally.
- `response_payload` is unchanged. Its policy decision is separate and pending.
- Historical rows are unchanged — Option B is forward-only by the memo's spirit. No backfill is required or performed in this PR.

**Tests:** [`src/lib/phi/__tests__/redact-adapter-payload.test.ts`](../../src/lib/phi/__tests__/redact-adapter-payload.test.ts) — 19 tests covering all PHI categories, the four naming conventions (snake_case / camelCase / nested / flat), fingerprint determinism + uniqueness, and null / empty / deeply nested edge cases.

**Carve-out from the original recommendation (24h ephemeral table) — deferred.** The original recommendation suggested a separate auto-purging table for 24h of full payload retention to preserve debuggability. That carve-out is deferred to a follow-up; in the meantime, the SHA-256 fingerprint + structural shape + non-PHI fields (URL, transformer name, HTTP method, order/pharmacy IDs) are enough to triage most adapter failures. Revisit if real pharmacy traffic shows the fingerprint-only audit trail is insufficient.
