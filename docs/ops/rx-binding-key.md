# Prescription signature key: set, rotate, legacy cutoff

The signature on each order binds what the pharmacy receives (HIPAA B7):

- **The value.** `orders.provider_signature_hash_snapshot` is `v3:<signature digest>:<HMAC-SHA256>`.
- **The key.** The HMAC is keyed by a server secret, so the value cannot be forged without it.
- **What is bound.** The patient's name, date of birth and allergy status, the prescriber's name, NPI, DEA and license state, the pharmacy signed for, the medication and the whole Rx.
- **Checked at send.** Every send re-checks it. Code: `src/lib/orders/signature-binding.ts`, `src/lib/adapters/transmission-guard.ts`.

## The environment variables (names only; values never go in git or logs)

| Name | Required | What it is |
|---|---|---|
| `RX_BINDING_SECRET` | Yes, on every Vercel deployment (Production and Preview) and any server not run as a local test or development build | The signing key: 32 or more random bytes, e.g. `openssl rand -hex 32`. |
| `RX_LEGACY_CUTOFF` | Yes, once, when this code first deploys | An ISO time: the deploy time of this code, e.g. `2026-11-03T15:00:00Z`. |
| `RX_BINDING_SECRET_PREVIOUS` | Optional; only during a rotation | The key before the current one. It verifies, it never signs. |

### Without `RX_BINDING_SECRET` (fails closed)

Where the key is required and missing:

- **Signing** answers 503 `BINDING_KEY_MISSING`, before anything is read or written.
- **Every send** is refused as `binding_key_missing`: ops get the failure and an alert.
- **An ops reroute** to a new pharmacy answers 503.
- **`GET /api/health`** answers 503 with `checks.rx_binding_secret: "missing"`.

Only a local `npm test` or `npm run dev` (with `NODE_ENV` test or development, not on Vercel) falls back to a development key. That key is in the source, so it proves nothing.

CI's E2E job sets its own E2E-only value in `.github/workflows/ci.yml`. It is not a secret: the E2E project holds test data only.

### `RX_LEGACY_CUTOFF`

Orders the old code signed, before binding, carry a bare 64-character digest. Such an order is sent only if all of these hold:

- its service-written signing history row is older than this time;
- that row's signing time is the order's `locked_at`;
- that row's digest, where it records one, is the order's.

**Set the cutoff to the deploy time of this code.** If unset, or if it is not a valid time, no order is accepted as legacy. Each one fails closed: ops cancel and refund it, and the clinic prescribes again.

Do not move the cutoff later after the deploy. Rows written by the new code carry a binding marker and never count as legacy, but a later cutoff only widens what is accepted.

## Rotating the key

Rotating `RX_BINDING_SECRET` without the previous key strands every order that is signed but not yet sent: each is refused as `signature_mismatch`. So rotate in this order:

1. **Prepare.** Generate the new key, e.g. `openssl rand -hex 32`.
2. **Switch, keeping the old key for checking.** In Vercel, for each environment:
   - set `RX_BINDING_SECRET_PREVIOUS` to the current value;
   - set `RX_BINDING_SECRET` to the new value;
   - redeploy.

   New signatures and reroute proofs now use the new key. Orders signed under the old key still verify, and still send.
3. **Wait** until no order signed before the switch is still unsent:
   - none is in AWAITING_PAYMENT, PAID_PROCESSING, SUBMISSION_PENDING, REROUTE_PENDING, SUBMISSION_FAILED, FAX_QUEUED or FAX_FAILED with a `locked_at` before the switch;
   - unpaid ones expire with their payment link.
4. **Retire** the old key: remove `RX_BINDING_SECRET_PREVIOUS` and redeploy.

Only one previous key is kept. Never rotate twice inside step 3.

If the current key may have leaked, an order signed under it cannot be trusted:

- Rotate as above, but skip step 2's `RX_BINDING_SECRET_PREVIOUS`.
- Each unsent order is then refused (`signature_mismatch`). Ops cancel and refund those orders, and the clinics prescribe again.

## What the clinic sees on a refusal

Some refusals cannot be fixed by a retry: the patient's allergies changed after signing, the prescription changed, it is unsigned, or it is set to the wrong pharmacy. The order drawer then says:

> Sending to <pharmacy> failed: <reason>. CompoundIQ ops will cancel and refund it; then prescribe it again.

The allergy case adds "so the prescriber signs it with the current allergies". Ops cancel with the order's `cancel_refund` action; a clinic cannot cancel a paid order.
