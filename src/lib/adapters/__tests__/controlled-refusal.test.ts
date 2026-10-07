/**
 * @jest-environment node
 *
 * Compliance C6, defence in depth: each adapter refuses a controlled
 * substance itself, beside the pharmacy-submissions kill switch, so a path
 * that reaches an adapter without routeOrder (ops resubmit, a manual
 * submit) still sends nothing. The catalog decides, not the snapshot.
 *
 * No network: fetch, the Vault and Documo are mocked.
 */

import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendFaxMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/documo/client', () => ({ sendFax: (...a: unknown[]) => sendFaxMock(...a) }))
jest.mock('@/lib/adapters/vault', () => ({ getVaultSecret: async () => 'secret', buildAuthHeaders: async () => ({}) }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: async () => ({ success: true, wasAlreadyTransitioned: false }) }))

import { submitTier4Fax } from '../tier4-fax'
import { submitTier1Api } from '../tier1-api'

const fetchMock = jest.fn()
beforeAll(() => {
  process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true';
  (global as { fetch: unknown }).fetch = fetchMock
})
afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })
jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const ORDER = {
  order_id: 'o-1', order_number: 'CMP-1', status: 'SUBMISSION_PENDING', pharmacy_id: 'ph-1', clinic_id: 'c-1',
  provider_id: 'pr-1', patient_id: 'pt-1', formulation_id: 'f-testo', catalog_item_id: null,
  medication_snapshot: { medication_name: 'Testosterone Cypionate 200mg/mL', dea_schedule: 0 },
  provider_npi_snapshot: '1234567890', quantity: 1, sig_text: 'Inject weekly', fax_attempt_count: 0, created_at: '2026-10-01T00:00:00Z',
}

function world(more: Script = () => undefined): Script {
  return c => {
    const m = more(c)
    if (m) return m
    if (c.table === 'orders') return { data: ORDER }
    if (c.table === 'formulations') return { data: { formulation_id: 'f-testo', salt_forms: { ingredients: { dea_schedule: 3 } }, formulation_ingredients: [] } }
    if (c.table === 'pharmacies') return { data: { integration_tier: 'TIER_1_API', name: 'Acme', slug: 'acme', fax_number: '+15125550100' } }
    if (c.table === 'clinics') return { data: { name: 'Sunrise' } }
    if (c.table === 'providers') return { data: { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' } }
    if (c.table === 'patients') return { data: { first_name: 'Alex', last_name: 'Demo', allergies: [], nkda: true } }
    if (c.table === 'pharmacy_api_configs') {
      return { data: { config_id: 'cfg-1', base_url: 'https://pharm.test', vault_secret_id: 'v-1', endpoints: null, auth_type: 'api_key', payload_transformer: null, response_parser: null, rate_limit_rpm: null, rate_limit_concurrent: null, timeout_ms: 1000 } }
    }
    if (c.table === 'adapter_submissions') return c.op === 'insert' ? { data: { submission_id: 'sub-1' } } : { data: null, count: 0 }
    return undefined
  }
}

beforeEach(() => {
  sendFaxMock.mockReset().mockResolvedValue({ faxId: 'fax-1' })
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })
})

it('Tier 4 fax refuses a controlled order (schedule from the catalog, not the snapshot) and sends nothing', async () => {
  db = scriptedDb(world())
  await expect(submitTier4Fax('o-1')).rejects.toThrow(/controlled substance/i)
  expect(sendFaxMock).not.toHaveBeenCalled()
  expect(db.to('adapter_submissions', 'insert')).toHaveLength(0)
})

it('Tier 1 API refuses a controlled order and calls no pharmacy API', async () => {
  db = scriptedDb(world())
  await expect(submitTier1Api('o-1', 'ph-1')).rejects.toThrow(/controlled substance/i)
  expect(fetchMock).not.toHaveBeenCalled()
})
