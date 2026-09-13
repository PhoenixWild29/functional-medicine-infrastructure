/**
 * @jest-environment node
 *
 * WO-96 fix (item 7): the order drawer's timeline shows who acted by name.
 * resolveTimelineActors maps order_status_history.changed_by (auth user
 * ids) to a provider name, a staff login's name/email, or nothing — and
 * never names a user from another clinic.
 */

import { actorDisplayName, resolveTimelineActors } from '../timeline-actors'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const CHEN_UID = '11111111-1111-4111-8111-111111111111'
const MA_UID = '22222222-2222-4222-8222-222222222222'
const NAMED_ADMIN_UID = '33333333-3333-4333-8333-333333333333'
const OTHER_CLINIC_UID = '44444444-4444-4444-8444-444444444444'
const GONE_UID = '55555555-5555-4555-8555-555555555555'

function fakeClient() {
  const providerFilters: Array<[string, unknown]> = []
  const users: Record<string, { email: string; user_metadata: Record<string, unknown> } | null> = {
    [MA_UID]:           { email: 'ma@sunrise-clinic.com', user_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC } },
    [NAMED_ADMIN_UID]:  { email: 'admin@sunrise-clinic.com', user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC, full_name: 'Lauren Perkins' } },
    [OTHER_CLINIC_UID]: { email: 'someone@blue-cedar.com', user_metadata: { app_role: 'medical_assistant', clinic_id: 'c0000000-0000-4000-8000-000000000002' } },
    [GONE_UID]:         null,
  }
  const getUserById = jest.fn(async (id: string) => (users[id]
    ? { data: { user: { id, ...users[id]! } }, error: null }
    : { data: { user: null }, error: { message: 'User not found' } }))

  const client = {
    from: (table: string) => {
      if (table !== 'providers') throw new Error(`unexpected table ${table}`)
      const chain: Record<string, unknown> = {}
      chain['select'] = () => chain
      chain['eq'] = (c: string, v: unknown) => { providerFilters.push([c, v]); return chain }
      chain['in'] = (c: string, v: unknown) => {
        providerFilters.push([c, v])
        return Promise.resolve({ data: [{ user_id: CHEN_UID, first_name: 'Sarah', last_name: 'Chen' }], error: null })
      }
      return chain
    },
    auth: { admin: { getUserById } },
  }
  return { client, providerFilters, getUserById }
}

describe('resolveTimelineActors', () => {
  it('names providers, staff (name, else email), and leaves other-clinic / missing users unnamed', async () => {
    const { client, providerFilters, getUserById } = fakeClient()
    const actors = await resolveTimelineActors(client as never, CLINIC, [
      CHEN_UID, MA_UID, NAMED_ADMIN_UID, OTHER_CLINIC_UID, GONE_UID, CHEN_UID, null, 'system',
    ])

    expect(actors).toEqual({
      [CHEN_UID]:        { name: 'Sarah Chen', role: 'provider' },
      [MA_UID]:          { name: 'ma@sunrise-clinic.com', role: 'medical_assistant' },
      [NAMED_ADMIN_UID]: { name: 'Lauren Perkins', role: 'clinic_admin' },
    })
    // Provider lookup is clinic-scoped and deduplicated.
    expect(providerFilters).toEqual([
      ['clinic_id', CLINIC],
      ['user_id', [CHEN_UID, MA_UID, NAMED_ADMIN_UID, OTHER_CLINIC_UID, GONE_UID]],
    ])
    // Providers are not looked up again as auth users; non-uuid ids never are.
    expect(getUserById).not.toHaveBeenCalledWith(CHEN_UID)
    expect(getUserById).not.toHaveBeenCalledWith('system')
  })

  it('returns nothing (and queries nothing) when there are no actor ids', async () => {
    const { client, getUserById } = fakeClient()
    expect(await resolveTimelineActors(client as never, CLINIC, [null, undefined])).toEqual({})
    expect(getUserById).not.toHaveBeenCalled()
  })
})

describe('actorDisplayName', () => {
  it('prints the name, and the raw id only when no name resolved', () => {
    const actors = { [CHEN_UID]: { name: 'Sarah Chen', role: 'provider' } }
    expect(actorDisplayName(actors, CHEN_UID)).toBe('Sarah Chen')
    expect(actorDisplayName(actors, GONE_UID)).toBe(GONE_UID)
    expect(actorDisplayName(actors, null)).toBeNull()
  })
})
