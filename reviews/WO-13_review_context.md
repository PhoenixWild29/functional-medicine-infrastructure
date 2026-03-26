# WO-13 Review Context: JWT Token Generation & Validation

## Summary
WO-13 extends the existing `checkout-token.ts` (which already had `verifyCheckoutToken()` from the WO-6 Edge Runtime fix) with `generateCheckoutToken()`, and updates the Edge Middleware to validate JWT tokens on `/checkout/[token]` routes before page render. All crypto uses the Web Crypto API — no `jsonwebtoken` library (incompatible with Edge Runtime).

## Files Delivered
| File | Purpose |
|------|---------|
| `src/lib/auth/checkout-token.ts` | `generateCheckoutToken()`, `iat` added to payload interface, failure reason logging |
| `src/middleware.ts` | JWT validation on `/checkout/[token]`, redirect to `/checkout/expired`, claim header forwarding |

## Acceptance Criteria Checklist

### Token Generation
- [x] `generateCheckoutToken(orderId, patientId, clinicId)` exported (line 85)
- [x] Uses Web Crypto API — `crypto.subtle.importKey` + `crypto.subtle.sign` (lines 93-115) — Edge Runtime compatible
- [x] Signs with `JWT_SECRET` via `serverEnv.jwtSecret()` (line 90)
- [x] Algorithm: HMAC-SHA256 (line 96)
- [x] `iat` = current Unix timestamp (line 107)
- [x] `exp` = `iat + ttl` where ttl reads `CHECKOUT_TOKEN_EXPIRY` env var, defaults to 259200 (72h) (lines 102, 108)
- [x] Returns standard `header.payload.signature` JWT string

### CheckoutTokenPayload Interface
- [x] `orderId: string` (line 12)
- [x] `patientId: string` (line 13)
- [x] `clinicId: string` (line 14)
- [x] `iat: number` (line 15) — added in WO-13
- [x] `exp: number` (line 16)

### Token Verification (pre-existing, enhanced in WO-13)
- [x] `verifyCheckoutToken(token)` exported (line 22)
- [x] Returns decoded payload on success, `null` on failure
- [x] Checks `payload.exp < Date.now() / 1000` — expired tokens return null with warning log (lines 35-38)
- [x] Verifies HMAC-SHA256 signature with `crypto.subtle.verify` (line 56)
- [x] Invalid signature: `console.warn` with reason `'invalid signature'` (lines 58-60)
- [x] Malformed token (exception): `console.warn` with reason `'malformed token'` (lines 62-65)

### Edge Middleware
- [x] `/checkout/[token]` intercepted before page render (lines 15-37 in middleware.ts)
- [x] `/checkout` base path passes through (tokenSegment is undefined)
- [x] `/checkout/expired` passes through (tokenSegment === 'expired')
- [x] Invalid/expired token → redirect to `/checkout/expired` (line 24)
- [x] Valid token → `NextResponse.next()` with claim headers attached (lines 29-33):
  - `x-checkout-order-id`
  - `x-checkout-patient-id`
  - `x-checkout-clinic-id`

## Notable Design Decision
WO-13 spec referenced `jsonwebtoken` library. Implementation uses Web Crypto API instead — consistent with the WO-6 Edge Runtime fix that replaced all `Buffer.from()` calls. `jsonwebtoken` has no Edge Runtime support; Web Crypto is the correct approach for Vercel Edge Middleware.

## Commit
`394786e` — feat: WO-13 - JWT token generation & validation for checkout links
