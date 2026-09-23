/**
 * @jest-environment node
 *
 * WO-107 RBAC, both directions: the clinic admin sees their own clinic's
 * practice dashboard; a provider only when the clinic's toggle is on; a
 * medical assistant never; ops never (ops has its own pipeline). A toggle
 * that could not be read is an error — never "off", never "on".
 */

import { practiceAccess } from '../access'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const user = (app_role: string, clinic_id: string | undefined = 'clinic-1') => ({ user_metadata: { app_role, clinic_id } })

function world(visible: boolean) {
  return fakeDb({ clinics: [{ clinic_id: 'clinic-1', practice_dashboard_visible_to_providers: visible }] })
}

describe('practiceAccess', () => {
  it('clinic admin: their own clinic, from the session', async () => {
    expect(await practiceAccess(world(false).client, user('clinic_admin'))).toEqual({ ok: true, clinicId: 'clinic-1', role: 'clinic_admin' })
  })

  it('provider: Access Denied while the toggle is off', async () => {
    expect(await practiceAccess(world(false).client, user('provider'))).toMatchObject({ ok: false, status: 403 })
  })

  it('provider: allowed once the clinic turns the toggle on', async () => {
    expect(await practiceAccess(world(true).client, user('provider'))).toEqual({ ok: true, clinicId: 'clinic-1', role: 'provider' })
  })

  it('provider: a toggle that could not be read is 503, not a guess', async () => {
    const db = world(true)
    db.failOn('clinics:select')
    expect(await practiceAccess(db.client, user('provider'))).toMatchObject({ ok: false, status: 503 })
  })

  it('ops: never, whatever the toggle', async () => {
    expect(await practiceAccess(world(true).client, user('ops_admin', undefined))).toMatchObject({ ok: false, status: 403 })
    expect(await practiceAccess(world(true).client, user('ops_admin', 'clinic-1'))).toMatchObject({ ok: false, status: 403 })
  })

  it('medical assistant: never', async () => {
    expect(await practiceAccess(world(true).client, user('medical_assistant'))).toMatchObject({ ok: false, status: 403 })
  })

  it('signed out: 401', async () => {
    expect(await practiceAccess(world(true).client, null)).toMatchObject({ ok: false, status: 401 })
  })
})
