/**
 * @jest-environment node
 *
 * The clinic onboarding wizard APIs. Only the clinic admin of a clinic in
 * onboarding (getUser(), role and clinic from app_metadata) may write, and
 * only while the clinic is in progress or sent back; a submitted or
 * approved clinic is 409. Progress is stored server-side per step.
 */

import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { scriptedDb, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

const CLINIC   = '11111111-1111-4111-8111-111111111111'
const PROVIDER = '33333333-3333-4333-8333-333333333333'
const ADMIN    = { id: 'admin-1', email: 'lauren@sunrise.test', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } }

let user: unknown = ADMIN
let db = scriptedDb(() => undefined)
const runNpiCheckMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/env', () => ({ serverEnv: { appBaseUrl: () => 'https://app.test' } }))
jest.mock('@/lib/providers/verify-npi', () => ({ runNpiCheck: (...a: unknown[]) => runNpiCheckMock(...a) }))
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

import { PUT as savePractice } from '../practice/route'
import { POST as addProvider } from '../providers/route'
import { POST as inviteStaff } from '../staff/route'
import { POST as acceptAgreement } from '../agreements/route'
import { POST as completeStep } from '../steps/route'
import { POST as submit } from '../submit/route'
import { AGREEMENTS } from '@/lib/onboarding/agreements'

const req = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/onboarding/x', { method, body: JSON.stringify(body) })
const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex')

function clinicWith(status: string, extra?: (c: ScriptedCall) => ReturnType<Script>): Script {
  return call => {
    const answered = extra?.(call)
    if (answered) return answered
    if (call.table === 'clinics' && call.op === 'select') return { data: { clinic_id: CLINIC, name: 'Sunrise', onboarding_status: status, stripe_connect_status: 'PENDING' } }
    if (call.table === 'providers' && call.op === 'insert') return { data: { provider_id: PROVIDER, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567893' } }
    if (call.table === 'onboarding_invites' && call.op === 'insert') return { data: { invite_id: 'inv-1' } }
    return undefined
  }
}

const PRACTICE = {
  legalName: 'Sunrise Functional Medicine PLLC', dbaName: 'Sunrise Clinic', addressLine1: '100 Main St', addressLine2: '',
  city: 'Austin', state: 'TX', postalCode: '78701', phone: '512-555-0100', practiceNpi: '', taxIdLast4: '1234', absorbShipping: true,
}

beforeEach(() => {
  user = ADMIN
  db = scriptedDb(clinicWith('in_progress'))
  runNpiCheckMock.mockReset().mockResolvedValue({ ok: true, lookup: { status: 'verified' }, checkedAt: 'now' })
})

describe('who may use the wizard', () => {
  it.each(['provider', 'medical_assistant', 'ops_admin'])('%s is 403', async role => {
    user = { id: 'u', app_metadata: { app_role: role, clinic_id: CLINIC } }
    expect((await savePractice(req(PRACTICE, 'PUT'))).status).toBe(403)
    expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
  })

  it('an unverified caller is 401', async () => {
    user = null
    expect((await savePractice(req(PRACTICE, 'PUT'))).status).toBe(401)
  })

  it.each(['submitted', 'approved'])('a %s clinic cannot be edited (409)', async status => {
    db = scriptedDb(clinicWith(status))
    expect((await savePractice(req(PRACTICE, 'PUT'))).status).toBe(409)
    expect(db.calls.filter(c => c.op !== 'select')).toEqual([])
  })
})

describe('practice details', () => {
  it('saves the practice and marks the step complete', async () => {
    const res = await savePractice(req(PRACTICE, 'PUT'))
    expect(res.status).toBe(200)
    const [upd] = db.to('clinics', 'update')
    expect(upd!.payload).toEqual(expect.objectContaining({
      legal_name: 'Sunrise Functional Medicine PLLC', dba_name: 'Sunrise Clinic', address_line1: '100 Main St', address_line2: null,
      city: 'Austin', state: 'TX', postal_code: '78701', contact_phone: '5125550100', practice_npi: null, tax_id_last4: '1234', absorb_shipping: true,
    }))
    expect(upd!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC }))
    expect(db.to('clinic_onboarding_steps', 'upsert')[0]!.payload).toEqual(expect.objectContaining({ clinic_id: CLINIC, step: 'practice', status: 'complete', updated_by: 'admin-1' }))
  })

  it('never stores a whole tax ID', async () => {
    const res = await savePractice(req({ ...PRACTICE, taxIdLast4: '12-3456789' }, 'PUT'))
    expect(res.status).toBe(400)
    expect(db.to('clinics', 'update')).toEqual([])
  })
})

