/**
 * @jest-environment node
 *
 * Compliance C4: the dashboard warning for licenses that expire within 30
 * days.
 *
 *   - the clinic admin sees every provider's; a provider sees their own;
 *     a medical assistant sees none, and nothing is read;
 *   - only 0 to 30 days out, soonest first; already expired is not "soon";
 *   - a read failure leaves the warning out: it never breaks the dashboard.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { loadExpiringLicenses } from '../expiring'
import { LicenseExpiryWarning } from '@/app/(clinic-app)/dashboard/_components/license-expiry-warning'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const CHEN = 'a2000000-0000-0000-0000-000000000001'
const PATEL = 'a2000000-0000-0000-0000-000000000003'
const TODAY = '2026-10-08'

const LICENSES = [
  { provider_id: CHEN,  state: 'TX', license_number: 'TX-1', expires_on: '2026-11-07' }, // 30 days
  { provider_id: PATEL, state: 'FL', license_number: 'FL-1', expires_on: '2026-10-08' }, // today
  { provider_id: CHEN,  state: 'NY', license_number: 'NY-1', expires_on: '2026-11-08' }, // 31 days: not yet
  { provider_id: CHEN,  state: 'CA', license_number: 'CA-1', expires_on: '2026-10-07' }, // expired
]

function world(override?: (c: ScriptedCall) => ReturnType<Parameters<typeof scriptedDb>[0]>) {
  return scriptedDb(c => {
    const o = override?.(c)
    if (o) return o
    if (c.table === 'providers') {
      const all = [
        { provider_id: CHEN, first_name: 'Sarah', last_name: 'Chen', user_id: 'u-chen' },
        { provider_id: PATEL, first_name: 'Raj', last_name: 'Patel', user_id: 'u-patel' },
      ]
      return { data: all.filter(p => !('user_id' in c.filters) || p.user_id === c.filters['user_id']) }
    }
    if (c.table === 'provider_state_licenses') {
      const ids = c.filters['provider_id:in'] as string[]
      return { data: LICENSES.filter(l => ids.includes(l.provider_id)) }
    }
    return undefined
  })
}

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => jest.restoreAllMocks())

it('the clinic admin: every provider, 0 to 30 days out, soonest first', async () => {
  const db = world()
  expect(await loadExpiringLicenses(db.client as never, { clinicId: CLINIC, userId: 'u-admin', role: 'clinic_admin' }, TODAY)).toEqual([
    { providerName: 'Raj Patel', state: 'FL', expiresOn: '2026-10-08', daysLeft: 0 },
    { providerName: 'Sarah Chen', state: 'TX', expiresOn: '2026-11-07', daysLeft: 30 },
  ])
  const lic = db.calls.find(c => c.table === 'provider_state_licenses')!
  expect(lic.filters).toEqual(expect.objectContaining({ 'expires_on:gte': TODAY, 'expires_on:lte': '2026-11-07' }))
  expect(db.calls.find(c => c.table === 'providers')!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC }))
})

it('a provider: only their own', async () => {
  const db = world()
  const out = await loadExpiringLicenses(db.client as never, { clinicId: CLINIC, userId: 'u-chen', role: 'provider' }, TODAY)
  expect(out.map(l => l.providerName)).toEqual(['Sarah Chen'])
  expect(db.calls.find(c => c.table === 'providers')!.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC, user_id: 'u-chen' }))
})

it('a medical assistant: none, and nothing is read', async () => {
  const db = world()
  expect(await loadExpiringLicenses(db.client as never, { clinicId: CLINIC, userId: 'u-ma', role: 'medical_assistant' }, TODAY)).toEqual([])
  expect(db.calls).toHaveLength(0)
})

it('a read failure leaves the warning out', async () => {
  const db = world(c => (c.table === 'provider_state_licenses' ? DB_DOWN : undefined))
  expect(await loadExpiringLicenses(db.client as never, { clinicId: CLINIC, userId: 'u-admin', role: 'clinic_admin' }, TODAY)).toEqual([])
  expect(console.error).toHaveBeenCalled()
})

describe('the dashboard warning', () => {
  it('names each license, its state and days left, and links to Team', () => {
    const out = renderToStaticMarkup(<LicenseExpiryWarning licenses={[
      { providerName: 'Raj Patel', state: 'FL', expiresOn: '2026-10-08', daysLeft: 0 },
      { providerName: 'Sarah Chen', state: 'TX', expiresOn: '2026-11-07', daysLeft: 30 },
    ]} />)
    expect(out).toContain('data-testid="license-expiry-warning"')
    expect(out).toContain('2 licenses expire soon')
    expect(out).toContain('Raj Patel: FL license expires 2026-10-08 (today). After that, prescriptions for FL patients cannot be signed.')
    expect(out).toContain('Sarah Chen: TX license expires 2026-11-07 (in 30 days).')
    expect(out).toContain('href="/settings/team"')
  })

  it('nothing expiring: no warning', () => {
    expect(renderToStaticMarkup(<LicenseExpiryWarning licenses={[]} />)).toBe('')
  })
})
