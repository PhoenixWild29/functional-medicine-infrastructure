/**
 * @jest-environment node
 *
 * Pharmacy payables (ops_admin only, getUser(); service-role writes):
 *   - POST /api/ops/payables/mark: mark lines paid (reference + date) or
 *     scheduled; only owed / scheduled lines change; each change is
 *     audit-logged in payable_events
 *   - GET /api/ops/payables/remittance: CSV per pharmacy and date range,
 *     IDs and amounts only (no patient data)
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

const PHARM = 'f0000000-0000-4000-8000-000000000001'
const P1 = '10000000-0000-4000-8000-000000000001'
const P2 = '10000000-0000-4000-8000-000000000002'
const OPS = { id: 'ops-1', email: 'ops@compoundiq.test', app_metadata: { app_role: 'ops_admin' } }

let user: unknown = OPS
let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { POST as mark } from '../mark/route'
import { GET as remittance } from '../remittance/route'

const post = (body: unknown) => new NextRequest('http://localhost/api/ops/payables/mark', { method: 'POST', body: JSON.stringify(body) })
const get = (qs: string) => new NextRequest(`http://localhost/api/ops/payables/remittance?${qs}`)

const happy: Script = call => {
  if (call.table === 'pharmacy_payables' && call.op === 'update') return { data: [{ payable_id: P1 }, { payable_id: P2 }] }
  return undefined
}

beforeEach(() => {
  user = OPS
  db = scriptedDb(happy)
})

describe('who may use payables', () => {
  it('an unverified caller is 401', async () => {
    user = null
    expect((await mark(post({ payableIds: [P1], action: 'mark_paid', reference: 'ACH-1', paidOn: '2026-10-09' }))).status).toBe(401)
    expect((await remittance(get(`pharmacyId=${PHARM}&from=2026-10-01&to=2026-10-31`))).status).toBe(401)
  })

  it.each(['clinic_admin', 'provider', 'medical_assistant', 'pharmacy_admin'])('%s is 403', async role => {
    user = { id: 'u', app_metadata: { app_role: role, clinic_id: 'c' } }
    expect((await mark(post({ payableIds: [P1], action: 'mark_paid', reference: 'ACH-1', paidOn: '2026-10-09' }))).status).toBe(403)
    expect((await remittance(get(`pharmacyId=${PHARM}&from=2026-10-01&to=2026-10-31`))).status).toBe(403)
    expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
  })
})

describe('POST /api/ops/payables/mark', () => {
  it('marks owed / scheduled lines paid with the reference and date, and logs each one', async () => {
    const res = await mark(post({ payableIds: [P1, P2], action: 'mark_paid', reference: ' ACH-20261009-01 ', paidOn: '2026-10-09' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(expect.objectContaining({ updated: 2 }))
    const [upd] = db.to('pharmacy_payables', 'update')
    expect(upd!.payload).toEqual(expect.objectContaining({ status: 'paid', paid_reference: 'ACH-20261009-01', paid_on: '2026-10-09', paid_by: 'ops-1' }))
    expect(upd!.filters).toEqual(expect.objectContaining({ 'payable_id:in': [P1, P2], 'status:in': ['owed', 'scheduled'] }))
    const events = db.to('payable_events', 'insert').flatMap(c => c.payload as Array<Record<string, unknown>>)
    expect(events).toEqual([
      expect.objectContaining({ payable_id: P1, action: 'marked_paid', actor_user_id: 'ops-1', reference: 'ACH-20261009-01', paid_on: '2026-10-09' }),
      expect.objectContaining({ payable_id: P2, action: 'marked_paid' }),
    ])
  })

  it('marks lines scheduled (no reference needed)', async () => {
    const res = await mark(post({ payableIds: [P1], action: 'mark_scheduled' }))
    expect(res.status).toBe(200)
    expect(db.to('pharmacy_payables', 'update')[0]!.payload).toEqual(expect.objectContaining({ status: 'scheduled' }))
    expect(db.to('pharmacy_payables', 'update')[0]!.filters['status:in']).toEqual(['owed'])
  })

  it.each([
    [{ payableIds: [], action: 'mark_paid', reference: 'R', paidOn: '2026-10-09' }],
    [{ payableIds: ['nope'], action: 'mark_paid', reference: 'R', paidOn: '2026-10-09' }],
    [{ payableIds: [P1], action: 'mark_paid', reference: ' ', paidOn: '2026-10-09' }],
    [{ payableIds: [P1], action: 'mark_paid', reference: 'R', paidOn: '2026-13-40' }],
    [{ payableIds: [P1], action: 'void' }],
  ])('refuses %j', async body => {
    expect((await mark(post(body))).status).toBe(400)
    expect(db.to('pharmacy_payables', 'update')).toEqual([])
  })
})

describe('GET /api/ops/payables/remittance', () => {
  it('returns a CSV of the pharmacy’s paid lines in the date range, IDs and amounts only', async () => {
    db = scriptedDb(call => (call.table === 'pharmacy_payables' && call.op === 'select'
      ? { data: [{
          payable_id: P1, order_id: 'a0000000-0000-4000-8000-000000000001', payment_group_id: null, status: 'paid',
          wholesale_cents: 10000, shipping_cents: 900, amount_cents: 10900, reversed_cents: 0,
          paid_on: '2026-10-09', paid_reference: 'ACH-1', created_at: '2026-10-02T10:00:00Z', orders: { order_number: 'ORD-1001' },
        }] }
      : call.table === 'pharmacies' ? { data: { name: 'Strive Pharmacy' } } : undefined))
    const res = await remittance(get(`pharmacyId=${PHARM}&from=2026-10-01&to=2026-10-31`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="remittance-.*2026-10-01_2026-10-31\.csv"/)
    const csv = await res.text()
    const [header, row] = csv.trim().split('\n')
    expect(header).toBe('payable_id,order_number,order_id,payment_group_id,status,wholesale,shipping,reversed,net,paid_on,paid_reference,accrued_on')
    expect(row).toBe(`${P1},ORD-1001,a0000000-0000-4000-8000-000000000001,,paid,100.00,9.00,0.00,109.00,2026-10-09,ACH-1,2026-10-02`)
    expect(csv).not.toMatch(/patient|first_name|last_name|dob/i)
    const [q] = db.to('pharmacy_payables', 'select')
    expect(q!.filters).toEqual(expect.objectContaining({ pharmacy_id: PHARM, status: 'paid', 'paid_on:gte': '2026-10-01', 'paid_on:lte': '2026-10-31' }))
  })

  it('basis=accrued lists every line created in the range', async () => {
    await remittance(get(`pharmacyId=${PHARM}&from=2026-10-01&to=2026-10-31&basis=accrued`))
    const [q] = db.to('pharmacy_payables', 'select')
    expect(q!.filters['status']).toBeUndefined()
    expect(q!.filters['created_at:gte']).toBe('2026-10-01T00:00:00.000Z')
    expect(q!.filters['created_at:lt']).toBe('2026-11-01T00:00:00.000Z')
  })

  it('a value that would start a spreadsheet formula is neutralised', async () => {
    db = scriptedDb(call => (call.table === 'pharmacy_payables' && call.op === 'select'
      ? { data: [{ payable_id: P1, order_id: 'o', payment_group_id: null, status: 'paid', wholesale_cents: 1, shipping_cents: 0, amount_cents: 1, reversed_cents: 0, paid_on: '2026-10-09', paid_reference: '=HYPERLINK("x")', created_at: '2026-10-02T00:00:00Z', orders: null }] }
      : undefined))
    const csv = await (await remittance(get(`pharmacyId=${PHARM}&from=2026-10-01&to=2026-10-31`))).text()
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
  })

  it.each(['', 'pharmacyId=nope&from=2026-10-01&to=2026-10-31', `pharmacyId=${PHARM}&from=2026-10-31&to=2026-10-01`, `pharmacyId=${PHARM}&from=x&to=2026-10-01`])('refuses %s', async qs => {
    expect((await remittance(get(qs))).status).toBe(400)
  })
})
