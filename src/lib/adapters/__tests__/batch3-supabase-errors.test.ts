/**
 * @jest-environment node
 *
 * Batch 3, PR 2: the pharmacy adapters fail loud on a Supabase read error.
 *
 * Before, each of these reads ignored its `error`, and a failed read looked
 * like "no row": the routing engine took a failed circuit-breaker read for a
 * CLOSED circuit and submitted anyway; Tier 1 took a failed rate-limit count
 * for 0 and went past the limit; Tier 1 and Tier 4 put "CompoundIQ Clinic"
 * on the prescription when the clinic read failed; markSubmitted replaced
 * the row's metadata with just the fingerprint when the re-read failed.
 *
 * No network: Documo, the Vault and fetch are mocked.
 */

import { scriptedDb, DB_DOWN, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const sendFaxMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/documo/client', () => ({ sendFax: (...a: unknown[]) => sendFaxMock(...a) }))
jest.mock('@/lib/adapters/vault', () => ({
  getVaultSecret: async () => 'secret',
  buildAuthHeaders: async () => ({ Authorization: 'Bearer secret' }),
}))
const casCalls: Array<{ newStatus: string; metadata?: Record<string, unknown> }> = []
jest.mock('@/lib/orders/cas-transition', () => ({
  casTransition: async (args: { newStatus: string; metadata?: Record<string, unknown> }) => {
    casCalls.push(args)
    return { success: true, wasAlreadyTransitioned: false }
  },
}))
jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: async () => undefined,
  buildAdapterFailureAlert: () => ({ text: '' }),
  buildSubmissionFailedAlert: () => ({ text: '' }),
}))

import { routeOrder } from '../routing-engine'
import { submitTier1Api } from '../tier1-api'
import { submitTier4Fax } from '../tier4-fax'
import { markSubmitted } from '../audit-trail'

const fetchMock = jest.fn()
beforeAll(() => { (global as { fetch: unknown }).fetch = fetchMock })

// Pharmacy submissions ON: these tests describe the switch on (the kill
// switch is covered in submission-kill-switch.test.ts).
beforeAll(() => { process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true' })
afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })

jest.spyOn(console, 'error').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})
jest.spyOn(console, 'warn').mockImplementation(() => {})

beforeEach(() => {
  casCalls.length = 0
  sendFaxMock.mockReset().mockResolvedValue({ faxId: 'fax-1' })
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })
})

