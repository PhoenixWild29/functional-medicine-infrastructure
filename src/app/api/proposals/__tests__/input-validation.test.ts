/**
 * @jest-environment node
 *
 * Input validation of POST /api/proposals: the ids in the body are checked
 * as ids before the proposal library reads or writes anything (a bad id
 * reaching Postgres is error 22P02, a 500). Missing or wrongly typed
 * fields keep the library's own messages.
 */

let user: { id: string; app_metadata: Record<string, unknown> } | null = null
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ service: true }) }))
jest.mock('@/lib/onboarding/approval-guard', () => ({ refuseUnlessApproved: async () => null }))
const createMock = jest.fn()
jest.mock('@/lib/proposals/propose', () => ({ createProposal: (...a: unknown[]) => createMock(...a) }))
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: jest.fn(async () => undefined) }))

import { POST } from '../route'

const CLINIC   = 'c0000000-0000-4000-8000-000000000001'
const PATIENT  = 'a4000000-0000-0000-0000-000000000001'
const PROVIDER = 'a2000000-0000-0000-0000-000000000001'
const PROTOCOL = 'a8000000-0000-0000-0000-000000000001'
const ORDER    = 'a9000000-0000-0000-0000-000000000001'

function req(body: unknown) {
  return new Request('https://app.test/api/proposals', {
    method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never
}
const plan = (over: Record<string, unknown> = {}, option: Record<string, unknown> = {}) => ({
  patientId: PATIENT, providerId: PROVIDER, send: true,
  options: [{ label: 'Foundation plan', protocolId: PROTOCOL, lines: [{ orderId: ORDER, required: true }], ...option }],
  ...over,
})

beforeEach(() => {
  user = { id: 'u-chen', app_metadata: { app_role: 'provider', clinic_id: CLINIC } }
  createMock.mockReset().mockResolvedValue({ ok: true, proposalId: 'x', status: 'sent', link: null })
})

it('a plan the review page sends (seeded, non-v4 ids) reaches the library', async () => {
  expect((await POST(req(plan()))).status).toBe(201)
  expect((await POST(req(plan({}, { protocolId: null })))).status).toBe(201)
  expect(createMock).toHaveBeenCalledTimes(2)
})

it.each([
  ['patientId', plan({ patientId: 'not-an-id' }), 'patientId'],
  ['providerId', plan({ providerId: "1' or 1=1" }), 'providerId'],
  ['an option protocolId', plan({}, { protocolId: 'proto-1' }), 'options.0.protocolId'],
])('a bad %s is 400 and nothing is read', async (_what, body, field) => {
  const res = await POST(req(body))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Invalid request', fields: [field] })
  expect(createMock).not.toHaveBeenCalled()
})

it('a missing id keeps the library message (the library answers)', async () => {
  createMock.mockResolvedValue({ ok: false, status: 400, error: 'patientId is required.' })
  const res = await POST(req(plan({ patientId: undefined })))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'patientId is required.' })
})

it('a body that is JSON null is answered by the library, never a 500', async () => {
  createMock.mockResolvedValue({ ok: false, status: 400, error: 'The plan could not be read.' })
  expect((await POST(req('null'))).status).toBe(400)
})

it('a role that is not clinic staff is 403 before the body is read', async () => {
  user = { id: 'u-x', app_metadata: { app_role: 'pharmacy_admin', clinic_id: CLINIC } }
  expect((await POST(req(plan({ patientId: 'bad' })))).status).toBe(403)
  expect(createMock).not.toHaveBeenCalled()
})
