/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 2: editing a proposed line turns its plan
 * link off. The patient must never choose from a plan that changed after
 * the checks ran; the provider sends a new link (which runs them again).
 * Editing (PATCH) or removing (DELETE) a draft that is not in a plan
 * touches no proposal.
 */

const user = { id: 'u-chen', app_metadata: { app_role: 'provider', clinic_id: 'c-1' } }
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }))
jest.mock('@/lib/onboarding/approval-guard', () => ({ refuseUnlessApproved: async () => null }))
jest.mock('@/lib/orders/provider-draft-guard', () => ({ checkProviderOwnsDraft: async () => ({ ok: true }) }))
jest.mock('@/lib/orders/draft-edit', () => ({ canEditDraft: async () => true, diffDraftRows: () => ({ sig_text: ['a', 'b'] }), writeDraftAudit: async () => undefined }))
jest.mock('@/lib/orders/apply-bundle-shipping', () => ({ reallocateDraftSiblingShipping: async () => undefined }))
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: async () => undefined }))
jest.mock('@/lib/orders/resolve-line', () => ({
  lineSourceKind: () => 'formulation',
  resolveLine: async () => ({ ok: true, wholesaleCents: 9500, medicationSnapshot: {}, pharmacySnapshot: {}, package: {} }),
}))
jest.mock('@/lib/orders/rx-details', () => ({
  ...jest.requireActual('@/lib/orders/rx-details'),
  validateRxDetailsBody: () => ({ ok: true, details: { dispenseQuantity: 1, dispenseUnit: 'vial' } }),
  rxDetailsToColumns: () => ({}),
}))
const revokeMock = jest.fn()
jest.mock('@/lib/proposals/propose', () => ({ revokeProposalLinkForOrder: (...a: unknown[]) => revokeMock(...a) }))

let draftRow: Record<string, unknown> = {}
const service = {
  from: () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'update']) q[m] = () => q
    q['maybeSingle'] = async () => ({ data: draftRow, error: null })
    q['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
    return q
  },
}
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => service }))

import { PATCH, DELETE } from '../route'

const ctx = { params: Promise.resolve({ orderId: 'o-1' }) }
const body = { formulationId: 'f-1', pharmacyId: 'ph-1', retailCents: 20000, sigText: 'Inject 10 units weekly' }
const request = () => ({ json: async () => body, headers: new Headers() }) as never
const draft = (over: Record<string, unknown> = {}) => ({
  order_id: 'o-1', status: 'DRAFT', clinic_id: 'c-1', patient_id: 'pat', provider_id: 'p-chen',
  shipping_state_snapshot: 'TX', payment_group_id: null, proposal_option_id: null, ...over,
})

beforeEach(() => {
  revokeMock.mockReset().mockResolvedValue(true)
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it.each([['PATCH', PATCH], ['DELETE', DELETE]] as const)('%s of a proposed line revokes its link', async (_verb, handler) => {
  draftRow = draft({ proposal_option_id: 'opt-1' })
  expect((await handler(request(), ctx)).status).toBe(200)
  expect(revokeMock).toHaveBeenCalledWith(service, { clinicId: 'c-1', orderId: 'o-1' })
})

it.each([['PATCH', PATCH], ['DELETE', DELETE]] as const)('%s of an ordinary draft touches no proposal', async (_verb, handler) => {
  draftRow = draft()
  expect((await handler(request(), ctx)).status).toBe(200)
  expect(revokeMock).not.toHaveBeenCalled()
})
