/**
 * @jest-environment node
 *
 * Patient protocol choice, PR 4: the sign page and plans.
 *
 *   - Ordinary mode (?orders=): a plan's drafts are never listed, so an
 *     item the patient did not choose can never be signed from here.
 *   - Plan mode (?proposal=<id>): exactly the chosen lines, all
 *     pre-selected, with the summary, for the plan's provider only.
 */

import type { ReactElement, ReactNode } from 'react'
import { scriptedDb, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { BatchSignForm } from '../_components/batch-sign-form'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const PATIENT = 'a3000000-0000-0000-0000-000000000001'
const PROPOSAL = 'b0000000-0000-4000-8000-000000000001'
const o = (n: number) => `d1000000-0000-4000-8000-00000000000${n}`

let user: unknown = null
let db = scriptedDb(() => undefined)
let providerId = 'pr-1'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }) }))
jest.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/orders/apply-bundle-shipping', () => ({ loadShippingRates: async () => new Map() }))
jest.mock('@/lib/audit/phi-access', () => ({ logPhiAccess: async () => undefined, currentRequestHeaders: async () => null }))

const line = (n: number, over: Record<string, unknown> = {}) => ({
  order_id: o(n), status: 'DRAFT', patient_id: PATIENT, provider_id: 'pr-1', pharmacy_id: 'ph-1', created_at: `2026-10-2${n}T00:00:00Z`,
  medication_snapshot: { medication_name: `Compound ${n}` }, pharmacy_snapshot: { name: 'Strive' }, ...over,
})

const script: Script = (c: ScriptedCall) => {
  if (c.table === 'providers') return { data: { provider_id: providerId, clinic_id: CLINIC, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null } }
  if (c.table === 'patients') return { data: [{ patient_id: PATIENT, first_name: 'Jordan', last_name: 'Lee', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX' }] }
  if (c.table === 'clinics') return { data: { absorb_shipping: false } }
  if (c.table === 'treatment_proposals') return { data: [{ proposal_id: PROPOSAL, clinic_id: CLINIC, patient_id: PATIENT, provider_id: 'pr-1', chosen_option_id: 'opt-a', chosen_at: '2026-10-25T00:00:00Z' }] }
  if (c.table === 'treatment_proposal_options') return { data: [{ option_id: 'opt-a', proposal_id: PROPOSAL, label: 'Foundation plan', position: 1, protocol_id: null }] }
  if (c.table === 'proposal_choice_items') return { data: [{ proposal_id: PROPOSAL, option_id: 'opt-a', order_id: o(3), choice_no: 1 }] }
  if (c.table === 'orders') {
    // The plan's lines (read by option), the requested rows, the drafts.
    if ('proposal_option_id:in' in c.filters) {
      return { data: [
        { order_id: o(1), status: 'DRAFT', proposal_option_id: 'opt-a', proposal_required: true },
        { order_id: o(2), status: 'DRAFT', proposal_option_id: 'opt-a', proposal_required: false },
        { order_id: o(3), status: 'DRAFT', proposal_option_id: 'opt-a', proposal_required: false },
      ] }
    }
    const ids = c.filters['order_id:in'] as string[] | undefined
    const all = [line(1), line(2), line(3), line(4)]
    return { data: ids ? all.filter(r => ids.includes(r.order_id)) : all }
  }
  return undefined
}

const PROVIDER_USER = { id: 'user-1', app_metadata: { clinic_id: CLINIC, app_role: 'provider' } }

beforeEach(() => {
  db = scriptedDb(script)
  providerId = 'pr-1'
  user = PROVIDER_USER
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

function findForm(node: ReactNode): ReactElement<React.ComponentProps<typeof BatchSignForm>> | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) { const f = findForm(n); if (f) return f }
    return null
  }
  const el = node as ReactElement<{ children?: ReactNode }>
  if (el.type === BatchSignForm) return el as ReactElement<React.ComponentProps<typeof BatchSignForm>>
  return findForm(el.props?.children)
}
const draftsQuery = () => db.to('orders', 'select').find(c => c.filters['status'] === 'DRAFT' && 'patient_id:in' in c.filters)!

async function render(params: Record<string, string>) {
  const { default: Page } = await import('../page')
  return Page({ searchParams: Promise.resolve(params) })
}

it("ordinary mode: a plan's drafts are left out of the list", async () => {
  await render({ orders: o(4) })
  expect(draftsQuery().filters['proposal_option_id:is']).toBeNull()
})

it('plan mode: exactly the chosen lines (required + kept), pre-selected, with the summary', async () => {
  const form = findForm(await render({ proposal: PROPOSAL }))
  expect(form).not.toBeNull()
  expect(draftsQuery().filters['order_id:in']).toEqual([o(1), o(3)])
  expect(form!.props.preselected).toEqual([o(1), o(3)])
  expect(form!.props.patients[0]!.lines.map(l => l.orderId)).toEqual([o(1), o(3)])
  expect(form!.props.proposal).toEqual({ proposalId: PROPOSAL, summary: 'Jordan chose Foundation plan (2 of 3 items)' })
})

it("plan mode: another provider's plan is not offered", async () => {
  providerId = 'pr-other'
  expect(findForm(await render({ proposal: PROPOSAL }))).toBeNull()
})

it('plan mode: a plan not waiting to be signed shows a notice', async () => {
  expect(findForm(await render({ proposal: 'b0000000-0000-4000-8000-00000000dead' }))).toBeNull()
})
