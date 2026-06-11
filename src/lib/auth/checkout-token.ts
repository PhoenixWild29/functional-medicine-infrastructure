import { serverEnv } from '@/lib/env'

// Decode a base64url string to a Uint8Array using pure Web APIs (no Node.js Buffer).
function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

/**
 * Patient checkout JWT payload.
 *
 * Two flavors:
 *   SOLO   : { orderId,  patientId, clinicId, iat, exp }
 *   GROUP  : { groupId,  patientId, clinicId, iat, exp }   (Phase C)
 *
 * Exactly one of `orderId` / `groupId` is present per token. The middleware
 * forwards the present one to downstream components via either
 * x-checkout-order-id or x-checkout-group-id request header.
 */
export interface CheckoutTokenPayload {
  /** Solo-order checkout (existing flow). Mutually exclusive with groupId. */
  orderId?: string
  /** Group checkout (Phase C). Mutually exclusive with orderId. */
  groupId?: string
  patientId: string
  clinicId: string
  iat: number
  exp: number
}

// Verify a checkout JWT token.
// Returns the payload if valid, null if expired or invalid.
// Uses Web Crypto API (Edge runtime compatible).
export async function verifyCheckoutToken(
  token: string
): Promise<CheckoutTokenPayload | null> {
  try {
    const [headerB64, payloadB64, signatureB64] = token.split('.')

    if (!headerB64 || !payloadB64 || !signatureB64) return null

    const payload = JSON.parse(
      new TextDecoder().decode(base64urlToBytes(payloadB64))
    ) as CheckoutTokenPayload

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      console.warn('[checkout-token] verifyCheckoutToken failed: expired', { orderId: payload.orderId, groupId: payload.groupId })
      return null
    }

    // Codex 2026-06-11 sweep [MEDIUM]: enforce orderId XOR groupId at verify
    // time. The public factories never produce both, but tightening at the
    // verify layer makes the invariant explicit + catches any future bug
    // (or hand-forged token) that would otherwise let middleware forward
    // both x-checkout-order-id AND x-checkout-group-id headers.
    const hasOrderId = typeof payload.orderId === 'string' && payload.orderId.length > 0
    const hasGroupId = typeof payload.groupId === 'string' && payload.groupId.length > 0
    if (hasOrderId === hasGroupId) {
      // Either both absent (neither) or both present (XOR violation).
      console.warn('[checkout-token] verifyCheckoutToken failed: must have exactly one of orderId or groupId', {
        hasOrderId, hasGroupId,
      })
      return null
    }

    // Verify signature using HMAC-SHA256
    const secret = serverEnv.jwtSecret()
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const data = encoder.encode(`${headerB64}.${payloadB64}`)
    const signature = base64urlToBytes(signatureB64)

    const valid = await crypto.subtle.verify('HMAC', cryptoKey, signature as BufferSource, data)

    if (!valid) {
      console.warn('[checkout-token] verifyCheckoutToken failed: invalid signature')
    }
    return valid ? payload : null
  } catch (err) {
    console.warn('[checkout-token] verifyCheckoutToken failed: malformed token', err)
    return null
  }
}

// ============================================================
// GENERATE CHECKOUT TOKEN
// ============================================================
// Creates a signed HS256 JWT for patient checkout links.
// Uses Web Crypto API — Edge Runtime compatible (no Node.js Buffer).
//
// Token lifetime: CHECKOUT_TOKEN_EXPIRY env var, default 72 hours.
// Matches the PAYMENT_EXPIRY SLA window.

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function generateCheckoutToken(
  orderId: string,
  patientId: string,
  clinicId: string
): Promise<string> {
  return generateCheckoutTokenInternal({ orderId, patientId, clinicId })
}

/**
 * Phase C: generate a checkout token for a payment_group instead of a
 * single order. The patient checkout page recognizes either kind.
 */
export async function generateGroupCheckoutToken(
  groupId: string,
  patientId: string,
  clinicId: string,
): Promise<string> {
  return generateCheckoutTokenInternal({ groupId, patientId, clinicId })
}

async function generateCheckoutTokenInternal(
  fields: { orderId?: string; groupId?: string; patientId: string; clinicId: string },
): Promise<string> {
  const secret = serverEnv.jwtSecret()
  const encoder = new TextEncoder()

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const now = Math.floor(Date.now() / 1000)
  const ttl = serverEnv.checkoutTokenExpiry()
  const payload: CheckoutTokenPayload = {
    ...(fields.orderId ? { orderId: fields.orderId } : {}),
    ...(fields.groupId ? { groupId: fields.groupId } : {}),
    patientId: fields.patientId,
    clinicId:  fields.clinicId,
    iat: now,
    exp: now + ttl,
  }

  const headerB64 = bytesToBase64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payloadB64 = bytesToBase64url(encoder.encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signingInput))
  const signatureB64 = bytesToBase64url(new Uint8Array(signatureBuffer))

  return `${signingInput}.${signatureB64}`
}
