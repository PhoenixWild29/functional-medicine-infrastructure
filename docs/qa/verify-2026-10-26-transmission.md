# Verification: A's fixes for B's review of order-transmission-integrity (T1-T7)

D-2026-10-26-04. An independent check by an agent that has not worked on this branch.

- **What was checked:** `origin/order-transmission-integrity` at **e2d293e1**, the head on 2026-10-26; nothing newer existed when checked. Red tests are at 9d962c3f; the earlier head was 2b9b69a5.
- **The findings:** T1 to T7 in `origin/review-hipaa-fixes:docs/qa/review-2026-10-26-hipaa-fixes.md`.
- **Only confirmed results are reported.** Each one was confirmed by one of these:
  - running A's tests before and after the fix;
  - my own probe tests, run against the real guard and binding code with scripted rows (`verify-2026-10-26-transmission/transmission-probe.test.ts.txt`, 14 tests, all pass on e2d293e1);
  - a Chromium run (`verify-2026-10-26-transmission/redirect-probe.cjs.txt`);
  - a Node fetch run;
  - reading the code, marked as such where it is the only evidence.
- **Nothing was pushed to order-transmission-integrity.** Nothing touched a database, Vercel, Stripe or a secret.

## Summary

| Finding | Fixed? | Test red before the fix | Left open (confirmed) |
|---|---|---|---|
| T1: forgeable binding, unlimited legacy | **Yes** | Yes | A public development key is used whenever `VERCEL_ENV` is not `production`. The legacy rule is weaker for one actor. Rotating the key strands orders. The cutoff is hard-coded. |
| T2: unbound fields and destination | **Yes** | Yes | Legacy orders still send live names (by design). |
| T3: two reads | **Yes** | Yes | None. |
| T4: Tier 1 follows redirects | **Yes** | Yes | The OAuth `token_url` has no https check. |
| T5: Tier 2 https after first navigation | **Partly** | Yes | **The context route does not see redirect hops: a 307 resends a submitted form to http.** |
| T6: allergy edit strands orders | Fails closed, with a clear message | Yes | The clinic is told to cancel, but only ops can cancel a paid order. |
| T7: status poll https | **Yes** | Yes | The same redirect-hop gap as T5. |

**Tests:** A's 9 test files for T1 to T7 pass at e2d293e1 (253 tests). At the red commit 9d962c3f, all 9 files fail: 19 tests fail, and the rest of the failing files cannot load because the new exports do not exist yet. Both runs were on the same checkout.

## T1. The binding is keyed; legacy needs a signing record

**Fixed.** Confirmed by A's tests and my probes:
- **Keyed binding:** `provider_signature_hash_snapshot` is now `v3:<digest>:<HMAC-SHA256(RX_BINDING_SECRET, domain, digest, signing time, canonical content)>` (`src/lib/orders/signature-binding.ts`).
- **Values the guard refuses** as `signature_mismatch`, with the server secret set:
  - an unkeyed SHA-256 of the same message;
  - an HMAC made with the development key from the source;
  - a `v2:` value;
  - a two-part value;
  - any of these over altered content (new `sig_text`, refills 11);
  - altered content after a real signature.
- **A bare 64-hex value (64 zeros)** is refused with no signing history row. It is accepted as legacy only when a `DRAFT -> AWAITING_PAYMENT` history row:
  - is older than `LEGACY_SIGNING_CUTOFF`;
  - has a signing actor;
  - carries no `signature_binding` marker;
  - for `provider_batch_sign`, carries the same digest.

  A newer row, another actor, a different digest, or a row with the marker, is refused.
- **Clinic users cannot write such a row:**
  - `order_status_history` inserts are service-role only (policy `order_status_history_service_role_insert`, 20260317000004);
  - `record_order_status_change` is revoked from anon and authenticated (20260919000001:113).

  Read from the migrations.
- **No key in production** (`VERCEL_ENV=production`, no `RX_BINDING_SECRET`):
  - the guard refuses with `binding_key_missing`, and the message names the variable, never a value;
  - batch sign returns 503 `BINDING_KEY_MISSING` before reading or writing anything;
  - the ops reroute returns 503 before any change;
  - there is no other signing path (`signBatch` is the only writer of the column).

  From A's tests and my probe.
- **Health check:** `GET /api/health` reports `checks.rx_binding_secret: "set" | "missing"` by name only. It answers 503 only in production when the key is missing, and 200 elsewhere. From A's red tests.