const ORDER = {
  order_id: 'o-1', order_number: 'CMP-1', status: 'PAID_PROCESSING',
  pharmacy_id: 'ph-1', clinic_id: 'c-1', provider_id: 'pr-1', patient_id: 'pt-1', formulation_id: 'f-sema', catalog_item_id: null,
  medication_snapshot: { medication_name: 'Semaglutide' }, provider_npi_snapshot: '1234567890',
  quantity: 1, sig_text: 'Inject weekly', fax_attempt_count: 0, created_at: '2026-10-01T00:00:00Z',
}
const PROVIDER = { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' }
const PATIENT  = { first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', allergies: [], nkda: true }

/** Every read answers with a healthy row unless `override` answers first. */
function healthy(override: Script): Script {
  return call => {
    const o = override(call)
    if (o) return o
    switch (call.table) {
      case 'orders':    return { data: ORDER }
      case 'providers': return { data: PROVIDER }
      case 'patients':  return { data: PATIENT }
      case 'clinics':   return { data: { name: 'Sunrise Functional Medicine' } }
      // Compliance C6: submission checks the catalog; Semaglutide is not controlled.
      case 'formulations': return { data: { formulation_id: 'f-sema', salt_forms: { ingredients: { dea_schedule: null } }, formulation_ingredients: [] } }
      case 'pharmacies':
        return { data: { integration_tier: 'TIER_1_API', name: 'Acme', slug: 'acme', fax_number: '+15125550100' } }
      case 'pharmacy_api_configs':
        return { data: { config_id: 'cfg-1', base_url: 'https://pharm.test', vault_secret_id: 'v-1', endpoints: null, auth_type: 'api_key', payload_transformer: null, response_parser: null, rate_limit_rpm: null, rate_limit_concurrent: null, timeout_ms: 1000 } }
      case 'adapter_submissions':
        return call.op === 'insert' ? { data: { submission_id: 'sub-1' } } : { data: null, count: 0 }
      default: return undefined
    }
  }
}

// The engine claims the order before reading anything, so a failed read
// after the claim lands the order in SUBMISSION_FAILED (with the read error
// recorded on that transition) instead of throwing and leaving it claimed.
const failedWith = () => casCalls.find(c => c.newStatus === 'SUBMISSION_FAILED')?.metadata?.['error']

describe('routing engine', () => {
  it('a failed circuit-breaker read stops the submission instead of reading as CLOSED', async () => {
    db = scriptedDb(healthy(c => {
      if (c.table === 'pharmacies') return { data: { integration_tier: 'TIER_4_FAX', name: 'Acme', slug: 'acme' } }
      if (c.table === 'circuit_breaker_state' && c.op === 'select') return DB_DOWN
      return undefined
    }))
    const result = await routeOrder({ orderId: 'o-1', pharmacyId: 'ph-1', currentStatus: 'PAID_PROCESSING' })
    expect(result.outcome).toBe('submission_failed')
    expect(failedWith()).toMatch(/circuit breaker state .* could not be read: connection reset/)
    expect(sendFaxMock).not.toHaveBeenCalled()
  })

  it('a failed pharmacy read says so, not "not found or inactive"', async () => {
    db = scriptedDb(healthy(c => (c.table === 'pharmacies' ? DB_DOWN : undefined)))
    const result = await routeOrder({ orderId: 'o-1', pharmacyId: 'ph-1', currentStatus: 'PAID_PROCESSING' })
    expect(result.outcome).toBe('submission_failed')
    expect(failedWith()).toMatch(/pharmacy ph-1 could not be read: connection reset/)
  })
})

describe('Tier 1 API adapter', () => {
  it('a failed rate-limit count stops the submission instead of counting as 0', async () => {
    db = scriptedDb(healthy(c => {
      if (c.table === 'pharmacy_api_configs') {
        return { data: { config_id: 'cfg-1', base_url: 'https://pharm.test', vault_secret_id: 'v-1', endpoints: null, auth_type: 'api_key', payload_transformer: null, response_parser: null, rate_limit_rpm: 10, rate_limit_concurrent: null, timeout_ms: 1000 } }
      }
      if (c.table === 'adapter_submissions' && c.head) return DB_DOWN
      return undefined
    }))
    await expect(submitTier1Api('o-1', 'ph-1')).rejects.toThrow(/rate limit could not be checked: connection reset/)
    // Only the controlled-substance check (compliance C6) reads the order
    // before the rate limit; the order's data is not loaded.
    expect(db.to('orders')).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed concurrent-limit count stops the submission too', async () => {
    db = scriptedDb(healthy(c => {
      if (c.table === 'pharmacy_api_configs') {
        return { data: { config_id: 'cfg-1', base_url: 'https://pharm.test', vault_secret_id: 'v-1', endpoints: null, auth_type: 'api_key', payload_transformer: null, response_parser: null, rate_limit_rpm: null, rate_limit_concurrent: 2, timeout_ms: 1000 } }
      }
      if (c.table === 'adapter_submissions' && c.head) return DB_DOWN
      return undefined
    }))
    await expect(submitTier1Api('o-1', 'ph-1')).rejects.toThrow(/rate limit could not be checked: connection reset/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed pharmacy-tier read stops the submission', async () => {
    db = scriptedDb(healthy(c => (c.table === 'pharmacies' ? DB_DOWN : undefined)))
    await expect(submitTier1Api('o-1', 'ph-1')).rejects.toThrow(/pharmacy ph-1 could not be read: connection reset/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed clinic read stops the submission instead of sending "CompoundIQ Clinic"', async () => {
    db = scriptedDb(healthy(c => (c.table === 'clinics' ? DB_DOWN : undefined)))
    await expect(submitTier1Api('o-1', 'ph-1')).rejects.toThrow(/clinic c-1 could not be read: connection reset/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a failed provider read says it could not be read', async () => {
    db = scriptedDb(healthy(c => (c.table === 'providers' ? DB_DOWN : undefined)))
    await expect(submitTier1Api('o-1', 'ph-1')).rejects.toThrow(/provider pr-1 could not be read: connection reset/)
  })
})

describe('Tier 4 fax adapter', () => {
  it('a failed clinic read stops the fax instead of printing "CompoundIQ Clinic"', async () => {
    db = scriptedDb(healthy(c => (c.table === 'clinics' ? DB_DOWN : undefined)))
    await expect(submitTier4Fax('o-1')).rejects.toThrow(/clinic c-1 could not be read: connection reset/)
    expect(sendFaxMock).not.toHaveBeenCalled()
    expect(db.to('adapter_submissions', 'insert')).toHaveLength(0)
  })

  it('a failed pharmacy read says so, not "has no fax_number"', async () => {
    db = scriptedDb(healthy(c => (c.table === 'pharmacies' ? DB_DOWN : undefined)))
    await expect(submitTier4Fax('o-1')).rejects.toThrow(/pharmacy ph-1 could not be read: connection reset/)
    expect(sendFaxMock).not.toHaveBeenCalled()
  })
})

describe('audit trail: markSubmitted', () => {
  it('a failed metadata re-read leaves the row\'s metadata alone instead of replacing it', async () => {
    db = scriptedDb(c => (c.table === 'adapter_submissions' && c.op === 'select' ? DB_DOWN : undefined))
    await markSubmitted('sub-1', { orderId: 'o-1' })
    const [update] = db.to('adapter_submissions', 'update')
    expect(update!.payload).toEqual(expect.objectContaining({ status: 'SUBMITTED' }))
    expect(update!.payload).not.toHaveProperty('metadata')
  })

  it('a successful re-read still merges the fingerprint over the existing keys', async () => {
    db = scriptedDb(c => (c.table === 'adapter_submissions' && c.op === 'select' ? { data: { metadata: { config_id: 'cfg-1' } } } : undefined))
    await markSubmitted('sub-1', { orderId: 'o-1' })
    const [update] = db.to('adapter_submissions', 'update')
    expect(update!.payload).toEqual(expect.objectContaining({
      metadata: expect.objectContaining({ config_id: 'cfg-1', phi_fingerprint: expect.any(String) }),
    }))
  })
})
