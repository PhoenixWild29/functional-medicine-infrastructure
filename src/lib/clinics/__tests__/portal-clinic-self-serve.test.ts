/**
 * @jest-environment node
 *
 * A clinic that signed up on its own (clinics.signup_source 'self_serve')
 * is a portal clinic too, with no invite: it never sees the live Stripe
 * "Start Onboarding" button. Invited portal clinics and existing clinics
 * are unchanged.
 */

import { scriptedDb } from '@/__tests__/helpers/scripted-db'
import { isPortalOnboardedClinic } from '../portal-clinic'

const CLINIC_ID = 'aaaaaaaa-aaaa-4aaa-9aaa-aaaaaaaaaaaa'

function db(row: Record<string, unknown> | null, invites = 0) {
  return scriptedDb(c => {
    if (c.table === 'clinics') return { data: row }
    if (c.table === 'onboarding_invites') return { data: [], count: invites }
    return undefined
  })
}

it('a self sign-up with no invite is a portal clinic', async () => {
  expect(await isPortalOnboardedClinic(db({ onboarding_status: 'in_progress', signup_source: 'self_serve' }).client, CLINIC_ID)).toBe(true)
  expect(await isPortalOnboardedClinic(db({ onboarding_status: 'approved', signup_source: 'self_serve' }).client, CLINIC_ID)).toBe(true)
})

it('reads signup_source with the onboarding status', async () => {
  const d = db({ onboarding_status: 'approved', signup_source: 'self_serve' })
  await isPortalOnboardedClinic(d.client, CLINIC_ID)
  expect(d.to('clinics')[0]?.filters).toEqual({ clinic_id: CLINIC_ID })
})

it('an invited portal clinic is still one; an existing clinic (no invite, no self sign-up) still is not', async () => {
  expect(await isPortalOnboardedClinic(db({ onboarding_status: 'approved', signup_source: 'invite' }, 1).client, CLINIC_ID)).toBe(true)
  expect(await isPortalOnboardedClinic(db({ onboarding_status: 'approved', signup_source: null }, 0).client, CLINIC_ID)).toBe(false)
})
