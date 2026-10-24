/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 2: canSign, the read-only half of batch
 * sign. checkBatch is canSign as the signed-in user; propose asks it as
 * the provider on the lines (a clinic admin may send on their behalf),
 * so the C4 credentials checked are the prescriber's, not the caller's.
 * Same reads, same problems, same words.
 */

import { canSign, checkBatch } from '../batch-sign'
import { CHEN, CLINIC, PATEL, USER_CHEN, draft, id, world } from '@/lib/proposals/__tests__/world'

const resolveLineMock = jest.fn()
jest.mock('../resolve-line', () => ({ resolveLine: (...a: unknown[]) => resolveLineMock(...a) }))

beforeEach(() => {
  resolveLineMock.mockReset().mockResolvedValue({ ok: true, wholesaleCents: 10000 })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const lines = [draft(1), draft(2, { formulation_id: 'f-testo', medication_snapshot: { medication_name: 'Testosterone Cypionate', dea_schedule: 3 } }), draft(3, { retail_price_snapshot: 50 })]

it('as the provider: exactly what checkBatch finds for that provider signing', async () => {
  const asUser = await checkBatch(world(lines).client, { clinicId: CLINIC, userId: USER_CHEN, orderIds: [id(1), id(2), id(3)], atSigning: true })
  const asProvider = await canSign(world(lines).client, { clinicId: CLINIC, orderIds: [id(1), id(2), id(3)], as: { providerId: CHEN }, atSigning: true })
  expect(asProvider.problems).toEqual(asUser.problems)
  expect(asProvider.lines).toEqual(asUser.lines)
  expect(asProvider.signer).toEqual(asUser.signer)
  expect(asProvider.problems.map(p => p.code)).toEqual(['controlled_substance', 'below_cost'])
})

it('checkBatch is canSign as the user', async () => {
  const a = await checkBatch(world(lines).client, { clinicId: CLINIC, userId: USER_CHEN, orderIds: [id(1)], atSigning: false })
  const b = await canSign(world(lines).client, { clinicId: CLINIC, orderIds: [id(1)], as: { userId: USER_CHEN }, atSigning: false })
  expect(b).toEqual(a)
})

it("the prescriber's credentials, not the caller's: another provider's lines are not theirs", async () => {
  const res = await canSign(world([draft(1, { provider_id: PATEL })]).client, { clinicId: CLINIC, orderIds: [id(1)], as: { providerId: CHEN }, atSigning: true })
  expect(res.problems).toEqual([expect.objectContaining({ orderId: id(1), code: 'not_signer' })])
})

it('a provider not active in the clinic: nothing can be sent', async () => {
  const res = await canSign(world([draft(1)]).client, { clinicId: CLINIC, orderIds: [id(1)], as: { providerId: 'p-gone' }, atSigning: true })
  expect(res).toMatchObject({ lines: [], signer: null, problems: [expect.objectContaining({ orderId: null, code: 'provider_unlinked' })] })
})

it('read only: canSign writes nothing', async () => {
  const db = world(lines)
  await canSign(db.client, { clinicId: CLINIC, orderIds: [id(1), id(2), id(3)], as: { providerId: CHEN }, atSigning: true })
  expect(db.writes).toHaveLength(0)
})
