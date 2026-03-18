import { serverEnv } from '@/lib/env'

// Decode a base64url string to a Uint8Array using pure Web APIs (no Node.js Buffer).
function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, c => c.charCodeAt(0))
}

export interface CheckoutTokenPayload {
  orderId: string
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
      console.warn('[checkout-token] verifyCheckoutToken failed: expired', { orderId: payload.orderId })
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

    const valid = await crypto.subtle.verify('HMAC', cryptoKey, signature, data)

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
  const ttl = parseInt(process.env.CHECKOUT_TOKEN_EXPIRY ?? '259200', 10) // 72h default
  const payload: CheckoutTokenPayload = {
    orderId,
    patientId,
    clinicId,
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
