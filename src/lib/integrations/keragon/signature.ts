// ============================================================
// Keragon inbound webhook: request signature (HMAC-SHA256)
// ============================================================
//
// Every request to POST /api/integrations/keragon/patients carries:
//
//   x-compoundiq-connection  the clinic's connection id (not a secret)
//   x-compoundiq-timestamp   unix time in seconds when it was signed
//   x-compoundiq-signature   v1=<hex HMAC-SHA256>
//
// The HMAC key is the clinic's shared secret; the message is
//   `${timestamp}.${rawBody}`
// (the raw body bytes exactly as sent, before any JSON parsing). Signing
// the timestamp with the body means a captured request cannot be replayed
// later with a fresh timestamp. A timestamp more than 5 minutes from our
// clock is stale. The compare is constant-time.
//
// See docs/integrations/keragon.md. Server only (node:crypto).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER  = 'x-compoundiq-signature'
export const TIMESTAMP_HEADER  = 'x-compoundiq-timestamp'
export const CONNECTION_HEADER = 'x-compoundiq-connection'
export const MAX_SKEW_SECONDS  = 5 * 60
const SECRET_PREFIX = 'kgn_whsec_'

/** A new shared secret: 32 random bytes, base64url, with a recognisable prefix. */
export function newSharedSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`
}

/** The v1 signature value for a request (what Keragon must send). */
export function signRequest(secret: string, timestamp: string | number, rawBody: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  return `v1=${mac}`
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' }

export function verifySignature(args: {
  secret:    string
  timestamp: string | null
  signature: string | null
  rawBody:   string
  nowMs?:    number
}): SignatureCheck {
  const { secret, timestamp, signature, rawBody } = args
  if (!timestamp || !signature) return { ok: false, reason: 'missing' }
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'malformed' }
  const sent = signature.trim().match(/^v1=([0-9a-f]{64})$/i)
  if (!sent) return { ok: false, reason: 'malformed' }

  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000)
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: 'stale' }

  const expected = Buffer.from(signRequest(secret, timestamp, rawBody).slice(3), 'hex')
  const given = Buffer.from(sent[1]!.toLowerCase(), 'hex')
  // Both are 32 bytes (the regex pins 64 hex characters); timingSafeEqual
  // needs equal lengths and compares in constant time.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'mismatch' }
  return { ok: true }
}