describe('providers', () => {
  const NEW = { firstName: 'Sarah', lastName: 'Chen', email: 'Dr.Chen@Sunrise.test', npiNumber: '1234567893', licenseState: 'tx', licenseNumber: 'Q1234', licenseExpiresOn: '2028-06-30' }

  it('adds the provider with their first state license, runs the NPI check, and invites them', async () => {
    const res = await addProvider(req(NEW))
    expect(res.status).toBe(201)
    const body = await res.json() as { link: string; providerId: string; npiStatus: string }
    expect(body.providerId).toBe(PROVIDER)
    expect(body.npiStatus).toBe('verified')
    const token = /\/onboard\/join\/([A-Za-z0-9_-]{40,})$/.exec(body.link)![1]!

    expect(db.to('providers', 'insert')[0]!.payload).toEqual(expect.objectContaining({
      clinic_id: CLINIC, user_id: null, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567893', license_state: 'TX', license_number: 'Q1234',
    }))
    expect(db.to('provider_state_licenses', 'upsert')[0]!.payload).toEqual(expect.objectContaining({
      provider_id: PROVIDER, state: 'TX', license_number: 'Q1234', expires_on: '2028-06-30', verified_by: 'admin-1',
    }))
    expect(runNpiCheckMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider_id: PROVIDER, npi_number: '1234567893' }), 'admin-1')
    expect(db.to('onboarding_invites', 'insert')[0]!.payload).toEqual(expect.objectContaining({
      kind: 'provider', clinic_id: CLINIC, provider_id: PROVIDER, email: 'dr.chen@sunrise.test', token_hash: createHash('sha256').update(token).digest('hex'),
    }))
  })

  it('refuses an NPI whose check digit is wrong', async () => {
    const res = await addProvider(req({ ...NEW, npiNumber: '1234567890' }))
    expect(res.status).toBe(400)
    expect(db.to('providers', 'insert')).toEqual([])
  })

  it('refuses an NPI already registered to a provider', async () => {
    db = scriptedDb(clinicWith('in_progress', c => (c.table === 'providers' && c.op === 'select' && c.filters['npi_number'] ? { data: { provider_id: 'other' } } : undefined)))
    expect((await addProvider(req(NEW))).status).toBe(409)
    expect(db.to('providers', 'insert')).toEqual([])
  })
})

