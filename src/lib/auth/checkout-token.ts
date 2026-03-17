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

    return valid ? payload : null
  } catch {
    return null
  }
}
