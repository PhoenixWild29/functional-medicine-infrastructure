import { serverEnv } from '@/lib/env'

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
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
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
    const signature = Buffer.from(signatureB64, 'base64url')

    const valid = await crypto.subtle.verify('HMAC', cryptoKey, signature, data)

    return valid ? payload : null
  } catch {
    return null
  }
}
