/**
 * @jest-environment node
 *
 * Security follow-ups 3: GET /api/orders/[orderId]/timeline-actors is used by the clinic app only
 * (the dashboard order drawer). Any other role (pharmacy_admin, ops_admin, patient) and a
 * session with a clinic_id but no role get 403 before anything is read;
 * the clinic staff roles still pass the gate.
 */

import { NextRequest } from 'next/server'
import { CLINIC, gate, setCaller, REFUSED, ALLOWED, serverModule, serviceModule, approvalModule } from '@/__tests__/helpers/staff-role-gate'

jest.mock('@/lib/supabase/server', () => ({ createServerClient: () => serverModule.createServerClient() }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceModule.createServiceClient() }))
jest.mock('@/lib/onboarding/approval-guard', () => ({ refuseUnlessApproved: () => approvalModule.refuseUnlessApproved() }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

import { GET } from '../route'

const GOOD_ID = 'a6000000-0000-0000-0000-000000000001'

describe('GET /api/orders/[orderId]/timeline-actors: clinic staff only', () => {
  it.each(REFUSED)('%s: 403 Forbidden, nothing read', async (_label, appMetadata) => {
    setCaller(appMetadata)
    const res = await GET(new NextRequest('https://app.test/x', { method: 'GET' }), { params: Promise.resolve({ orderId: GOOD_ID }) })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(gate.reads).toEqual([])
  })

  it.each(ALLOWED)('%s passes the gate (stops at the bad input, 400)', async role => {
    setCaller({ app_role: role, clinic_id: CLINIC })
    const res = await GET(new NextRequest('https://app.test/x', { method: 'GET' }), { params: Promise.resolve({ orderId: 'not-an-id' }) })
    expect(res.status).toBe(400)
  })
})
