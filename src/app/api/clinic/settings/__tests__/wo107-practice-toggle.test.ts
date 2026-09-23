/**
 * @jest-environment node
 *
 * WO-107: only the clinic admin decides who sees the practice dashboard.
 * A provider who could flip the toggle could grant themselves the clinic's
 * revenue and margin.
 */

import { PATCH } from '../route'
import type { NextRequest } from 'next/server'

const getSessionMock = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({ auth: { getSession: () => getSessionMock() } }),
}))
const updateMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ update: (u: unknown) => { updateMock(u); return { eq: () => ({ is: async () => ({ error: null }) }) } } }),
  }),
}))

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
function as(role: string) {
  getSessionMock.mockResolvedValue({ data: { session: { user: { id: 'u', user_metadata: { clinic_id: 'c1', app_role: role } } } } })
}

beforeEach(() => { updateMock.mockReset(); jest.spyOn(console, 'info').mockImplementation(() => {}) })
afterEach(() => { jest.restoreAllMocks() })

describe('PATCH /api/clinic/settings — practice_dashboard_visible_to_providers', () => {
  it('the clinic admin can turn it on', async () => {
    as('clinic_admin')
    expect((await PATCH(req({ practice_dashboard_visible_to_providers: true }))).status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith({ practice_dashboard_visible_to_providers: true })
  })

  it.each(['provider', 'medical_assistant'])('a %s cannot (403), and nothing is written', async role => {
    as(role)
    expect((await PATCH(req({ practice_dashboard_visible_to_providers: true }))).status).toBe(403)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('must be a boolean', async () => {
    as('clinic_admin')
    expect((await PATCH(req({ practice_dashboard_visible_to_providers: 'yes' }))).status).toBe(400)
  })
})
