/**
 * @jest-environment node
 *
 * Settings > Clinic Profile edits the practice details with the wizard's
 * own API (PUT /api/onboarding/practice), same fields and validation.
 *   - An approved clinic's admin can now save them (the wizard step was
 *     the only way in, and it closes at approval). A submitted clinic is
 *     still locked (409) until CompoundIQ responds.
 *   - Only the clinic admin (role from app_metadata, getUser()).
 *   - Who pays shipping is changed only when the request sends it: the
 *     Settings form does not, so it never overwrites the clinic's choice.
 */

import { NextRequest } from 'next/server'
import { scriptedDb, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const ADMIN  = { id: 'admin-1', email: 'lauren@sunrise.test', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }

let user: unknown = ADMIN
let db = scriptedDb(() => undefined)

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.spyOn(console, 'error').mockImplementation(() => {})

import { PUT } from '../practice/route'

const clinicWith = (status: string): Script => (call: ScriptedCall) =>
  call.table === 'clinics' && call.op === 'select' ? { data: { clinic_id: CLINIC, name: 'Sunrise', onboarding_status: status } } : undefined

const PRACTICE = {
  legalName: 'Sunrise Functional Medicine PLLC', dbaName: 'Sunrise Clinic', addressLine1: '100 Main St', addressLine2: '',
  city: 'Austin', state: 'TX', postalCode: '78701', phone: '512-555-0100', practiceNpi: '', taxIdLast4: '1234',
}
const put = (body: unknown) => new NextRequest('http://localhost/api/onboarding/practice', { method: 'PUT', body: JSON.stringify(body) })
const update = () => db.to('clinics', 'update')[0]?.payload as Record<string, unknown> | undefined

beforeEach(() => { user = ADMIN })

it('an approved clinic\'s admin saves the practice details, and the step is recorded complete', async () => {
  db = scriptedDb(clinicWith('approved'))
  const res = await PUT(put(PRACTICE))
  expect(res.status).toBe(200)
  expect(update()).toEqual(expect.objectContaining({ legal_name: 'Sunrise Functional Medicine PLLC', city: 'Austin', state: 'TX', tax_id_last4: '1234', contact_phone: '5125550100' }))
  expect(db.to('clinic_onboarding_steps', 'upsert')[0]!.payload).toEqual(expect.objectContaining({ step: 'practice', status: 'complete' }))
})

it('without absorbShipping in the request, who pays shipping is left as it is', async () => {
  db = scriptedDb(clinicWith('approved'))
  await PUT(put(PRACTICE))
  expect(update()).not.toHaveProperty('absorb_shipping')
})

it('the wizard still sends it, and it is saved', async () => {
  db = scriptedDb(clinicWith('in_progress'))
  await PUT(put({ ...PRACTICE, absorbShipping: true }))
  expect(update()).toEqual(expect.objectContaining({ absorb_shipping: true }))
})

it('a submitted clinic is still locked until CompoundIQ responds', async () => {
  db = scriptedDb(clinicWith('submitted'))
  expect((await PUT(put(PRACTICE))).status).toBe(409)
  expect(update()).toBeUndefined()
})

it.each(['provider', 'medical_assistant'])('%s cannot save them (403)', async role => {
  user = { id: 'u', app_metadata: { app_role: role, clinic_id: CLINIC } }
  db = scriptedDb(clinicWith('approved'))
  expect((await PUT(put(PRACTICE))).status).toBe(403)
  expect(update()).toBeUndefined()
})

it('the same validation: field errors come back', async () => {
  db = scriptedDb(clinicWith('approved'))
  const res = await PUT(put({ ...PRACTICE, postalCode: '7870', taxIdLast4: '123456789' }))
  expect(res.status).toBe(400)
  expect((await res.json()).errors).toEqual(expect.objectContaining({ postalCode: expect.any(String), taxIdLast4: expect.any(String) }))
})