**Left open (confirmed):**
1. **Outside `VERCEL_ENV=production`, the development key in the source is used silently.**
   - My probe, with `VERCEL_ENV=preview` and no secret: a value computed with that public key verifies as `match` over altered content.
   - That is intended for local, CI and E2E. But any deployment that serves real orders without `VERCEL_ENV=production` has a forgeable binding, with only a "missing" line on a 200 health check. Two examples: a non-Vercel host, or a preview pointed at production data.
   - Suggest: fail closed whenever the database is the production project, or require the key in every deployed environment.
2. **Rotating `RX_BINDING_SECRET` strands every signed, unsent order.**
   - My probe: an order signed under the old key is refused as `signature_mismatch` under the new one.
   - There is no list of old keys, and no re-bind path.
   - The clinic is told "the prescription changed after it was signed" and to cancel and prescribe again. That is wrong for a rotation: nothing changed.
   - The only path is ops `cancel_refund`, then a new prescription and payment.
   - Suggest: accept a list of retired keys for verification only, or rotate only when no orders are between signing and sending. Write down which in the ops runbook.
3. **For `provider_sign_and_send` history rows, the legacy rule does not compare the digest.**
   - My probe: 64 zeros on an order with a pre-cutoff `provider_sign_and_send` row is sent.
   - That row must exist, and only the old signing code wrote it, so the order really was signed by a provider.
   - The current code no longer writes that actor, and legacy orders are not content-checked in any case. Low.
4. **`LEGACY_SIGNING_CUTOFF` is hard-coded to 2026-11-01T00:00Z,** and the comment says to set it to the deploy time.
   - If the deploy is after that, orders the old code signed between the cutoff and the deploy are refused, which fails closed.
   - Rows written after the deploy carry the `signature_binding` marker (`batch-sign.ts:1072`), so a later cutoff does not admit them.
   - Set it at deploy.

## T2. Patient, prescriber and destination are bound

**Fixed.** Confirmed by A's tests and my probes:
- **Signing-time snapshots:** signing writes `patient_snapshot` (name, date of birth, allergy status) and `prescriber_snapshot` (name, NPI, DEA, license state), and binds them.
  - The guard returns those snapshots, not live rows. My probe: the live provider row had a different NPI and no DEA, and the sent prescriber had the signed ones.
  - A snapshot changed after signing is `signature_mismatch`.
- **The pharmacy:** the guard compares `pharmacy_id` with `pharmacy_snapshot.pharmacy_id`. A difference is refused (`pharmacy_mismatch`) unless the latest pharmacy-changing reroute in the history names the current `pharmacy_id` and carries a valid `reroute_binding`.
  - That proof is an HMAC under the server key over order id, signature value, new pharmacy and reroute count.
  - A proof made with another key, or a proof for another pharmacy, is refused.
  - A caller naming a pharmacy that is not the order's is refused.
- **The reroute re-binds through an audited row:** `api/ops/orders/[orderId]/action` (`reroute`) computes the proof and writes it into the `casTransition` history row's metadata, in the same CAS update that changes `pharmacy_id`. No key in production: 503 before anything changes.
- **Nothing else changes the pharmacy:**
  - no other app write sets `orders.pharmacy_id`. The signed-order-freeze test's static scan, extended to `pharmacy_id` and run on e2d293e1, found 22 order writes; only the reroute's `casTransition` patch sets it;
  - clinic users cannot forge the history row;
  - before B4 (000004), a clinic user could still write `pharmacy_id` directly, but the send is refused without the proof;
  - signed-order-freeze (000010) also blocks it at the database. That is a separate branch.

**Left open:** legacy orders (no snapshots) are still sent with the live patient and prescriber rows. That is A's stated design.

## T3. One read

**Fixed.** Confirmed by A's tests and the code:
- Each adapter calls `loadTransmittableOrder` once and builds the payload from the returned row, patient and prescriber: `tier1-api.ts:151,250`, `tier2-portal.ts:202,270`, `tier4-fax.ts:89,129`.
- The adapters no longer select the order, the patient or the provider again. The only `orders` write left in Tier 4 is the fax id and attempt count after sending.
- A's test counts one content read of `orders`.

## T4. No redirects in Tier 1

**Fixed.** Confirmed:
- `tier1-api.ts:352` passes `redirect: 'error'`, and A's test asserts it. That test was red before the fix: its suite could not load.
- Node fetch with `redirect: 'error'` rejects a 307 ("unexpected redirect") and the target receives nothing. My run: Node 20.18, local servers.
- The OAuth token request (`vault.ts:109`) also has `redirect: 'error'` now. No test covers it.

