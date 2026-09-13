/**
 * @jest-environment node
 *
 * WO-100: resolveCurrentProvider walks providers.user_id → the
 * signed-in user's provider row, scoped to the session clinic, and
 * fails closed (null) on no link / wrong clinic / lookup error.
 */

import { resolveCurrentProvider, isProviderRole } from '../current-provider'

const USER_ID   = 'auth-uid-chen'
const CLINIC_ID = 'a1000000-0000-0000-0000-000000000001'

type Filter = [method: string, column: string, value: unknown]

function makeClient(result: { data: unknown; error: { message: string } | null }) {
  const filters: Filter[] = []
  const builder: Record<string, unknown> = {}
  builder['select'] = () => builder
  builder['eq'] = (column: string, value: unknown) => { filters.push(['eq', column, value]); return builder }
  builder['is'] = (column: string, value: unknown) => { filters.push(['is', column, value]); return builder }
  builder['maybeSingle'] = () => Promise.resolve(result)
  const tables: string[] = []
  const client = { from: (table: string) => { tables.push(table); return builder } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, filters, tables }
}

describe('resolveCurrentProvider', () => {
  it('returns the provider row linked to the auth user within the session clinic', async () => {
    const row = {
      provider_id: 'prov-chen', clinic_id: CLINIC_ID, first_name: 'Sarah', last_name: 'Chen',
      npi_number: '1234567890', signature_hash: null,
    }
    const { client, filters, tables } = makeClient({ data: row, error: null })

    const result = await resolveCurrentProvider(client, { userId: USER_ID, clinicId: CLINIC_ID })

    expect(result).toEqual(row)
    expect(tables).toEqual(['providers'])
    expect(filters).toEqual(expect.arrayContaining([
      ['eq', 'user_id', USER_ID],
      ['eq', 'clinic_id', CLINIC_ID],
      ['eq', 'is_active', true],
      ['is', 'deleted_at', null],
    ]))
  })

  it('returns null when no provider row is linked to the user', async () => {
    const { client } = makeClient({ data: null, error: null })
    await expect(resolveCurrentProvider(client, { userId: USER_ID, clinicId: CLINIC_ID })).resolves.toBeNull()
  })

  it('returns null (fails closed) when the lookup errors', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = makeClient({ data: null, error: { message: 'boom' } })
    await expect(resolveCurrentProvider(client, { userId: USER_ID, clinicId: CLINIC_ID })).resolves.toBeNull()
    spy.mockRestore()
  })

  it('never queries when userId or clinicId is missing', async () => {
    const { client, tables } = makeClient({ data: { provider_id: 'x' }, error: null })
    await expect(resolveCurrentProvider(client, { userId: '', clinicId: CLINIC_ID })).resolves.toBeNull()
    await expect(resolveCurrentProvider(client, { userId: USER_ID, clinicId: '' })).resolves.toBeNull()
    expect(tables).toEqual([])
  })
})

describe('isProviderRole', () => {
  it('is true only for the provider app_role claim', () => {
    expect(isProviderRole('provider')).toBe(true)
    expect(isProviderRole('clinic_admin')).toBe(false)
    expect(isProviderRole('medical_assistant')).toBe(false)
    expect(isProviderRole(undefined)).toBe(false)
  })
})
