/**
 * @jest-environment node
 *
 * Shared access helpers take the role and clinic from app_metadata. A
 * self-edited user_metadata (supabase.auth.updateUser) changes nothing:
 *   - Practice: a provider who wrote app_role=clinic_admin is still a
 *     provider, and sees only their real clinic
 *   - PHI access log: the actor recorded is the real role and clinic
 */

import { practiceAccess } from '@/lib/practice/access'
import { phiActorFromUser } from '@/lib/audit/phi-access'

const CLINIC_A = '11111111-1111-4111-8111-111111111111'
const CLINIC_B = '22222222-2222-4222-8222-222222222222'

function clinicsClient(visibleToProviders: boolean) {
  const eqCalls: Array<[string, unknown]> = []
  const client = {
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val])
          return { maybeSingle: async () => ({ data: { practice_dashboard_visible_to_providers: visibleToProviders }, error: null }) }
        },
      }),
    }),
  }
  return { client: client as unknown as Parameters<typeof practiceAccess>[0], eqCalls }
}

const tampered = {
  id: 'u-1',
  email: 'dr.chen@clinic.test',
  app_metadata:  { app_role: 'provider', clinic_id: CLINIC_A },
  user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC_B },
}

describe('practiceAccess ignores self-edited user_metadata', () => {
  it('a provider who wrote app_role=clinic_admin is refused when the toggle is off', async () => {
    const { client } = clinicsClient(false)
    const access = await practiceAccess(client, tampered)
    expect(access.ok).toBe(false)
  })

  it('reads the toggle of the real clinic, and reports the real role', async () => {
    const { client, eqCalls } = clinicsClient(true)
    const access = await practiceAccess(client, tampered)
    expect(access).toEqual({ ok: true, clinicId: CLINIC_A, role: 'provider' })
    expect(eqCalls).toEqual([['clinic_id', CLINIC_A]])
  })

  it('a role only in user_metadata is refused', async () => {
    const { client } = clinicsClient(true)
    const metadataOnly = { app_metadata: {}, user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC_B } }
    const access = await practiceAccess(client, metadataOnly)
    expect(access.ok).toBe(false)
  })
})

describe('phiActorFromUser records the real role and clinic', () => {
  it('uses app_metadata, not the self-edited user_metadata', () => {
    expect(phiActorFromUser(tampered)).toEqual({
      userId: 'u-1', role: 'provider', email: 'dr.chen@clinic.test', clinicId: CLINIC_A,
    })
  })

  it('a role only in user_metadata is recorded as unknown, with no clinic', () => {
    const metadataOnly = { id: 'u-2', app_metadata: {}, user_metadata: { app_role: 'ops_admin', clinic_id: CLINIC_B } }
    expect(phiActorFromUser(metadataOnly))
      .toEqual({ userId: 'u-2', role: 'unknown', email: null, clinicId: null })
  })
})
