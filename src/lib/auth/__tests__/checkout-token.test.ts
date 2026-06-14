/**
 * @jest-environment node
 *
 * Tests for verifyCheckoutToken's orderId XOR groupId invariant
 * (Codex 2026-06-11 sweep [MEDIUM]).
 */

import { verifyCheckoutToken, generateCheckoutToken, generateGroupCheckoutToken } from '../checkout-token'

jest.mock('@/lib/env', () => ({
  serverEnv: {
    jwtSecret:           () => 'test-secret-do-not-use-in-prod-32chars',
    checkoutTokenExpiry: () => 60 * 60,
  },
}))

const ORDER_ID  = '11111111-1111-4111-9111-111111111111'
const GROUP_ID  = 'cccccccc-cccc-4ccc-9ccc-cccccccccccc'
const PATIENT_ID = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb'
const CLINIC_ID  = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'

describe('verifyCheckoutToken — orderId XOR groupId invariant', () => {
  test('accepts a valid solo token (only orderId set)', async () => {
    const token = await generateCheckoutToken(ORDER_ID, PATIENT_ID, CLINIC_ID)
    const payload = await verifyCheckoutToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.orderId).toBe(ORDER_ID)
    expect(payload?.groupId).toBeUndefined()
  })

  test('accepts a valid group token (only groupId set)', async () => {
    const token = await generateGroupCheckoutToken(GROUP_ID, PATIENT_ID, CLINIC_ID)
    const payload = await verifyCheckoutToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.groupId).toBe(GROUP_ID)
    expect(payload?.orderId).toBeUndefined()
  })

  test('rejects a hand-forged token with BOTH orderId AND groupId', async () => {
    const forged = await forgeToken({
      orderId: ORDER_ID,
      groupId: GROUP_ID,
      patientId: PATIENT_ID,
      clinicId: CLINIC_ID,
      iat: nowSec(),
      exp: nowSec() + 3600,
    })
    const payload = await verifyCheckoutToken(forged)
    expect(payload).toBeNull()
  })

  test('rejects a hand-forged token with NEITHER orderId NOR groupId', async () => {
    const forged = await forgeToken({
      patientId: PATIENT_ID,
      clinicId: CLINIC_ID,
      iat: nowSec(),
      exp: nowSec() + 3600,
    })
    const payload = await verifyCheckoutToken(forged)
    expect(payload).toBeNull()
  })

  test('rejects a token whose orderId is empty-string', async () => {
    const forged = await forgeToken({
      orderId: '',
      patientId: PATIENT_ID,
      clinicId: CLINIC_ID,
      iat: nowSec(),
      exp: nowSec() + 3600,
    })
    const payload = await verifyCheckoutToken(forged)
    expect(payload).toBeNull()
  })

  test('rejects an expired token (regression — XOR check must come AFTER expiry)', async () => {
    const forged = await forgeToken({
      orderId: ORDER_ID,
      patientId: PATIENT_ID,
      clinicId: CLINIC_ID,
      iat: nowSec() - 7200,
      exp: nowSec() - 3600,
    })
    const payload = await verifyCheckoutToken(forged)
    expect(payload).toBeNull()
  })

  test('rejects a token signed with the wrong secret', async () => {
    const forged = await forgeToken(
      { orderId: ORDER_ID, patientId: PATIENT_ID, clinicId: CLINIC_ID, iat: nowSec(), exp: nowSec() + 3600 },
      'wrong-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    )
    const payload = await verifyCheckoutToken(forged)
    expect(payload).toBeNull()
  })
})

// ── helpers ─────────────────────────────────────────────────────

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return Buffer.from(binary, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function forgeToken(payload: Record<string, unknown>, overrideSecret?: string): Promise<string> {
  const encoder = new TextEncoder()
  const secret = overrideSecret ?? 'test-secret-do-not-use-in-prod-32chars'
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const headerB64 = bytesToBase64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payloadB64 = bytesToBase64url(encoder.encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signingInput))
  const sigB64 = bytesToBase64url(new Uint8Array(sigBuffer))
  return `${signingInput}.${sigB64}`
}
