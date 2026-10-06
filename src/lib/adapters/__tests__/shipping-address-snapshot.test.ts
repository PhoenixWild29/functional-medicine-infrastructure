/**
 * @jest-environment node
 *
 * Patient Intake v1.1, PR 1: the pharmacy ships to the address the order
 * was signed with.
 *
 * Before, orders kept only shipping_state_snapshot, and every adapter
 * read the patient's LIVE address at submission time: a patient who moved
 * (or an address corrected for a later order) re-routed an order already
 * signed and paid. Now signing freezes line 1, line 2, city and zip on the
 * order (with shipping_state_snapshot as its state, and
 * shipping_address_snapshot_at as when). Tier 1, Tier 2 and the Tier 4
 * fax PDF read that snapshot, falling back to the patient's address only
 * for an order signed before the snapshot existed.
 *
 * No network: fetch, the Vault, Playwright, Documo and the PDF builder
 * are mocked.
 */

import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const pdfMock = jest.fn()
const flowValues: Array<Record<string, string>> = []

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/documo/client', () => ({ sendFax: jest.fn() }))
jest.mock('@/lib/adapters/vault', () => ({
  getVaultSecret: async () => 'secret',
  buildAuthHeaders: async () => ({ Authorization: 'Bearer secret' }),
}))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: async () => ({ success: true, wasAlreadyTransitioned: false }) }))
jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: async () => undefined,
  buildAdapterFailureAlert: () => ({ text: '' }),
  buildSubmissionFailedAlert: () => ({ text: '' }),
}))
jest.mock('../prescription-pdf', () => ({
  buildPrescriptionPdfBytes: (d: unknown) => { pdfMock(d); throw new Error('stop after the PDF data is built') },
}))
jest.mock('playwright', () => ({
  chromium: {
    launch: async () => ({
      newContext: async () => ({ newPage: async () => ({ screenshot: async () => Buffer.from(''), goto: async () => undefined }) }),
      close: async () => undefined,
    }),
  },
}))
jest.mock('@/lib/playwright/config', () => ({
  getBrowserLaunchOptions: () => ({}),
  getBrowserContextOptions: () => ({}),
  SCREENSHOT_BUCKET: 'screenshots',
}))
jest.mock('@/lib/adapters/portal-flow-executor', () => ({
  executeFlow: async (_page: unknown, _steps: unknown, _creds: unknown, values: Record<string, string>) => {
    if (Object.keys(values).length === 0) return []        // login
    flowValues.push(values)
    throw new Error('stop after the portal fields are built')
  },
}))

import { shippingAddressFor } from '../shipping-address'
import { submitTier1Api } from '../tier1-api'
import { submitTier2Portal } from '../tier2-portal'
import { submitTier4Fax } from '../tier4-fax'

const fetchMock = jest.fn()
beforeAll(() => {
  (global as { fetch: unknown }).fetch = fetchMock
  process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true'
})
afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })

beforeEach(() => {
  pdfMock.mockReset()
  flowValues.length = 0
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'ext-1' }), text: async () => '{"id":"ext-1"}' })
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

// The patient has since moved to Austin. The order was signed for Dallas.
const LIVE = { address_line1: '1 Old Rd', address_line2: null, city: 'Austin', state: 'TX', zip: '78701' }
const SNAPSHOT = {
  shipping_address_line1_snapshot: '500 New St',
  shipping_address_line2_snapshot: 'Apt 4',
  shipping_city_snapshot:          'Dallas',
  shipping_zip_snapshot:           '75201',
  shipping_state_snapshot:         'TX',
  shipping_address_snapshot_at:    '2026-10-06T15:00:00Z',
}
const BEFORE_SNAPSHOTS = {
  shipping_address_line1_snapshot: null, shipping_address_line2_snapshot: null, shipping_city_snapshot: null,
  shipping_zip_snapshot: null, shipping_state_snapshot: 'TX', shipping_address_snapshot_at: null,
}

