/**
 * @jest-environment node
 *
 * The access log shows who acted, not only the role: the person's name
 * when we know it, and their email. Resolved server-side from the log's
 * actor_user_id, only for logins in the admin's own clinic. An email is
 * shown as an email, never as the person's name. CompoundIQ ops staff work
 * across clinics and show as "CompoundIQ ops".
 */

import { resolveAccessLogActors } from '../access-log-actors'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`

// Role and clinic in app_metadata (service role only); the display name in
// user_metadata (the user's own, only ever shown).
type FakeUser = { email?: string; app_metadata: Record<string, unknown>; user_metadata?: Record<string, unknown> }
const users: Record<string, FakeUser> = {
  [ID(1)]: { email: 'sarah.chen@clinic.example', app_metadata: { app_role: 'provider', clinic_id: CLINIC } },
  [ID(2)]: { email: 'maria@clinic.example', app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC }, user_metadata: { full_name: 'Maria Lopez' } },
  [ID(3)]: { email: 'nobody-named@clinic.example', app_metadata: { app_role: 'clinic_admin', clinic_id: CLINIC } },
  [ID(4)]: { email: 'other@elsewhere.example', app_metadata: { app_role: 'provider', clinic_id: 'another-clinic' } },
  [ID(5)]: { email: 'ops@compoundiq.example', app_metadata: { app_role: 'ops_admin' } },
  // An MA in this clinic who rewrote their own user_metadata to look like ops.
  [ID(6)]: { email: 'ma.hiding@clinic.example', app_metadata: { app_role: 'medical_assistant', clinic_id: CLINIC }, user_metadata: { app_role: 'ops_admin', full_name: 'Hidden MA' } },
  // A provider of another clinic who rewrote their user_metadata clinic_id to this one.
  [ID(7)]: { email: 'intruder@elsewhere.example', app_metadata: { app_role: 'provider', clinic_id: 'another-clinic' }, user_metadata: { app_role: 'provider', clinic_id: CLINIC, full_name: 'Intruder' } },
}

let providerError: unknown = null
const getUserById = jest.fn(async (id: string) => (users[id] ? { data: { user: { id, ...users[id] } }, error: null } : { data: { user: null }, error: { message: 'not found' } }))

function service() {
  return {
    from: (table: string) => {
      if (table !== 'providers') throw new Error(`unexpected table ${table}`)
      const q: Record<string, unknown> = {}
      q['select'] = () => q
      q['eq'] = () => q
      q['in'] = () => q
      q['then'] = (r: (v: unknown) => unknown) => Promise.resolve(providerError
        ? { data: null, error: providerError }
        : { data: [{ user_id: ID(1), first_name: 'Sarah', last_name: 'Chen' }], error: null }).then(r)
      return q
    },
    auth: { admin: { getUserById } },
  }
}

beforeEach(() => {
  providerError = null
  getUserById.mockClear()
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('names each actor in the clinic and gives their email; email is never the name', async () => {
  const actors = await resolveAccessLogActors(service() as never, CLINIC, [ID(1), ID(2), ID(3), ID(1)])
  expect(actors[ID(1)]).toEqual({ name: 'Sarah Chen', email: 'sarah.chen@clinic.example' })
  expect(actors[ID(2)]).toEqual({ name: 'Maria Lopez', email: 'maria@clinic.example' })
  expect(actors[ID(3)]).toEqual({ name: null, email: 'nobody-named@clinic.example' })
  expect(getUserById).toHaveBeenCalledTimes(3)
})

it('a user of another clinic is not identified; ops staff show as CompoundIQ ops with no email', async () => {
  const actors = await resolveAccessLogActors(service() as never, CLINIC, [ID(4), ID(5)])
  expect(actors[ID(4)]).toBeUndefined()
  expect(actors[ID(5)]).toEqual({ name: 'CompoundIQ ops', email: null })
})

it('a failed lookup is not fatal: the actor is just not identified', async () => {
  providerError = { message: 'down' }
  getUserById.mockRejectedValueOnce(new Error('auth down'))
  const actors = await resolveAccessLogActors(service() as never, CLINIC, [ID(1), ID(2)])
  expect(actors[ID(1)]).toBeUndefined()
  expect(actors[ID(2)]).toEqual({ name: 'Maria Lopez', email: 'maria@clinic.example' })
})

it('a self-edited user_metadata changes nothing: no hiding as ops, no showing in another clinic', async () => {
  const actors = await resolveAccessLogActors(service() as never, CLINIC, [ID(6), ID(7)])
  expect(actors[ID(6)]).toEqual({ name: 'Hidden MA', email: 'ma.hiding@clinic.example' })
  expect(actors[ID(7)]).toBeUndefined()
})

it('ids that are not user ids are ignored', async () => {
  expect(await resolveAccessLogActors(service() as never, CLINIC, [null, 'system', ''])).toEqual({})
  expect(getUserById).not.toHaveBeenCalled()
})
