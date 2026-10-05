/**
 * @jest-environment node
 *
 * Batch 3, PR 3: EPCS verify fails loud on a database error.
 *
 * Before, a failed read of the provider's secret answered 400 "TOTP not
 * set up" — telling the provider to enrol again — and a failed write of
 * totp_enabled still answered { verified: true }, so the client showed a
 * working authenticator that the database never recorded. Now both answer
 * 500 with a message that says nothing was saved, and never `verified`.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'
import { POST } from '../route'

let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
  }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('otplib', () => ({
  TOTP: class {},
  generateSecret: () => 'NEWSECRET',
  generateURI: () => 'otpauth://totp/x',
  verifySync: ({ token }: { token: string }) => (token === '123456' ? { valid: true, delta: 0 } : { valid: false }),
}))
jest.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,AAA' }))
jest.mock('@/lib/epcs/crypto', () => ({
  encryptSecret: (s: string) => `enc(${s})`,
  decryptSecret: (s: string) => s.replace(/^enc\(|\)$/g, ''),
}))

jest.spyOn(console, 'error').mockImplementation(() => {})

async function verify(script: Script) {
  db = scriptedDb(script)
  const res = await POST({
    url:  'https://app.test/api/epcs?action=verify',
    json: async () => ({ provider_id: 'pr-1', code: '123456' }),
  } as unknown as NextRequest)
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

describe('POST ?action=verify', () => {
  it('a failed secret read answers 500, not "TOTP not set up"', async () => {
    const { status, body } = await verify(c => (c.table === 'providers' && c.op === 'select' ? DB_DOWN : undefined))
    expect(status).toBe(500)
    expect(body['verified']).toBeUndefined()
    expect(String(body['error'])).not.toMatch(/not set up|connection reset/)
  })

  it('a failed totp_enabled write answers 500, never verified: true', async () => {
    const { status, body } = await verify(c => {
      if (c.table === 'providers' && c.op === 'select') return { data: { totp_secret_encrypted: 'enc(SECRET)' } }
      if (c.table === 'providers' && c.op === 'update') return DB_DOWN
      return undefined
    })
    expect(status).toBe(500)
    expect(body['verified']).not.toBe(true)
    expect(String(body['error'])).toMatch(/could not be saved/)
    expect(String(body['error'])).not.toMatch(/connection reset/)
  })

  it('a saved verification still answers verified: true', async () => {
    const { status, body } = await verify(c => (c.table === 'providers' && c.op === 'select' ? { data: { totp_secret_encrypted: 'enc(SECRET)' } } : undefined))
    expect(status).toBe(200)
    expect(body['verified']).toBe(true)
  })
})
