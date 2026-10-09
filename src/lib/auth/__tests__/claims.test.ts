/**
 * @jest-environment node
 *
 * Role and clinic come from app_metadata only. user_metadata is writable
 * by the signed-in user (supabase.auth.updateUser), so anything read from
 * it is the user's own claim, never an authorization fact.
 */

import { getUserRole, getUserClinicId, appMetadataFor } from '../claims'

const CLINIC_A = '11111111-1111-4111-8111-111111111111'
const CLINIC_B = '22222222-2222-4222-8222-222222222222'

describe('getUserRole / getUserClinicId', () => {
  it('read app_metadata', () => {
    const user = { app_metadata: { app_role: 'provider', clinic_id: CLINIC_A } }
    expect(getUserRole(user)).toBe('provider')
    expect(getUserClinicId(user)).toBe(CLINIC_A)
  })

  it('ignore a self-edited user_metadata role and clinic', () => {
    const user = {
      app_metadata:  { app_role: 'provider', clinic_id: CLINIC_A },
      user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC_B },
    }
    expect(getUserRole(user)).toBe('provider')
    expect(getUserClinicId(user)).toBe(CLINIC_A)
  })

  it('give nothing to a user whose role and clinic exist only in user_metadata', () => {
    const user = { app_metadata: {}, user_metadata: { app_role: 'ops_admin', clinic_id: CLINIC_B } }
    expect(getUserRole(user)).toBeUndefined()
    expect(getUserClinicId(user)).toBeUndefined()
  })

  it('treat missing users, missing metadata and non-strings as no claim', () => {
    expect(getUserRole(null)).toBeUndefined()
    expect(getUserRole(undefined)).toBeUndefined()
    expect(getUserRole({})).toBeUndefined()
    expect(getUserRole({ app_metadata: null })).toBeUndefined()
    expect(getUserRole({ app_metadata: { app_role: 7 } })).toBeUndefined()
    expect(getUserClinicId({ app_metadata: { clinic_id: '' } })).toBeUndefined()
    expect(getUserClinicId({ app_metadata: { clinic_id: ['x'] } })).toBeUndefined()
  })
})

describe('appMetadataFor', () => {
  it('builds the app_metadata a service-role write sets', () => {
    expect(appMetadataFor({ role: 'provider', clinicId: CLINIC_A })).toEqual({ app_role: 'provider', clinic_id: CLINIC_A })
    expect(appMetadataFor({ role: 'ops_admin', clinicId: null })).toEqual({ app_role: 'ops_admin', clinic_id: null })
  })
})