const ORDER = {
  order_id: 'o-1', order_number: 'CMP-1', status: 'PAID_PROCESSING',
  pharmacy_id: 'ph-1', clinic_id: 'c-1', provider_id: 'pr-1', patient_id: 'pt-1',
  medication_snapshot: { medication_name: 'Semaglutide' }, provider_npi_snapshot: '1234567890',
  quantity: 1, sig_text: 'Inject weekly', fax_attempt_count: 0, created_at: '2026-10-01T00:00:00Z', locked_at: '2026-10-06T15:00:00Z',
}
const PATIENT = { first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', allergies: [], nkda: true, ...LIVE }

function world(order: Record<string, unknown>, tier: string): Script {
  return c => {
    switch (c.table) {
      case 'orders':    return { data: { ...ORDER, ...order } }
      case 'providers': return { data: { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' } }
      case 'patients':  return { data: PATIENT }
      case 'clinics':   return { data: { name: 'Sunrise Functional Medicine' } }
      case 'pharmacies': return { data: { integration_tier: tier, name: 'Acme', slug: 'acme', fax_number: '+15125550100' } }
      case 'pharmacy_api_configs':
        return { data: { config_id: 'cfg-1', base_url: 'https://pharm.test', vault_secret_id: 'v-1', endpoints: null, auth_type: 'api_key', payload_transformer: null, response_parser: null, rate_limit_rpm: null, rate_limit_concurrent: null, timeout_ms: 1000 } }
      case 'pharmacy_portal_configs':
        return { data: { config_id: 'pc-1', portal_url: 'https://portal.test', portal_type: 'TIER_2_PORTAL', username_vault_id: 'u', password_vault_id: 'p', login_flow: [{ action: 'goto' }], submit_flow: [{ action: 'fill' }], status_check_flow: null, selectors: null, poll_interval_minutes: null, screenshot_on_error: false } }
      case 'adapter_submissions':
        return c.op === 'insert' ? { data: { submission_id: 'sub-1' } } : { data: null, count: 0 }
      default: return undefined
    }
  }
}

describe('shippingAddressFor', () => {
  it('an order signed with a snapshot ships to the snapshot, whatever the patient has now', () => {
    expect(shippingAddressFor(SNAPSHOT, LIVE)).toEqual({ line1: '500 New St', line2: 'Apt 4', city: 'Dallas', state: 'TX', zip: '75201' })
  })
  it('a snapshot taken for a patient with no street on file stays empty; it does not borrow today\'s address', () => {
    const empty = { ...SNAPSHOT, shipping_address_line1_snapshot: null, shipping_address_line2_snapshot: null, shipping_city_snapshot: null, shipping_zip_snapshot: null }
    expect(shippingAddressFor(empty, LIVE)).toEqual({ line1: null, line2: null, city: null, state: 'TX', zip: null })
  })
  it('an order signed before snapshots existed falls back to the patient\'s address', () => {
    expect(shippingAddressFor(BEFORE_SNAPSHOTS, LIVE)).toEqual({ line1: '1 Old Rd', line2: null, city: 'Austin', state: 'TX', zip: '78701' })
  })
})

describe('Tier 1 API: the submission carries the signed address', () => {
  it('snapshot', async () => {
    db = scriptedDb(world(SNAPSHOT, 'TIER_1_API'))
    await submitTier1Api('o-1', 'ph-1').catch(() => undefined)
    expect(fetchMock).toHaveBeenCalled()
    const body = String((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(body).toContain('500 New St')
    expect(body).toContain('Dallas')
    expect(body).not.toContain('1 Old Rd')
  })
  it('before snapshots: the patient\'s address', async () => {
    db = scriptedDb(world(BEFORE_SNAPSHOTS, 'TIER_1_API'))
    await submitTier1Api('o-1', 'ph-1').catch(() => undefined)
    expect(String((fetchMock.mock.calls[0]![1] as { body: string }).body)).toContain('1 Old Rd')
  })
})

describe('Tier 2 portal: the form is filled with the signed address', () => {
  it('snapshot', async () => {
    db = scriptedDb(world(SNAPSHOT, 'TIER_2_PORTAL'))
    await submitTier2Portal('o-1', 'ph-1').catch(() => undefined)
    expect(flowValues[0]).toEqual(expect.objectContaining({
      patientAddress1: '500 New St', patientAddress2: 'Apt 4', patientCity: 'Dallas', patientState: 'TX', patientZip: '75201',
    }))
  })
  it('before snapshots: the patient\'s address', async () => {
    db = scriptedDb(world(BEFORE_SNAPSHOTS, 'TIER_2_PORTAL'))
    await submitTier2Portal('o-1', 'ph-1').catch(() => undefined)
    expect(flowValues[0]).toEqual(expect.objectContaining({ patientAddress1: '1 Old Rd', patientCity: 'Austin' }))
  })
})

describe('Tier 4 fax: the Rx PDF prints the signed address', () => {
  it('snapshot', async () => {
    db = scriptedDb(world(SNAPSHOT, 'TIER_4_FAX'))
    await submitTier4Fax('o-1').catch(() => undefined)
    expect(pdfMock).toHaveBeenCalledWith(expect.objectContaining({
      patientAddressLine1: '500 New St', patientAddressLine2: 'Apt 4', patientCity: 'Dallas', patientState: 'TX', patientZip: '75201',
    }))
  })
  it('before snapshots: the patient\'s address', async () => {
    db = scriptedDb(world(BEFORE_SNAPSHOTS, 'TIER_4_FAX'))
    await submitTier4Fax('o-1').catch(() => undefined)
    expect(pdfMock).toHaveBeenCalledWith(expect.objectContaining({ patientAddressLine1: '1 Old Rd', patientCity: 'Austin' }))
  })
})
