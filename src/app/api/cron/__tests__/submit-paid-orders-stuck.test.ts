/**
 * @jest-environment node
 *
 * #190 wiring: the 5-minute submit-paid-orders run also sweeps for orders
 * stuck in PAID_PROCESSING (> 24h, past what it retries) or
 * REROUTE_PENDING (past the reroute timeout) and alerts ops. A sweep that
 * fails never fails the run.
 */

import type { NextRequest } from 'next/server'
import { scriptedDb } from '@/__tests__/helpers/scripted-db'

const db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/adapters/routing-engine', () => ({ routeOrder: jest.fn() }))
jest.mock('@/lib/slack/client', () => ({ sendSlackAlert: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/orders/stuck-orders', () => ({ alertStuckOrders: jest.fn() }))

import { GET } from '../submit-paid-orders/route'
const { alertStuckOrders } = jest.requireMock('@/lib/orders/stuck-orders') as { alertStuckOrders: jest.Mock }

const call = () => GET({ headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? 'Bearer cron-secret' : null) } } as unknown as NextRequest)

beforeEach(() => {
  process.env['CRON_SECRET'] = 'cron-secret'
  process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true'
  alertStuckOrders.mockReset().mockResolvedValue({ alerted: ['o-stuck'], errors: [] })
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('runs the stuck-order sweep and reports what it alerted', async () => {
  const res = await call()
  expect(res.status).toBe(200)
  expect(alertStuckOrders).toHaveBeenCalledWith(db.client, expect.any(Number))
  expect(await res.json()).toEqual(expect.objectContaining({ stuck_alerted: 1 }))
})

it('a sweep that throws is logged; the run still answers 200', async () => {
  alertStuckOrders.mockRejectedValue(new Error('boom'))
  const res = await call()
  expect(res.status).toBe(200)
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('stuck'), expect.anything())
})
