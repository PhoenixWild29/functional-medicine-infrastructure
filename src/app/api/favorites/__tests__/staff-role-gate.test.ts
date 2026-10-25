/**
 * @jest-environment node
 *
 * Security follow-ups 3: GET, POST, PATCH and DELETE /api/favorites is used by the clinic app only
 * (the Quick Actions panel). Any other role (pharmacy_admin, ops_admin, patient) and a
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

import { GET, POST, PATCH, DELETE } from '../route'

describe('GET /api/favorites: clinic staff only', () => {
  it.each(REFUSED)('%s: 403 Forbidden, nothing read', async (_label, appMetadata) => {
    setCaller(appMetadata)
    const res = await GET(new NextRequest('https://app.test/api/favorites', { method: 'GET' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(gate.reads).toEqual([])
  })

  it.each(ALLOWED)('%s passes the gate (reaches the providers read)', async role => {
    setCaller({ app_role: role, clinic_id: CLINIC })
    // The harness's client throws on any read: reaching it is the pass.
    await GET(new NextRequest('https://app.test/api/favorites', { method: 'GET' })).catch(() => null)
    expect(gate.reads).toContain('service.from(providers)')
  })
})

describe('POST /api/favorites: clinic staff only', () => {
  it.each(REFUSED)('%s: 403 Forbidden, nothing read', async (_label, appMetadata) => {
    setCaller(appMetadata)
    const res = await POST(new NextRequest('https://app.test/api/favorites', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(gate.reads).toEqual([])
  })

  it.each(ALLOWED)('%s passes the gate (stops at the bad input, 400)', async role => {
    setCaller({ app_role: role, clinic_id: CLINIC })
    const res = await POST(new NextRequest('https://app.test/api/favorites', { method: 'POST', body: 'not json' }))
    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/favorites: clinic staff only', () => {
  it.each(REFUSED)('%s: 403 Forbidden, nothing read', async (_label, appMetadata) => {
    setCaller(appMetadata)
    const res = await PATCH(new NextRequest('https://app.test/api/favorites', { method: 'PATCH' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(gate.reads).toEqual([])
  })

  it.each(ALLOWED)('%s passes the gate (stops at the bad input, 400)', async role => {
    setCaller({ app_role: role, clinic_id: CLINIC })
    const res = await PATCH(new NextRequest('https://app.test/api/favorites', { method: 'PATCH' }))
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/favorites: clinic staff only', () => {
  it.each(REFUSED)('%s: 403 Forbidden, nothing read', async (_label, appMetadata) => {
    setCaller(appMetadata)
    const res = await DELETE(new NextRequest('https://app.test/api/favorites', { method: 'DELETE' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
    expect(gate.reads).toEqual([])
  })

  it.each(ALLOWED)('%s passes the gate (stops at the bad input, 400)', async role => {
    setCaller({ app_role: role, clinic_id: CLINIC })
    const res = await DELETE(new NextRequest('https://app.test/api/favorites', { method: 'DELETE' }))
    expect(res.status).toBe(400)
  })
})
