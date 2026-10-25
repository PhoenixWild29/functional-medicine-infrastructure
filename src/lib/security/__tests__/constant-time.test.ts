/**
 * @jest-environment node
 *
 * Security follow-up (C-2026-10-25-07, item 3): one constant-time compare
 * for every internal-token and cron-secret check. crypto.timingSafeEqual
 * on equal-length buffers; a length mismatch, a missing value or an empty
 * secret is false (never a throw, never a match).
 */

import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { safeEqual } from '../constant-time'

describe('safeEqual', () => {
  it('equal strings match', () => {
    expect(safeEqual('s3cret-token', 's3cret-token')).toBe(true)
  })
  it.each([
    ['different, same length', 's3cret-tokeN', 's3cret-token'],
    ['length mismatch (prefix)', 's3cret', 's3cret-token'],
    ['length mismatch (longer)', 's3cret-token-and-more', 's3cret-token'],
    ['missing given', null, 's3cret-token'],
    ['undefined given', undefined, 's3cret-token'],
    ['missing secret', 's3cret-token', undefined],
    ['empty secret', '', ''],
    ['multi-byte, same character count', 'é', 'e'],
  ])('%s: false', (_name, given, secret) => {
    expect(safeEqual(given as string | null | undefined, secret as string | null | undefined)).toBe(false)
  })
})

describe('every internal-token and cron-secret check uses safeEqual', () => {
  const ROOT = path.resolve(__dirname, '../../../..')
  it.each([
    'src/lib/cron/auth.ts',
    'src/app/api/adapters/route-order/route.ts',
    'src/app/api/adapters/submit/route.ts',
    'src/app/api/spec/v1/webhooks/register/route.ts',
  ])('%s', file => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
    expect(src).toMatch(/safeEqual\(/)
    expect(src).not.toMatch(/(!==|===)\s*process\.env/)
    expect(src).not.toMatch(/!==\s*`Bearer/)
  })
})

describe('cron auth, through safeEqual', () => {
  const OLD = process.env['CRON_SECRET']
  afterEach(() => { process.env['CRON_SECRET'] = OLD })
  const req = (auth?: string) => new NextRequest('https://app.test/api/cron/x', { headers: auth ? { authorization: auth } : {} })

  it('the right bearer passes; a wrong length, a wrong value or none is 401', async () => {
    process.env['CRON_SECRET'] = 'cron-secret-value'
    const { cronAuthFailure } = await import('@/lib/cron/auth')
    expect(cronAuthFailure(req('Bearer cron-secret-value'), 't')).toBeNull()
    expect(cronAuthFailure(req('Bearer cron-secret-valuX'), 't')?.status).toBe(401)
    expect(cronAuthFailure(req('Bearer cron'), 't')?.status).toBe(401)
    expect(cronAuthFailure(req(), 't')?.status).toBe(401)
  })
})