describe('staff', () => {
  it('invites a medical assistant by email', async () => {
    const res = await inviteStaff(req({ email: ' MA@Sunrise.test ' }))
    expect(res.status).toBe(201)
    const { link } = await res.json() as { link: string }
    expect(link).toMatch(/^https:\/\/app\.test\/onboard\/join\//)
    expect(db.to('onboarding_invites', 'insert')[0]!.payload).toEqual(expect.objectContaining({ kind: 'medical_assistant', clinic_id: CLINIC, email: 'ma@sunrise.test' }))
  })

  it('refuses a bad email', async () => {
    expect((await inviteStaff(req({ email: 'nope' }))).status).toBe(400)
  })
})

describe('BAA and terms acceptance', () => {
  it.each(['baa', 'terms'] as const)('%s: records signer, user, version and the hash of the server text', async key => {
    const a = AGREEMENTS[key]
    const res = await acceptAgreement(req({ agreement: key, version: a.version, signerName: 'Lauren Perkins', signerTitle: 'Owner', textSha256: 'f'.repeat(64) }))
    expect(res.status).toBe(201)
    const [row] = db.to('agreement_acceptances', 'insert')
    expect(row!.payload).toEqual(expect.objectContaining({
      clinic_id: CLINIC, agreement: key, template_version: a.version, text_sha256: sha(a.text),
      signer_name: 'Lauren Perkins', signer_title: 'Owner', user_id: 'admin-1',
    }))
    expect(db.to('clinic_onboarding_steps', 'upsert')[0]!.payload).toEqual(expect.objectContaining({ step: key, status: 'complete' }))
  })

  it('a stale template version is 409', async () => {
    const res = await acceptAgreement(req({ agreement: 'baa', version: 'old-1', signerName: 'L', signerTitle: 'Owner' }))
    expect(res.status).toBe(409)
    expect(db.to('agreement_acceptances', 'insert')).toEqual([])
  })

  it('needs the signer name and title', async () => {
    const res = await acceptAgreement(req({ agreement: 'terms', version: AGREEMENTS.terms.version, signerName: ' ', signerTitle: '' }))
    expect(res.status).toBe(400)
  })
})

describe('completing a step', () => {
  it('providers: not complete until a provider has a state license', async () => {
    db = scriptedDb(clinicWith('in_progress', c => (c.table === 'providers' && c.op === 'select' ? { data: [] } : undefined)))
    expect((await completeStep(req({ step: 'providers' }))).status).toBe(409)
    expect(db.to('clinic_onboarding_steps', 'upsert')).toEqual([])
  })

  it('providers: complete when a provider has a license', async () => {
    db = scriptedDb(clinicWith('in_progress', c => {
      if (c.table === 'providers' && c.op === 'select') return { data: [{ provider_id: PROVIDER }] }
      if (c.table === 'provider_state_licenses' && c.op === 'select') return { data: [{ provider_id: PROVIDER }] }
      return undefined
    }))
    expect((await completeStep(req({ step: 'providers' }))).status).toBe(200)
    expect(db.to('clinic_onboarding_steps', 'upsert')[0]!.payload).toEqual(expect.objectContaining({ step: 'providers', status: 'complete' }))
  })

  it('staff is optional: it completes with no assistants', async () => {
    expect((await completeStep(req({ step: 'staff' }))).status).toBe(200)
  })

  it('the BAA cannot be completed except by accepting it', async () => {
    expect((await completeStep(req({ step: 'baa' }))).status).toBe(400)
  })
})

describe('submit', () => {
  it('needs practice, providers, BAA and terms complete', async () => {
    db = scriptedDb(clinicWith('in_progress', c => (c.table === 'clinic_onboarding_steps' && c.op === 'select' ? { data: [{ step: 'practice', status: 'complete' }] } : undefined)))
    const res = await submit()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual(expect.objectContaining({ missing: ['providers', 'baa', 'terms'] }))
    expect(db.to('clinics', 'update')).toEqual([])
  })

  it('submits for ops review and logs it', async () => {
    db = scriptedDb(clinicWith('changes_requested', c => (c.table === 'clinic_onboarding_steps' && c.op === 'select'
      ? { data: ['practice', 'providers', 'baa', 'terms'].map(step => ({ step, status: 'complete' })) }
      : undefined)))
    const res = await submit()
    expect(res.status).toBe(200)
    const [upd] = db.to('clinics', 'update')
    expect(upd!.payload).toEqual(expect.objectContaining({ onboarding_status: 'submitted' }))
    expect((upd!.payload as Record<string, unknown>)['onboarding_submitted_at']).toBeTruthy()
    expect(db.to('clinic_onboarding_events', 'insert')[0]!.payload).toEqual(expect.objectContaining({ event: 'submitted', actor_user_id: 'admin-1' }))
  })
})
