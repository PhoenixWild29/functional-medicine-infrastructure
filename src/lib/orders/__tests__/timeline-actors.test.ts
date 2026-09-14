/**
 * @jest-environment node
 *
 * WO-96 fix (item 7): the order drawer's timeline shows who acted by name.
 * resolveTimelineActors maps order_status_history.changed_by (auth user
 * ids) to a display name:
 *
 *   provider in the clinic      → "First Last"
 *   staff login in the clinic   → full_name, then name, then a role label
 *                                 ("Medical Assistant", "Clinic Admin", …)
 *   ops staff (no clinic_id)    → "Ops", never a name
 *   another clinic / missing    → no name (the drawer shows the id)
 *
 * An email address must never render as a person's name.
 */

import { actorDisplayName, resolveTimelineActors, roleLabel } from '../timeline-actors'

const CLINIC = 'c0000000-0000-4000-8000-000000000001'
const CHEN_UID = '11111111-1111-4111-8111-111111111111'
const MA_UID = '22222222-2222-4222-8222-222222222222'
const NAMED_ADMIN_UID = '33333333-3333-4333-8333-333333333333'
const OTHER_CLINIC_UID = '44444444-4444-4444-8444-444444444444'
const GONE_UID = '55555555-5555-4555-8555-555555555555'
const NAME_ONLY_UID = '66666666-6666-4666-8666-666666666666'
const UNKNOWN_ROLE_UID = '77777777-7777-4777-8777-777777777777'
const OPS_UID = '88888888-8888-4888-8888-888888888888'

type FakeUser = { email: string; user_metadata: Record<string, unknown> }

function fakeClient() {
  const providerFilters: Array<[string, unknown]> = []
  const users: Record<string, FakeUser | null> = {
    [MA_UID]:           { email: 'ma@sunrise-clinic.com', user_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC } },
    [NAMED_ADMIN_UID]:  { email: 'admin@sunrise-clinic.com', user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC, full_name: 'Lauren Perkins', name: 'Lauren' } },
    [NAME_ONLY_UID]:    { email: 'anila@sunrise-clinic.com', user_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC, name: 'Anila Coniku-Nicklos' } },
    [UNKNOWN_ROLE_UID]: { email: 'temp@sunrise-clinic.com', user_metadata: { app_role: 'contractor', clinic_id: CLINIC } },
    [OPS_UID]:          { email: 'ops@compoundiq-poc.com', user_metadata: { app_role: 'ops_admin', full_name: 'Ops Person' } },
    [OTHER_CLINIC_UID]: { email: 'someone@blue-cedar.com', user_metadata: { app_role: 'medical_assistant', clinic_id: 'c0000000-0000-4000-8000-000000000002', full_name: 'Other Clinic Staff' } },
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
  return { client, providerFilters, getUserById, users }
}

describe('resolveTimelineActors', () => {
  it('providers by name; staff by full_name → name → role label; ops as "Ops"; others unnamed', async () => {
    const { client, providerFilters, getUserById } = fakeClient()
    const actors = await resolveTimelineActors(client as never, CLINIC, [
      CHEN_UID, MA_UID, NAMED_ADMIN_UID, NAME_ONLY_UID, UNKNOWN_ROLE_UID, OPS_UID,
      OTHER_CLINIC_UID, GONE_UID, CHEN_UID, null, 'system',
    ])

    expect(actors).toEqual({
      [CHEN_UID]:         { name: 'Sarah Chen', role: 'provider' },
      [NAMED_ADMIN_UID]:  { name: 'Lauren Perkins', role: 'clinic_admin' },     // full_name wins over name
      [NAME_ONLY_UID]:    { name: 'Anila Coniku-Nicklos', role: 'clinic_admin' },
      [MA_UID]:           { name: 'Medical Assistant', role: 'medical_assistant' }, // no name fields → role label
      [UNKNOWN_ROLE_UID]: { name: null, role: 'contractor' },                   // unknown role → null → id shown
      [OPS_UID]:          { name: 'Ops', role: 'ops_admin' },                   // cross-clinic: label only
    })
    // Provider lookup is clinic-scoped and deduplicated.
    expect(providerFilters).toEqual([
      ['clinic_id', CLINIC],
      ['user_id', [CHEN_UID, MA_UID, NAMED_ADMIN_UID, NAME_ONLY_UID, UNKNOWN_ROLE_UID, OPS_UID, OTHER_CLINIC_UID, GONE_UID]],
    ])
    expect(getUserById).not.toHaveBeenCalledWith(CHEN_UID)
    expect(getUserById).not.toHaveBeenCalledWith('system')
  })

  it('never uses an email address as a display name', async () => {
    const { client, users } = fakeClient()
    const actors = await resolveTimelineActors(client as never, CLINIC, Object.keys(users))
    const emails = Object.values(users).filter((u): u is FakeUser => u != null).map(u => u.email)
    for (const actor of Object.values(actors)) {
      expect(actor.name ?? '').not.toMatch(/@/)
      expect(emails).not.toContain(actor.name)
    }
  })

  it('returns nothing (and queries nothing) when there are no actor ids', async () => {
    const { client, getUserById } = fakeClient()
    expect(await resolveTimelineActors(client as never, CLINIC, [null, undefined])).toEqual({})
    expect(getUserById).not.toHaveBeenCalled()
  })
})

describe('roleLabel', () => {
  it.each([
    ['medical_assistant', 'Medical Assistant'],
    ['clinic_admin',      'Clinic Admin'],
    ['provider',          'Provider'],
    ['ops_admin',         'Ops'],
    ['contractor',        null],
    ['',                  null],
    [null,                null],
  ])('%j → %j', (role, label) => {
    expect(roleLabel(role)).toBe(label)
  })
})

describe('actorDisplayName', () => {
  it('prints the name, and the raw id only when no name resolved', () => {
    const actors = {
      [CHEN_UID]: { name: 'Sarah Chen', role: 'provider' },
      [UNKNOWN_ROLE_UID]: { name: null, role: 'contractor' },
    }
    expect(actorDisplayName(actors, CHEN_UID)).toBe('Sarah Chen')
    expect(actorDisplayName(actors, UNKNOWN_ROLE_UID)).toBe(UNKNOWN_ROLE_UID)
    expect(actorDisplayName(actors, GONE_UID)).toBe(GONE_UID)
    expect(actorDisplayName(actors, null)).toBeNull()
  })
})