**Left open (by reading the code):** `creds.token_url`, from the pharmacy's vault credential, is not checked for https before the client secret is posted to it. That is a credential, not PHI. Apply `assertSecurePharmacyUrl` to it.

## T5. Tier 2 https after the first navigation

**Partly fixed.**
- **What holds:**
  - Before anything is typed, `assertPageSecure` checks that the page is https, on every `fill` and `select` step (`portal-flow-executor.ts:137,169`). A's test covers it.
  - `enforceHttpsOnly(context)` is installed before the page opens, in Tier 2 (`tier2-portal.ts:382-383`) and in the status poll.
  - Requests the page makes directly to http are aborted.
- **Left open, confirmed with Chromium (Playwright 1.58.2, chromium-1208): the route handler does not see redirect hops.**
  - **The probe:** a context route that aborts the "blocked" origin, as `enforceHttpsOnly` aborts http, and two local servers.
    - A `page.goto` that got a 302 to the blocked origin landed there; the route saw only the first URL.
    - A form POST that got a 307 to the blocked origin was resent there, body included (`phi=Jane+Doe+1980-01-01`).
    - Playwright documents the same for `page.route` ("only called for the first url if the response is a redirect").
  - **In production terms:** an https portal that answers a submit with a 307 to http sends the submitted form, which holds PHI or credentials, in cleartext. `assertPageSecure` only stops the next fill, after the fact.
  - The comment "redirects included" on `enforceHttpsOnly` is not accurate.
  - **Suggest:** in the route handler, use `route.fetch({ maxRedirects: 0 })` and check any `Location` with `isSecurePharmacyUrl` before `route.fulfill`, or abort on any 3xx to a non-https URL. Then add a Chromium test like the probe.

## T6. What the clinic and ops see

**Fails closed, with its own message.** Confirmed by A's tests and the code:
- A live allergy change after signing is refused as `allergies_changed`; my probe confirms it.
- **The clinic's order drawer** (`submission-failure.ts`) shows: "Sending to <pharmacy> failed: the patient's allergies changed after the prescription was signed. Cancel this prescription and prescribe it again, so the prescriber signs it with the current allergies. CompoundIQ ops has been alerted."
  - The same "cancel and prescribe again" ending is used for `signature_mismatch`, `unsigned_order` and `pharmacy_mismatch`.
  - `binding_key_missing` gets "ops ... will re-route or retry".
- **Ops** get the Slack failure alert with the code. The codes are on the alert allow-list (`slack/client.ts`).
- **Still no re-sign path.** The fix makes the dead end explicit; it does not open one. That was B's alternative.

**Left open (by reading the code):**
- The clinic is told to cancel, but a clinic can only delete drafts (`DELETE /api/orders/[orderId]` is DRAFT-only).
- A paid order in SUBMISSION_FAILED or FAX_FAILED is cancelled only through ops `cancel_refund`.
- Suggest: "CompoundIQ ops will cancel and refund it; then prescribe it again."

## T7. Status poll https

**Fixed.** Confirmed by A's tests and the code:
- `portal-status-poll` checks the status flow's navigate URLs with `assertSecureFlowUrls` before credentials are decrypted. An http flow reads no credentials and starts no browser.
- The poll routes the context with `enforceHttpsOnly` before opening the page.

**Left open:** the same redirect-hop gap as T5.

## Opened by the fixes

- **Key rotation strands orders:** T1, item 2.
- **The development key outside production:** T1, item 1.
- **A new migration (20261024000011)** for the two snapshot columns. Signing writes them, so it must be on prod before this code deploys.
  - Its header says the 000010 freeze covers them. signed-order-freeze 798508ad does not list them.
  - Already reported in D-2026-10-26-03 (runbook, "Not in the plan yet").

## How to re-run the probes

Neither file is run by the repo's jest or tsc (they are `.txt` here, because they import code from order-transmission-integrity).

- **`transmission-probe.test.ts.txt`:** check out e2d293e1, copy the file to `src/lib/adapters/__tests__/zz-probe.test.ts`, run `npx jest src/lib/adapters/__tests__/zz-probe.test.ts`, then delete it.
- **`redirect-probe.cjs.txt`:** copy it to a scratch directory as `.cjs` and run `node redirect-probe.cjs <path to a checkout with playwright installed>`. It needs the Playwright Chromium (`npx playwright install chromium`).
