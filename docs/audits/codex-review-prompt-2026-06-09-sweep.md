# Codex Review Prompt — Post-Codex Sweep, 2026-06-09

**Audience:** Codex, paste directly. Not a runbook.

**Scope:** the 7 PRs merged to `main` AFTER your full-session review on 2026-06-09. Test count went 188 → 207 over these PRs. F-1 is live in production; F-2 + F-3 are now layered on top via the new work below. Phase C Stage 1 migration is **merged but not yet applied to production**.

---

## Mission

You're doing a second-pass review on a fast-moving day where 7 PRs landed without intermediate Codex passes. This is a checkpoint — confirm that:

1. The F-1 → F-2 → F-3 chain stays coherent now that F-3 + signer-guard refactor + provider admin route + Phase C cart layer on top
2. New surfaces don't introduce regressions, security holes, or bypass paths
3. The deploy-order gap (Stage 1 migration not yet applied; Stage 2 endpoint merged) is the only outstanding live-system risk

We have an explicit prior pattern: when you've flagged a real bug (your prior Section 2 caught the POC credential mutation route), we ship the fix immediately. So flag aggressively — false-positive cost is low.

Hard cutoff: we are NOT reviewing the 6 PRs from the prior Codex pass (#67–72) or the F-1 production deploy itself. Those landed clean. **Focus on PRs #73, #74, #75, #76, #77, #78, #79.**

## Project context (so you don't have to ask)

- Next.js 16 App Router + Supabase + Stripe Connect Express + Twilio + Documo + Sentry on Vercel
- Healthcare POC heading to first-clinic onboarding in 4–6 weeks
- F-1 (`providers.user_id`) is live; Dr. Chen linked to `fdadca09-9070-4722-8400-8b0bce957c73`
- F-2 (signer enforcement) live; F-3 (middleware block of `/new-prescription/sign/*`) live
- POC_MODE gating comprehensive (page + 3 API routes + cron + helper) — verified by your earlier pass

---

## Section 1 — PR #73: POST /api/providers admin route

Commit: `97b30d6`

### What it does

Production-grade replacement for the seed-script's `linkProviderToAuthUser()` convention. Two-step atomic create:

1. `supabase.auth.admin.createUser` with `user_metadata.app_role = 'provider'`
2. `providers.insert(...)` with `user_id` linked to step-1's auth UID

If step 2 fails, step 1 is rolled back via `auth.admin.deleteUser`. A **rollback failure** (double-fault) is logged as CRITICAL but still returns 500 to the caller.

### Authorization model

- `clinic_admin` → can create providers in OWN clinic only (cross-tenancy: 403 with logged warning)
- `ops_admin` → must specify `clinicId` in body (cross-clinic privilege)
- Anything else → 403

### Validation

- email shape (`includes('@')` + length ≤ 254)
- password min 12 chars
- NPI matches `^\d{10}$`
- US state code from hardcoded 56-entry set (mirrors the v1 migration CHECK)
- non-empty name + license_number

### Collision handling

- Pre-check: NPI uniqueness via `SELECT provider_id FROM providers WHERE npi_number = $1 AND deleted_at IS NULL`
- createUser error matching: `/already/i` on the error string → 409 "Email already registered"

### Embedded diff (route only — tests + types are obvious)

```ts
// src/app/api/providers/route.ts (new file, full route reproduced)

// ── Cross-tenancy enforcement
if (callerRole === 'clinic_admin') {
  if (!callerClinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }
  if (body.clinicId && body.clinicId !== callerClinicId) {
    console.warn(`[providers POST] cross-tenancy attempt | caller=${session.user.id} caller_clinic=${callerClinicId} target_clinic=${body.clinicId}`)
    return NextResponse.json({ error: 'clinic_admin can only create providers in their own clinic' }, { status: 403 })
  }
  targetClinicId = callerClinicId
} else {
  // ops_admin path
  if (!body.clinicId || !UUID_RE.test(body.clinicId)) {
    return NextResponse.json({ error: 'ops_admin must specify a valid clinicId in the request body' }, { status: 400 })
  }
  targetClinicId = body.clinicId
}

// ── Create auth user
const { data: createdUser, error: createUserErr } = await supabase.auth.admin.createUser({
  email: normalizedEmail,
  password: body.password,
  email_confirm: true,
  user_metadata: { app_role: 'provider', clinic_id: targetClinicId },
})

if (createUserErr || !createdUser?.user) {
  const msg = createUserErr?.message ?? 'unknown'
  if (/already/i.test(msg)) {
    return NextResponse.json({ error: 'Email is already registered with another account' }, { status: 409 })
  }
  console.error(`[providers POST] auth.admin.createUser failed:`, msg)
  return NextResponse.json({ error: 'Failed to create auth user' }, { status: 500 })
}

const authUserId = createdUser.user.id

// ── Insert providers row (linked via user_id)
const { data: provider, error: providerErr } = await supabase
  .from('providers')
  .insert({
    clinic_id: targetClinicId,
    user_id: authUserId,
    first_name: body.firstName.trim(),
    last_name: body.lastName.trim(),
    npi_number: body.npiNumber,
    license_state: body.licenseState,
    license_number: body.licenseNumber.trim(),
    dea_number: body.deaNumber?.trim() || null,
    signature_on_file: false,
    is_active: true,
  })
  .select(/* … */)
  .single()

if (providerErr || !provider) {
  // Rollback the auth user
  console.error(`[providers POST] providers.insert failed (rolling back auth user ${authUserId}):`, providerErr?.message)
  const { error: rollbackErr } = await supabase.auth.admin.deleteUser(authUserId)
  if (rollbackErr) {
    console.error(`[providers POST] CRITICAL: rollback of auth user ${authUserId} failed:`, rollbackErr.message,
      '— orphan auth identity left in the system, needs manual cleanup')
  }
  return NextResponse.json({ error: 'Failed to create provider record' }, { status: 500 })
}
```

### Targeted concerns

1. **Email collision detection via error-string matching** (`/already/i.test(msg)`) is fragile if Supabase changes its error format. Is there a better signal (error code, status field)?
2. **Rollback ordering**: if `providers.insert` returns 23505 (unique violation on `npi_number` despite our pre-check — race), we delete the auth user. Is the order right, or should we leave the auth user and retry the insert with a more informative error?
3. **Cross-tenancy by `ops_admin`**: an ops_admin can plant a provider in any clinic. Should the route also verify `targetClinicId` actually exists in the `clinics` table? (Today the FK will reject, but the failure mode is generic 500.)
4. **Password handling**: caller supplies the initial password. Should we force-reset on first login? Currently no `email_confirmed_at` requirement (we set `email_confirm: true` to bypass verification). Provider can sign in immediately.
5. **TOTP enrollment** is deferred to provider self-enroll on first EPCS sign. Is that the correct boundary, or should the admin route at least seed `providers.totp_secret_encrypted = NULL` explicitly to make state clearer?
6. **17 tests** cover auth, validation, cross-tenancy, collisions, rollback (including the double-fault), happy path. Any missing case?

---

## Section 2 — PR #74: F-3 middleware block of /new-prescription/sign/*

Commit: `7b2545a`

### What it does

Adds a 4-line guard to `src/middleware.ts` between the existing clinic-app role check and the response. If pathname starts with `/new-prescription/sign/` AND `appRole !== 'provider'`, redirect to `/unauthorized`.

```ts
// F-3: provider-only screens
if (pathname.startsWith('/new-prescription/sign/') && appRole !== 'provider') {
  return applySecurityHeaders(NextResponse.redirect(new URL('/unauthorized', request.url)))
}
```

### Tests (6 new cases)

- MA → `/new-prescription/sign/[orderId]` → 307 `/unauthorized`
- clinic_admin → same → 307 `/unauthorized`
- provider → same → no redirect (passes through)
- MA + clinic_admin → `/new-prescription` (parent) NOT blocked (draft prep still allowed)
- MA → `/new-prescription/review` (sibling) NOT blocked

### Targeted concerns

1. **Path matching with query strings + fragments**: `pathname.startsWith('/new-prescription/sign/')` — does Next's middleware `pathname` ever include the query string? (My read: no, but worth confirming.)
2. **Trailing slash edge case**: what if a user visits `/new-prescription/sign` (no trailing slash)? The startsWith check is `/new-prescription/sign/` with trailing slash → that URL would NOT be blocked. Is `/sign` (with no orderId) a real route? If so, intentional or oversight?
3. **Provider with NO `clinic_id` claim**: ops_admin has no `clinic_id`. An ops_admin reaching this URL would still be blocked because `appRole !== 'provider'` matches `'ops_admin'`. Correct, but worth confirming this is the intended behavior — ops_admins should NOT be reaching this URL.
4. **No layout-level check** added for the `/sign/[orderId]` Server Component. F-2 catches the API call; F-3 catches the page request via middleware. Is there a third layer worth adding (server-component check of `session.app_role === 'provider'`)? Defense-in-depth or overkill?

---

## Section 3 — PR #75: Phase C Stage 1 — payment_groups schema

Commit: `fb71f5c` — **migration NOT yet applied to production**

### What it does

Creates `payment_groups` table + `orders.payment_group_id` column. Migration file: `supabase/migrations/20260609000001_phase_c_payment_groups.sql`.

```sql
CREATE TABLE IF NOT EXISTS payment_groups (
  group_id                  UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id                 UUID         NOT NULL REFERENCES clinics(clinic_id),
  patient_id                UUID         NOT NULL REFERENCES patients(patient_id),
  provider_id               UUID         NOT NULL REFERENCES providers(provider_id),
  stripe_payment_intent_id  TEXT,        -- nullable until PI created
  total_cents               INTEGER      NOT NULL CHECK (total_cents > 0),
  status                    TEXT         NOT NULL DEFAULT 'AWAITING_PAYMENT'
    CHECK (status IN ('AWAITING_PAYMENT','PAID','EXPIRED','CANCELLED')),
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,
  is_active                 BOOLEAN      NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_groups_stripe_pi_unique
  ON payment_groups (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_group_id UUID REFERENCES payment_groups(group_id) ON DELETE SET NULL;

-- Partial unique index — at most one ACTIVE group per order
CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_group_unique
  ON orders (order_id)
  WHERE payment_group_id IS NOT NULL AND deleted_at IS NULL;

-- RLS — clinic users see their own clinic's groups; service_role bypasses
CREATE POLICY payment_groups_clinic_user_select ON payment_groups
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);
CREATE POLICY payment_groups_clinic_user_insert ON payment_groups
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);
CREATE POLICY payment_groups_clinic_user_update ON payment_groups
  FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() ->> 'clinic_id')::UUID);
CREATE POLICY payment_groups_service_role_all ON payment_groups
  FOR ALL TO service_role
  USING (true);
```

### Targeted concerns

1. **`orders_payment_group_unique` partial index on `order_id`**: `order_id` is already the primary key, so the partial unique on `order_id WHERE payment_group_id IS NOT NULL` is **redundant** — a PK is already unique. I wrote this thinking it would enforce "at most one active group per order" but actually the design constraint is enforced by `orders.payment_group_id` being a single-valued column. Should this index be removed? Or did I mean to write `ON orders (payment_group_id, order_id)` for query performance?
2. **RLS DELETE policy missing**: no `FOR DELETE` policy. Intentional? Soft-delete only?
3. **`ON DELETE SET NULL` on `orders.payment_group_id`**: if a group is hard-deleted, its member orders revert to no-group state. Correct for soft-delete flows; but is hard-deleting a `payment_groups` row a real scenario we need to support? Cancelling sets `status='CANCELLED'` (no hard delete).
4. **`total_cents CHECK (total_cents > 0)`**: matches application logic. Confirms a zero-amount group can't exist.
5. **No status transition trigger**: status changes are at the application layer. Is that acceptable, or should there be a DB-level check enforcing valid transitions (AWAITING_PAYMENT → PAID/EXPIRED/CANCELLED only)?
6. **Idempotency of the migration**: uses `IF NOT EXISTS` / `DROP POLICY IF EXISTS + CREATE`. Verify these are correct for repeated application — important because the post-merge deploy may happen later than expected.

---

## Section 4 — PR #76: LF-3 stale doc fix + PHI policy memo

Commit: `b845e6e`

### What it does

- Two-line doc fix replacing `api_base_url` → `base_url` in `docs/technical/DATA-DICTIONARY.md` + `docs/technical/erd.md`
- New memo at `docs/audits/phi-policy-adapter-submissions.md` proposing 3 options (A: keep full, B: redact at write, C: hybrid)

### Targeted concerns

1. **Memo framing**: Are the three options exhaustive, or did I miss a fourth (e.g., encrypted-at-rest with key rotation)?
2. **Recommendation defense**: I recommended Option B + mandatory Sentry `beforeSend`. Is this defensible to counsel as "reasonable minimum standard" for HIPAA-aligned PHI minimization?
3. **Open questions section** asks the user 4 specific things. Are any of those questions actually answerable from the codebase without user input?

This is the LOWEST-priority section in this review since no code changed.

---

## Section 5 — PR #77: db:types automation script

Commit: `249c50e`

### What it does

Replaces:
```
"db:types": "supabase gen types typescript --project-id your-project-ref > src/types/database.types.ts"
```

with `bash scripts/regen-db-types.sh` which:
1. Captures `supabase gen types` stdout to a temp file, stderr to a separate temp file
2. Validates output starts with `export type Json` AND contains `export type Database`
3. Detects + strips CLI chatter lines after the `} as const` anchor (anything not starting with `//`, `/*`, `export`, `import`, whitespace)
4. Re-appends 3 custom type aliases as footer
5. Atomic write via `mv tmp.ts → real.ts`
6. `set -euo pipefail`

Tested end-to-end against the live project: byte-identical regen output vs the committed file.

### Targeted concerns

1. **CLI chatter detection logic**: lines after `} as const` that don't start with comment/export/import/whitespace are treated as chatter. What if Supabase ever adds a documented post-`as const` block that isn't a comment? (Unlikely but worth thinking about.)
2. **`} as const` anchor uniqueness**: the script uses the LAST occurrence of `^} as const` as the boundary. Is there any way a regen could have multiple `} as const` blocks at column 0? (Today: no. Forward-compat: maybe?)
3. **Custom aliases footer**: hardcoded as a heredoc. If someone adds a 4th alias in `database.types.ts` and runs db:types, the new alias would be **silently dropped** (it'd be in the body, then the regen replaces the body without it, and the heredoc only appends the 3 original aliases). Is this a footgun? Mitigation suggestion?
4. **Project ref hardcoded** (`rhrgtwmeowicohclkxlz`) with `SUPABASE_PROJECT_REF` env-var override. Public ID, not a secret. Defensible?
5. **Idempotency of repeated runs**: the script writes a fresh file every time. Concurrent runs against the same file path would race; not a real concern but worth noting.

---

## Section 6 — PR #78: F-2 followups (your Section 4 asks)

Commit: `e6abd68`

### What it does

Addresses YOUR three follow-ups from the prior review:

**Followup A — Move guard earlier**

Before: provider was inside a 4-way `Promise.all` with pharmacy/clinic/license. F-2 check fired after all 4 resolved.

After: provider fetched sequentially first. F-2 check fires before the (now-3-way) `Promise.all` on pharmacy/clinic/license. Unauthorized signers now short-circuit with 1 DB lookup instead of 4.

**Followup B — Hash actor in logs**

New helper:
```ts
async function actorTraceId(userId: string): Promise<string> {
  const full = await sha256Hex(userId)
  return `act_${full.slice(0, 12)}`
}
```

Both warn-log paths now emit `actor=act_<12-hex>` instead of `signer=<raw-uuid>`. Raw UID still available in the auth subsystem; just kept out of stdout.

**Followup C — Precedence regression test**

3 new tests added to `signer-guard.test.ts`:
- Signer-mismatch + bad NPI → 403 from F-2 (asserts pharmacy/clinic/license mocks NEVER called)
- Unlinked-provider + everything else → 403 from F-2 (same assertion)
- Log redaction: `console.warn` spy confirms raw `MA_USER_ID` NOT in log; `actor=act_<12-hex>` IS present

### Targeted concerns

1. **12-hex truncation collision risk**: 12 hex chars = 48 bits. At 1k providers, birthday-collision probability is ~negligible. At 1M providers, still <1%. Is this enough? Should we use full 64 hex chars (256 bits) for true uniqueness, accepting the longer log lines?
2. **Single-table fetch refactor**: provider was previously batched with 3 other queries. Now it's a separate RTT. For an authorized signer (the common case), this is **slower** by 1 RTT. Worth it for the security-precedence guarantee? My assumption was the unauthorized case dominates security concerns; the authorized case adds <50ms RTT. Confirm.
3. **`sha256Hex` is async** (Web Crypto API). The two log paths now `await actorTraceId(...)`. Is making the rejection path async (vs. fire-and-forget log) worth the latency, or should the hash be sync via Node's `crypto` API?
4. **The precedence tests assert `pharmacyFetchMock.not.toHaveBeenCalled()`**. This is strong evidence of the guard's precedence — but if a future refactor moves the pharmacy mock UP and stores it in a constant before the guard, the assertion passes wrongly. Suggest a more robust pattern?

---

## Section 7 — PR #79: Phase C Stage 2 — POST /api/checkout/payment-group

Commit: `cb74404`

### What it does (high level)

Creates a `payment_groups` row + Stripe PaymentIntent bundling N orders (2 ≤ N ≤ 25). Returns `{ groupId, stripePaymentIntentId, totalCents, orderCount }`.

### Atomicity strategy (the critical bit)

```ts
// 1. INSERT payment_groups row (status=AWAITING_PAYMENT, PI null)
const { data: groupRow } = await supabase.from('payment_groups').insert({
  clinic_id, patient_id, provider_id, total_cents, status: 'AWAITING_PAYMENT',
}).select('group_id').single()
const groupId = groupRow.group_id

// 2. CAS-link orders to the group
const { data: linkedOrders } = await supabase
  .from('orders')
  .update({ payment_group_id: groupId })
  .in('order_id', body.orderIds)
  .eq('status', 'AWAITING_PAYMENT')
  .is('payment_group_id', null)
  .is('stripe_payment_intent_id', null)  // ← prevents racing solo-PI creation
  .is('deleted_at', null)
  .select('order_id')

// 3. If linked count != N → rollback
if (linkedOrders.length !== body.orderIds.length) {
  await rollbackGroup(supabase, groupId, body.orderIds)
  return NextResponse.json({ error: 'Refresh and try again' }, { status: 409 })
}

// 4. Stripe PaymentIntent
const pi = await stripe.paymentIntents.create({
  amount: totalCents,
  currency: 'usd',
  application_fee_amount: totalApplicationFeeCents,
  transfer_data: { destination: connectAccountId },
  metadata: { payment_group_id: groupId, clinic_id, order_count: String(N), platform: '8090ai' },
  // Zero PHI
  description: `CompoundIQ prescription bundle (${N} items)`,
  automatic_payment_methods: { enabled: true },
}, { idempotencyKey: `checkout-group-pi-v1-${groupId}` })

// 5. Stamp group with PI id
await supabase.from('payment_groups').update({ stripe_payment_intent_id: pi.id }).eq('group_id', groupId)

// 6. Stripe failure path
catch (stripeErr) {
  await rollbackGroup(supabase, groupId, body.orderIds)
  return 502
}
```

`rollbackGroup`:
```ts
await supabase.from('orders').update({ payment_group_id: null })
  .in('order_id', orderIds).eq('payment_group_id', groupId)
await supabase.from('payment_groups').update({ status: 'CANCELLED' }).eq('group_id', groupId)
```

### F-2 / F-3 carryover

For `provider` sessions: explicit lookup of `providers WHERE provider_id = <shared_provider_id>` and check `provider.user_id === session.user.id`. For `clinic_admin` / `medical_assistant`: identity-binding is by `clinic_id` only.

### Validation surface

- 401 / 403 / 400 (auth, role, missing clinic_id, bad JSON)
- 400: orderIds non-array, < 2, dupes, non-UUID, > 25
- 404: orderId doesn't resolve in caller's clinic
- 409: cross-provider / cross-patient / wrong status / already-in-group / has-solo-PI
- 502: Stripe call failure (rollback executed)

### Targeted concerns (HIGHEST PRIORITY OF THIS PROMPT)

1. **The CAS-link is NOT atomic across orders + group row**. Race scenario: two concurrent requests with the same `orderIds` and same clinic. Both pass validation. Both create different `payment_groups` rows (different group_ids). Then both try to CAS-link the orders. The first wins; the second's CAS predicate fails because `payment_group_id IS NULL` is now false. Second rolls back its group. Is this race handled correctly? Is there a scenario where BOTH partially succeed and we end up with an order linked to one group and another linked to another?

2. **Stripe call failure after CAS success**: if `paymentIntents.create` throws (network, 5xx, validation error), we call `rollbackGroup`. But the CAS UPDATE on orders **already committed**. The rollback's `.from('orders').update({ payment_group_id: null }).eq('payment_group_id', groupId)` undoes it — but if THAT update fails too, we have orders permanently linked to a CANCELLED group. They'd be unable to start a new group OR a solo PI (because `payment_group_id IS NOT NULL`). Is this a real concern? Should the orders unlink be retried, or should we use a Postgres function/transaction for true atomicity?

3. **Solo-PI race**: I added `.is('stripe_payment_intent_id', null)` to the CAS predicate to block ordering racing with a concurrent solo-PI creation request. But what if the solo PI is created AFTER the CAS lock + BEFORE the Stripe group PI lands? Looking at `/api/checkout/payment-intent/route.ts`, the solo route updates `orders.stripe_payment_intent_id` AFTER creating the PI. So the race window exists: solo route creates PI in Stripe → my route's CAS still sees `stripe_payment_intent_id IS NULL` because the solo route hasn't written it yet. Result: patient is charged twice for the same order. **Is this a real risk?** Mitigation?

4. **F-2 carryover only for `provider` role**: clinic_admin / MA sessions can create groups for ANY provider in their clinic. Is this correct (admin acts on behalf) or too permissive? Specifically: an MA could bundle orders signed by Dr. X under a "payment group on behalf of Dr. X" — even though F-2 prevented the MA from signing as Dr. X. Is the cart endpoint's looser binding a regression of F-2's intent?

5. **Stripe Connect placeholder**: the route checks `clinic.stripe_connect_account_id === 'poc_placeholder'` for POC mode. In the placeholder branch, NO `application_fee_amount` and NO `transfer_data` are sent — patient is charged to platform account directly. Is this correct for POC, or does it leak money to the wrong destination?

6. **Idempotency key `checkout-group-pi-v1-${groupId}`**: Stripe will return the same PI for any retry with the same key. But the key encodes `groupId`, which is fresh per request. So retries DON'T share the same key. Should the key encode `(clinic_id, orderIds.sort().join(','))` for true idempotency across retries?

7. **`order_count` in Stripe metadata**: I included `order_count` (string). Is "this patient has 7 prescriptions" a PHI concern? Probably not — it's a count, not content. But worth a sanity check.

8. **Tests (19 cases)**: covers validation, cross-row invariants, F-2 carryover, happy path. Missing:
   - Race condition test (concurrent group creation) — hard to write
   - Stripe failure path test
   - Rollback success/failure path test
   - Should any of these be added?

9. **`database.types.ts` manual stubs** for `payment_groups` + `orders.payment_group_id`. The stub matches my best guess of what `supabase gen types` will produce. Verify by inspection that the field ordering matches the table column declaration order (alphabetical, per other tables) and the Relationships array is complete.

10. **No GET endpoint** for retrieving group status. Stage 3 (webhook) will UPDATE status server-side; Stage 4 (clinic UI) will need a way to read group status to show progress. Should I have added a GET in this PR or defer?

---

## Section 8 — Cross-cutting concerns

1. **Deploy-order risk**: Stage 1 migration (PR #75) NOT yet applied to production. Stage 2 endpoint (PR #79) is in main. Any call to `POST /api/checkout/payment-group` against production right now returns 500 (no `payment_groups` table). Defensible because no clinic UI calls it yet — but how loudly should we communicate the gap to the user/team?

2. **F-1 → F-2 → F-3 → Phase C chain**: each layer adds enforcement; does the chain hold end-to-end?
   - Provider creates draft → all 3 clinic roles can prep (no role restriction on `/new-prescription`)
   - Provider signs at `/new-prescription/sign/[orderId]` → middleware (F-3) blocks non-providers + API (F-2) verifies provider.user_id
   - Provider/admin/MA can bundle orders for checkout → API (Phase C Stage 2) verifies same provider/patient/clinic; provider-session check carries F-2 intent
   - Patient pays → webhook (Stage 3, NOT YET SHIPPED) marks paid

3. **The 7 PRs landed without intermediate Codex passes**. Confirm there's no regression in the EPCS sign chain that would have been caught earlier (specifically: F-2 followups refactored the guard order; F-3 added a middleware layer; both interact with #79's cart path).

4. **Stale tests / unused mocks**: PR #78 refactored sign-and-send. The existing F-2 tests still set up mocks for pharmacy/clinic/license that ARE NO LONGER CALLED in the rejection path. Tests still pass (mocks just go unused). Is this a smell worth cleaning up?

---

## Output format

```
## Verdict
[PASS / PASS-WITH-FOLLOWUPS / CHANGES-REQUIRED]

## Critical findings (block further work / require revert)
- ...

## High findings (address within current sprint)
- Section X (PR #N) — concrete issue + concrete fix

## Medium / informational
- ...

## Cross-cutting concerns
- F-1 → F-2 → F-3 → Phase C chain coherence
- Deploy-order gap risk

## Section verdicts
- #73: ...
- #74: ...
- #75: ...
- #76: ...
- #77: ...
- #78: ...
- #79: ...

## Recommended next steps before resuming Phase C Stage 3
- [Specific actions, ordered]
```

Cap response at ~2500 words. Cite file paths + line numbers. Lean toward flagging concerns even at low confidence — false positives cost less than missed bugs at this point in the lifecycle.
