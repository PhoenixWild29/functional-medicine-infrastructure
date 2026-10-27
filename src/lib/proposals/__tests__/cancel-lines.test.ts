/**
 * @jest-environment node
 *
 * cancelDraftLines (B-2026-10-25-08): a plan's DRAFT lines are cancelled
 * one by one through casTransition, so the state machine's actor rules
 * hold for the proposal expiry cron (system), a cancel (the caller's role)
 * and a sign (the signer's role). A line that already left DRAFT is left
 * alone; a refused line does not stop the others, and is reported.
 */

import { fakeDb } from '@/lib/orders/__tests__/fake-db'
import { cancelDraftLines, clinicActorRole } from '../cancel-lines'

jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'error').mockImplementation(() => {})

const db = () => fakeDb({
  orders: [
    { order_id: 'o-1', status: 'DRAFT' },
    { order_id: 'o-2', status: 'DRAFT' },
    { order_id: 'o-3', status: 'AWAITING_PAYMENT' },
  ],
  order_status_history: [],
})
const status = (w: ReturnType<typeof db>, id: string) => (w.tables['orders'] as Array<Record<string, unknown>>).find(o => o['order_id'] === id)!['status']

it('maps clinic roles; anything else is not an actor', () => {
  expect(clinicActorRole('provider')).toBe('provider')
  expect(clinicActorRole('clinic_admin')).toBe('clinic_admin')
  expect(clinicActorRole('medical_assistant')).toBe('medical_assistant')
  expect(clinicActorRole('ops_admin')).toBeNull()
  expect(clinicActorRole(null)).toBeNull()
})

it('cancels each DRAFT line through casTransition and records one history row each', async () => {
  const w = db()
  const r = await cancelDraftLines(w.client, { orderIds: ['o-1', 'o-2', 'o-3', 'o-missing'], actor: 'system', actorRole: 'system', metadata: { reason: 'proposal_expired' } })
  expect(r).toEqual({ ok: true, cancelledOrderIds: ['o-1', 'o-2'] })
  expect(status(w, 'o-1')).toBe('CANCELLED')
  expect(status(w, 'o-3')).toBe('AWAITING_PAYMENT') // not a draft: the CAS is a no-op
  const history = w.tables['order_status_history'] as Array<Record<string, unknown>>
  expect(history.map(h => [h['order_id'], h['old_status'], h['new_status'], h['changed_by']])).toEqual([
    ['o-1', 'DRAFT', 'CANCELLED', 'system'],
    ['o-2', 'DRAFT', 'CANCELLED', 'system'],
  ])
  expect(history[0]!['metadata']).toEqual({ reason: 'proposal_expired' })
})

it('the state machine still decides: a medical assistant may not cancel a draft; nothing changes and it is reported', async () => {
  const w = db()
  const r = await cancelDraftLines(w.client, { orderIds: ['o-1', 'o-2'], actor: 'u-ma', actorRole: 'medical_assistant', metadata: {} })
  expect(r.ok).toBe(false)
  expect(r.cancelledOrderIds).toEqual([])
  if (!r.ok) expect(r.error).toMatch(/o-1: CAS: medical_assistant may not move order o-1 from DRAFT to CANCELLED/)
  expect(status(w, 'o-1')).toBe('DRAFT')
  expect(w.tables['order_status_history']).toHaveLength(0)
})
