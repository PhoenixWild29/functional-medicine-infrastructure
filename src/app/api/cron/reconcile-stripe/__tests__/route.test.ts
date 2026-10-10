/**
 * @jest-environment node
 *
 * GET /api/cron/reconcile-stripe — daily, shared cron auth. Reconciles
 * the previous UTC day (read-only against Stripe). Stripe is mocked.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'

const reconcileDayMock = jest.fn()
jest.mock('@/lib/payments/reconcile', () => ({ reconcileDay: (...a: unknown[]) => reconcileDayMock(...a) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
jest.mock('@/lib/stripe/client', () => ({ createStripeClient: () => ({ balanceTransactions: { list: jest.fn() } }) }))
jest.spyOn(console, 'error').mockImplementation(() => {})

import { GET } from '../route'

const req = (auth?: string) => new NextRequest('http://localhost/api/cron/reconcile-stripe', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  process.env['CRON_SECRET'] = 's3cret'
  reconcileDayMock.mockReset().mockResolvedValue({ status: 'matched', mismatchCount: 0 })
})

it('refuses without the cron secret, and fails closed when it is unset', async () => {
  expect((await GET(req())).status).toBe(401)
  expect((await GET(req('Bearer wrong'))).status).toBe(401)
  delete process.env['CRON_SECRET']
  expect((await GET(req('Bearer s3cret'))).status).toBe(500)
  expect(reconcileDayMock).not.toHaveBeenCalled()
})

it('reconciles the previous UTC day', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-10T06:00:00Z'))
  const res = await GET(req('Bearer s3cret'))
  jest.useRealTimers()
  expect(res.status).toBe(200)
  expect(reconcileDayMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), '2026-10-09')
})

it('a mismatch still answers 200 (recorded and alerted); an error answers 500', async () => {
  reconcileDayMock.mockResolvedValue({ status: 'mismatch', mismatchCount: 2 })
  expect((await GET(req('Bearer s3cret'))).status).toBe(200)
  reconcileDayMock.mockResolvedValue({ status: 'error', mismatchCount: 0 })
  expect((await GET(req('Bearer s3cret'))).status).toBe(500)
})

it('is scheduled daily in vercel.json', () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }> }
  const cron = vercel.crons.find(c => c.path === '/api/cron/reconcile-stripe')
  expect(cron).toBeDefined()
  expect(cron!.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/)
})
