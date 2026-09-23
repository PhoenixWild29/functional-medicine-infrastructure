// ============================================================
// RFC 6238 TOTP for E2E — independent of otplib
// ============================================================
//
// E2E computes the provider's current authenticator code itself, from the
// seeded secret, so a test of the app's TOTP check does not lean on the
// same library the app uses to perform it. SHA-1, 6 digits, 30 s — the
// authenticator-app defaults the app's secrets are enrolled with.

import { createHmac } from 'node:crypto'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').toUpperCase()
  let bits = ''
  for (const ch of clean) {
    const v = BASE32.indexOf(ch)
    if (v < 0) throw new Error(`Invalid base32 character: ${ch}`)
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** The 6-digit code for `secret` at `atMs` (default now). */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!
  return String(binary % 1_000_000).padStart(6, '0')
}

/** A 6-digit code that is NOT valid now, nor one step either side. */
export function wrongTotpCode(secret: string): string {
  const now = Date.now()
  const valid = new Set([-30_000, 0, 30_000].map(d => totpCode(secret, now + d)))
  for (let n = 0; n < 1_000_000; n++) {
    const candidate = String(n).padStart(6, '0')
    if (!valid.has(candidate)) return candidate
  }
  throw new Error('unreachable')
}
