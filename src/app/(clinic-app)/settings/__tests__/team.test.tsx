/**
 * @jest-environment node
 *
 * Compliance C4: Settings, Team.
 *
 *   - the clinic admin sees each of the clinic's providers with NPI status
 *     and licenses, and the controls to add or edit a license and re-run
 *     the NPI check;
 *   - a provider sees only their own credentials, read-only;
 *   - a medical assistant gets a notice and nothing is read;
 *   - read through the SESSION client (RLS), scoped to the user's clinic;
 *   - a read failure says so, never an empty team;
 *   - Settings links to the page for the admin and providers only.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { todayUtc } from '@/lib/providers/credentials'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const CHEN = 'a2000000-0000-0000-0000-000000000001'
const PATEL = 'a2000000-0000-0000-0000-000000000003'

let user: unknown = null
let db = scriptedDb(() => undefined)
const serviceClient = jest.fn(() => { throw new Error('the Team page must read through the session client') })

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ ...(db.client as object), auth: { getUser: async () => ({ data: { user } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => serviceClient() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

import TeamPage from '../team/page'

const plusDays = (n: number) => new Date(Date.parse(`${todayUtc()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

const PROVIDERS = [
  { provider_id: CHEN,  first_name: 'Sarah', last_name: 'Chen',  npi_number: '1234567893', user_id: 'u-provider' },
  { provider_id: PATEL, first_name: 'Raj',   last_name: 'Patel', npi_number: '1245319599', user_id: 'u-patel' },
]
const VERIFICATIONS = [
  { provider_id: CHEN,  npi: '1234567893', status: 'verified', reason: null, taxonomy_desc: 'Internal Medicine', checked_at: '2026-10-01T00:00:00Z', source: 'nppes' },
  { provider_id: PATEL, npi: '1245319599', status: 'mismatch', reason: "The registry name for this NPI is not this provider's.", taxonomy_desc: null, checked_at: '2026-10-01T00:00:00Z', source: 'nppes' },
]
const LICENSES = [
  { provider_id: CHEN, state: 'TX', license_number: 'TX-111', expires_on: '2099-12-31', source: 'manual' },
  { provider_id: CHEN, state: 'FL', license_number: 'FL-222', expires_on: plusDays(10), source: 'manual' },
  { provider_id: CHEN, state: 'NY', license_number: 'NY-333', expires_on: '2020-01-01', source: 'manual' },
]

function answer(c: ScriptedCall) {
  if (c.table === 'providers') {
    const rows = PROVIDERS.filter(p => !('user_id' in c.filters) || p.user_id === c.filters['user_id'])
    return { data: c.filters['clinic_id'] === CLINIC ? rows : [] }
  }
  const ids = (c.filters['provider_id:in'] ?? []) as string[]
  if (c.table === 'provider_npi_verifications') return { data: VERIFICATIONS.filter(v => ids.includes(v.provider_id)) }
  if (c.table === 'provider_state_licenses') return { data: LICENSES.filter(l => ids.includes(l.provider_id)) }
  return undefined
}

const as = (role: string, id = `u-${role}`) => ({ id, email: `${role}@clinic.example`, app_metadata: { app_role: role, clinic_id: CLINIC } })
const html = async () => renderToStaticMarkup(await TeamPage())

beforeEach(() => {
  db = scriptedDb(answer)
  serviceClient.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('the clinic admin', () => {
  beforeEach(() => { user = as('clinic_admin') })

  it('sees every provider of the clinic, with NPI status and licenses', async () => {
    const out = await html()
    expect(out).toContain(`data-testid="team-provider-${CHEN}"`)
    expect(out).toContain(`data-testid="team-provider-${PATEL}"`)
    expect(out).toMatch(new RegExp(`data-testid="npi-status-${CHEN}"[^>]*>Verified<`))
    expect(out).toMatch(new RegExp(`data-testid="npi-status-${PATEL}"[^>]*>Does not match the registry<`))
    expect(out).toContain('The registry name for this NPI is not this provider&#x27;s.')
    expect(out).toContain('Active until 2099-12-31')
    expect(out).toContain(`Expires ${plusDays(10)} (in 10 days)`)
    expect(out).toContain('Expired 2020-01-01')
    expect(out).toContain(`data-testid="no-licenses-${PATEL}"`)
  })

  it('gets the license form and the NPI re-check for each provider', async () => {
    const out = await html()
    expect(out.match(/Save license/g)).toHaveLength(2)
    expect(out.match(/Re-run NPI check/g)).toHaveLength(2)
  })

  it('reads through the session client, scoped to the clinic, never the service role', async () => {
    await html()
    expect(serviceClient).not.toHaveBeenCalled()
    const providers = db.calls.find(c => c.table === 'providers')!
    expect(providers.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC, is_active: true }))
    expect(providers.filters).not.toHaveProperty('user_id')
  })

  it('a read failure says so, never an empty team', async () => {
    db = scriptedDb(c => (c.table === 'provider_state_licenses' ? DB_DOWN : answer(c)))
    const out = await html()
    expect(out).toContain('data-testid="team-error"')
    expect(out).not.toContain('team-provider-')
    expect(out).not.toContain('team-empty')
  })
})

describe('a provider', () => {
  beforeEach(() => { user = as('provider') })

  it('sees only their own credentials', async () => {
    const out = await html()
    expect(out).toContain(`data-testid="team-provider-${CHEN}"`)
    expect(out).not.toContain(PATEL)
    expect(db.calls.find(c => c.table === 'providers')!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC, user_id: 'u-provider' }))
  })

  it('read-only: no license form, no NPI re-check', async () => {
    const out = await html()
    expect(out).not.toContain('Save license')
    expect(out).not.toContain('Re-run NPI check')
    expect(out).toContain('Your clinic admin keeps these up to date.')
  })

  it('a login with no provider record is told so', async () => {
    user = as('provider', 'u-nobody')
    expect(await html()).toContain('data-testid="team-empty"')
  })
})

it('a medical assistant gets a notice, and nothing is read', async () => {
  user = as('medical_assistant')
  const out = await html()
  expect(out).toContain('data-testid="team-not-available"')
  expect(db.calls).toHaveLength(0)
})

it('no user: nothing is read', async () => {
  user = null
  await html()
  expect(db.calls).toHaveLength(0)
})
