/**
 * @jest-environment node
 *
 * C-2026-10-25-17 (B14/B15, the HIPAA evidence map): the audit log's core.
 *
 *   - Actors other than a signed-in user: a patient on a token link
 *     (actor_role 'patient', actor_user_id = the patient's id) and the
 *     system (crons, adapters, webhooks: actor_role 'system', the nil UUID).
 *     No schema change: actor_role is any ^[a-z_]{1,40}$ and actor_user_id
 *     is an unconstrained UUID.
 *   - logPhiAccess / logPhiAccessMany say whether the row was written. A
 *     failure raises one PHI-free alert (Slack + Sentry: the error code,
 *     the route pattern and the action, never an id), throttled per route.
 *   - logPhiDisclosure (action 'export') is the fail-closed variant: a
 *     caller sends PHI outside only after it returns true.
 *   - phiAuditSecretConfigured() for the health check.
 */

import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
const slackMock = jest.fn(async () => true)
jest.mock('@/lib/slack/client', () => ({
  ...jest.requireActual('@/lib/slack/client'),
  sendSlackAlert: (...a: unknown[]) => slackMock(...(a as [])),
}))
const sentryMock = jest.fn()
jest.mock('@sentry/nextjs', () => ({ captureMessage: (...a: unknown[]) => sentryMock(...a) }))

jest.unmock('@/lib/audit/phi-access')
import {
  logPhiAccess, logPhiAccessMany, logPhiDisclosure, patientActor, systemActor,
  phiAuditSecretConfigured, PHI_ACCESS_HASH_ENV, SYSTEM_ACTOR_ID, __resetPhiAlertThrottle,
} from '../phi-access'

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dr.chen@sunrise.example',
  app_metadata: { app_role: 'provider', clinic_id: '22222222-2222-4222-8222-222222222222' },
}
const CLINIC = '22222222-2222-4222-8222-222222222222'
const PATIENT = '33333333-3333-4333-8333-333333333333'
const ORDER = '44444444-4444-4444-8444-444444444444'

const inserted = () => db.to('phi_access_log', 'insert').map(c => c.payload as Record<string, unknown>)

beforeEach(() => {
  db = scriptedDb(() => undefined)
  slackMock.mockClear()
  sentryMock.mockClear()
  __resetPhiAlertThrottle()
  process.env[PHI_ACCESS_HASH_ENV] = 'test-audit-secret'
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
  delete process.env[PHI_ACCESS_HASH_ENV]
})

describe('actors other than a signed-in user', () => {
  it('a patient on a token link: role patient, the patient id as the actor, the clinic', async () => {
    expect(await logPhiAccess({ actor: patientActor(PATIENT, CLINIC), action: 'view', resource: 'plan', route: '/plan/[token]', patientId: PATIENT })).toBe(true)
    expect(inserted()[0]).toMatchObject({ actor_user_id: PATIENT, actor_role: 'patient', actor_email_hash: null, clinic_id: CLINIC, patient_id: PATIENT, action: 'view', resource: 'plan' })
  })

  it('the system: role system, the nil UUID, the clinic whose data it is', async () => {
    expect(SYSTEM_ACTOR_ID).toBe('00000000-0000-0000-0000-000000000000')
    await logPhiAccess({ actor: systemActor(CLINIC), action: 'export', resource: 'pharmacy_disclosure', route: '/api/cron/submit-paid-orders', patientId: PATIENT, orderId: ORDER })
    expect(inserted()[0]).toMatchObject({ actor_user_id: SYSTEM_ACTOR_ID, actor_role: 'system', clinic_id: CLINIC, order_id: ORDER })
  })

  it('no user and no actor: nothing is written, and it says so', async () => {
    expect(await logPhiAccess({ user: null, action: 'view', resource: 'order', route: '/api/x' })).toBe(false)
    expect(inserted()).toHaveLength(0)
  })
})

describe('a failed write is reported, never silent', () => {
  it('logPhiAccess returns false and raises one alert with no ids', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' ? DB_DOWN : undefined))
    expect(await logPhiAccess({ user: USER, action: 'view', resource: 'order', route: `/api/orders/${ORDER}/record`, patientId: PATIENT, orderId: ORDER })).toBe(false)
    expect(slackMock).toHaveBeenCalledTimes(1)
    expect(sentryMock).toHaveBeenCalledTimes(1)
    const sent = JSON.stringify([slackMock.mock.calls, sentryMock.mock.calls])
    expect(sent).not.toContain(PATIENT)
    expect(sent).not.toContain(ORDER)
    expect(sent).not.toContain(USER.id)
    expect(sent).toContain('/api/orders/[id]/record')
  })

  it('alerts are throttled per route and action', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' ? DB_DOWN : undefined))
    for (let i = 0; i < 3; i++) await logPhiAccess({ user: USER, action: 'view', resource: 'order', route: '/api/orders/[id]/record' })
    expect(slackMock).toHaveBeenCalledTimes(1)
  })

  it('logPhiAccessMany returns false on a failed chunk and alerts', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' ? DB_DOWN : undefined))
    expect(await logPhiAccessMany({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard' }, [PATIENT])).toBe(false)
    expect(slackMock).toHaveBeenCalledTimes(1)
  })

  it('a successful write is true and raises nothing', async () => {
    expect(await logPhiAccess({ user: USER, action: 'view', resource: 'order', route: '/api/x' })).toBe(true)
    expect(await logPhiAccessMany({ user: USER, action: 'view', resource: 'order_list', route: '/dashboard' }, [PATIENT])).toBe(true)
    expect(slackMock).not.toHaveBeenCalled()
  })
})

describe('disclosures fail closed', () => {
  it('logPhiDisclosure writes an export row and returns true', async () => {
    expect(await logPhiDisclosure({ actor: systemActor(CLINIC), resource: 'pharmacy_disclosure', route: '/api/cron/submit-paid-orders', patientId: PATIENT, orderId: ORDER })).toBe(true)
    expect(inserted()[0]).toMatchObject({ action: 'export', resource: 'pharmacy_disclosure' })
  })
  it('a failed write returns false (the caller must not send) and alerts', async () => {
    db = scriptedDb(c => (c.table === 'phi_access_log' ? DB_DOWN : undefined))
    expect(await logPhiDisclosure({ actor: systemActor(CLINIC), resource: 'pharmacy_disclosure', route: '/api/cron/submit-paid-orders', orderId: ORDER })).toBe(false)
    expect(slackMock).toHaveBeenCalledTimes(1)
  })
})

describe('the hash secret', () => {
  it('phiAuditSecretConfigured reflects the env, without exposing it', () => {
    expect(phiAuditSecretConfigured()).toBe(true)
    process.env[PHI_ACCESS_HASH_ENV] = '   '
    expect(phiAuditSecretConfigured()).toBe(false)
    delete process.env[PHI_ACCESS_HASH_ENV]
    expect(phiAuditSecretConfigured()).toBe(false)
  })
})
