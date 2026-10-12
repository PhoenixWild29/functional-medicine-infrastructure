/**
 * @jest-environment node
 *
 * A clinic onboarded through the portal: it has an onboarding status
 * (clinics.onboarding_status, migration 20261013000001) and came through
 * an onboarding invite (a clinic_admin row in onboarding_invites). Its
 * payouts are set up at launch, so the dashboard and Settings say so
 * instead of asking for Stripe onboarding.
 *
 * Existing clinics (Dr. Chen's and the others) have the default
 * onboarding status but no invite: they see exactly what they see today.
 * If the check cannot run, the clinic is treated as existing (today's
 * screens), and the failure is logged without detail.
 */

import { scriptedDb, DB_DOWN } from '@/__tests__/helpers/scripted-db'
import { isPortalOnboardedClinic } from '../portal-clinic'

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'

function db(opts: { status?: string | null; invites?: number; clinicDown?: boolean; invitesDown?: boolean }) {
  return scriptedDb(c => {
    if (c.table === 'clinics') return opts.clinicDown ? DB_DOWN : { data: opts.status === undefined ? { onboarding_status: 'approved' } : opts.status === null ? null : { onboarding_status: opts.status } }
    if (c.table === 'onboarding_invites') return opts.invitesDown ? DB_DOWN : { data: [], count: opts.invites ?? 0 }
    return undefined
  })
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

it('a clinic with an onboarding status that came through a clinic-admin invite is a portal clinic', async () => {
  const d = db({ status: 'approved', invites: 1 })
  expect(await isPortalOnboardedClinic(d.client, CLINIC_ID)).toBe(true)
  const invites = d.to('onboarding_invites')[0]!
  expect(invites.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC_ID, kind: 'clinic_admin' }))
  expect(invites.head).toBe(true)
})

it('an existing clinic (default status, no invite) is not', async () => {
  expect(await isPortalOnboardedClinic(db({ status: 'approved', invites: 0 }).client, CLINIC_ID)).toBe(false)
})

it('a clinic row that cannot be found is not', async () => {
  expect(await isPortalOnboardedClinic(db({ status: null, invites: 1 }).client, CLINIC_ID)).toBe(false)
})

it.each([['clinics', { clinicDown: true, invites: 1 }], ['onboarding_invites', { invitesDown: true }]] as const)(
  'if %s cannot be read: today\'s screens (not a portal clinic), logged', async (_t, opts) => {
    expect(await isPortalOnboardedClinic(db(opts).client, CLINIC_ID)).toBe(false)
    expect(console.error).toHaveBeenCalled()
  },
)
