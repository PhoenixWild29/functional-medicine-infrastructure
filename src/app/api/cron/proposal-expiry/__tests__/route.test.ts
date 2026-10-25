/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 4: GET /api/cron/proposal-expiry. Runs
 * expireProposals (lib/proposals/expire) behind cronAuthFailure, like the
 * other crons, and is registered in vercel.json.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ service: true }) }))
const expireMock = jest.fn()
jest.mock('@/lib/proposals/expire', () => ({ expireProposals: (...a: unknown[]) => expireMock(...a) }))

import { GET } from '../route'

const req = (auth?: string) => ({ headers: new Headers(auth ? { authorization: auth } : {}) }) as never

beforeEach(() => {
  process.env['CRON_SECRET'] = 'shh'
  expireMock.mockReset().mockResolvedValue({ expired: 2, cancelledOrders: 3, failed: 0 })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => { delete process.env['CRON_SECRET']; jest.restoreAllMocks() })

it('the right secret: runs and reports counts only', async () => {
  const res = await GET(req('Bearer shh'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ expired: 2, cancelledOrders: 3, failed: 0 })
  expect(expireMock).toHaveBeenCalledWith({ service: true }, expect.any(Date))
})

it('a wrong or missing secret: 401, nothing runs', async () => {
  expect((await GET(req('Bearer nope'))).status).toBe(401)
  expect((await GET(req())).status).toBe(401)
  expect(expireMock).not.toHaveBeenCalled()
})

it('a failed read is a 500, not a quiet success', async () => {
  expireMock.mockRejectedValue(new Error('proposals could not be read'))
  expect((await GET(req('Bearer shh'))).status).toBe(500)
})

it('registered in vercel.json, with its function settings', () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { crons: Array<{ path: string; schedule: string }>; functions: Record<string, unknown> }
  expect(vercel.crons).toContainEqual({ path: '/api/cron/proposal-expiry', schedule: '20 * * * *' })
  expect(vercel.functions['src/app/api/cron/proposal-expiry/route.ts']).toBeDefined()
})
