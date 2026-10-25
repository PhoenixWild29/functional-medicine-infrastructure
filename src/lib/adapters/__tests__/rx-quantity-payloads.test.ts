/**
 * @jest-environment node
 *
 * Requirement 3 (coverage audit, D-2026-10-25-05): every order stored
 * quantity 1, so the fax printed "Quantity: 1" above "Dispense: 9.6 mL
 * (2 x 5 mL vials)" and every adapter sent 1. Each submission path now
 * sends the dispense count (dispenseCount in lib/orders/rx-details.ts):
 *
 *   Tier 1 API, canonical / Tier 3 pass-through  quantity
 *   Tier 1 Vios                                  medication.quantity
 *   Tier 1 LifeFile                              prescription.drug.quantity
 *   Tier 1 MediVera                              RxInfo.Qty
 *   Tier 2 portal                                {quantity}
 *   Tier 4 fax                                   "Quantity: N" on the Rx PDF
 *
 * Every field sits beside the payload's own volume fields (dispense
 * quantity + unit, package label + count), so it is the count of what is
 * handed over: packages when the line has one, units when the dispense is
 * counted (capsules), otherwise 1 fill.
 *
 * The rows below are stored with quantity 1, as every row written before
 * this fix was: the count comes from their package and dispense columns.
 *
 * No network: fetch, the Vault, Playwright, Documo and the PDF are mocked.
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
  ...jest.requireActual('../prescription-pdf'),
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

// 80 units weekly for 90 days of Semaglutide 5 mg/mL = 9.6 mL → 2 × 5 mL vials.
const TWO_VIALS   = { dispense_quantity: 9.6, dispense_unit: 'mL', package_label: '5 mL vial', package_count: 2 }
const CAPSULES_30 = { dispense_quantity: 30, dispense_unit: 'capsule', package_label: null, package_count: 1 }
const ML_NO_PKG   = { dispense_quantity: 9.6, dispense_unit: 'mL', package_label: null, package_count: 1 }

const ORDER = {
  order_id: 'o-1', order_number: 'CMP-1', status: 'PAID_PROCESSING',
  pharmacy_id: 'ph-1', clinic_id: 'c-1', provider_id: 'pr-1', patient_id: 'pt-1', formulation_id: 'f-sema', catalog_item_id: null,
  medication_snapshot: { medication_name: 'Semaglutide' }, provider_npi_snapshot: '1234567890',
  // Stored as every row before the fix was.
  quantity: 1, sig_text: 'Inject weekly', fax_attempt_count: 0, created_at: '2026-10-01T00:00:00Z', locked_at: '2026-10-06T15:00:00Z',
  shipping_address_line1_snapshot: '500 New St', shipping_address_line2_snapshot: null, shipping_city_snapshot: 'Dallas',
  shipping_zip_snapshot: '75201', shipping_state_snapshot: 'TX', shipping_address_snapshot_at: '2026-10-06T15:00:00Z',
}
const PATIENT = { first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', allergies: [], nkda: true, address_line1: '1 Old Rd', address_line2: null, city: 'Austin', state: 'TX', zip: '78701' }

function world(order: Record<string, unknown>, tier: string, transformer: string | null = null): Script {
  return c => {
    switch (c.table) {
      case 'orders':    return { data: { ...ORDER, ...order } }
      case 'providers': return { data: { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' } }
      case 'patients':  return { data: PATIENT }
      case 'clinics':   return { data: { name: 'Sunrise Functional Medicine' } }
      case 'formulations': return { data: { formulation_id: 'f-sema', salt_forms: { ingredients: { dea_schedule: null } }, formulation_ingredients: [] } }
      case 'pharmacies': return { data: { integration_tier: tier, name: 'Acme', slug: 'acme', fax_number: '+15125550100' } }
      case 'pharmacy_api_configs':
        return { data: { config_id: 'cfg-1', base_url: 'https://pharm.test', vault_secret_id: 'v-1', endpoints: null, auth_type: 'api_key', payload_transformer: transformer, response_parser: null, rate_limit_rpm: null, rate_limit_concurrent: null, timeout_ms: 1000 } }
      case 'pharmacy_portal_configs':
        return { data: { config_id: 'pc-1', portal_url: 'https://portal.test', portal_type: 'TIER_2_PORTAL', username_vault_id: 'u', password_vault_id: 'p', login_flow: [{ action: 'goto' }], submit_flow: [{ action: 'fill' }], status_check_flow: null, selectors: null, poll_interval_minutes: null, screenshot_on_error: false } }
      case 'adapter_submissions':
        return c.op === 'insert' ? { data: { submission_id: 'sub-1' } } : { data: null, count: 0 }
      default: return undefined
    }
  }
}

async function tier1Body(order: Record<string, unknown>, transformer: string | null): Promise<Record<string, unknown>> {
  db = scriptedDb(world(order, 'TIER_1_API', transformer))
  await submitTier1Api('o-1', 'ph-1').catch(() => undefined)
  expect(fetchMock).toHaveBeenCalled()
  return JSON.parse(String((fetchMock.mock.calls[0]![1] as { body: string }).body)) as Record<string, unknown>
}

describe.each([
  ['2 × 5 mL vials', TWO_VIALS, 2],
  ['30 capsules, no package', CAPSULES_30, 30],
  ['9.6 mL, no package', ML_NO_PKG, 1],
])('%s', (_name, columns, expected) => {
  it(`Tier 1 canonical / Tier 3 pass-through: quantity ${expected}`, async () => {
    expect((await tier1Body(columns, null))['quantity']).toBe(expected)
  })

  it(`Tier 1 Vios: medication.quantity ${expected}`, async () => {
    const body = await tier1Body(columns, 'transformViosPayload') as { medication: Record<string, unknown> }
    expect(body.medication['quantity']).toBe(expected)
  })

  it(`Tier 1 LifeFile: prescription.drug.quantity ${expected}`, async () => {
    const body = await tier1Body(columns, 'transformLifeFilePayload') as { prescription: { drug: Record<string, unknown> } }
    expect(body.prescription.drug['quantity']).toBe(expected)
  })

  it(`Tier 1 MediVera: RxInfo.Qty ${expected}`, async () => {
    const body = await tier1Body(columns, 'transformMediVeraPayload') as { RxInfo: Record<string, unknown> }
    expect(body.RxInfo['Qty']).toBe(expected)
  })

  it(`Tier 2 portal: {quantity} "${expected}"`, async () => {
    db = scriptedDb(world(columns, 'TIER_2_PORTAL'))
    await submitTier2Portal('o-1', 'ph-1').catch(() => undefined)
    expect(flowValues[0]).toEqual(expect.objectContaining({ quantity: String(expected) }))
  })

  it(`Tier 4 fax: the Rx PDF gets quantity ${expected}`, async () => {
    db = scriptedDb(world(columns, 'TIER_4_FAX'))
    await submitTier4Fax('o-1').catch(() => undefined)
    expect(pdfMock).toHaveBeenCalledWith(expect.objectContaining({ quantity: expected }))
  })
})

describe('Rx PDF text', () => {
  const { buildPrescriptionPdfBytes } = jest.requireActual('../prescription-pdf') as typeof import('../prescription-pdf')
  it('prints "Quantity: 2" with "Dispense: 9.6 mL (2 x 5 mL vials)"', () => {
    const text = new TextDecoder().decode(buildPrescriptionPdfBytes({
      providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890', providerDea: null, providerLicenseState: 'TX',
      patientFirstName: 'Alex', patientLastName: 'Demo', patientDateOfBirth: '1985-06-15',
      patientAddressLine1: '500 New St', patientAddressLine2: null, patientCity: 'Dallas', patientState: 'TX', patientZip: '75201',
      medicationName: 'Semaglutide Injectable 5 mg/mL', medicationForm: 'Injectable Solution', medicationDose: '5 mg/mL',
      quantity: 2, sigText: 'Inject 80 units subcutaneously once weekly for 90 days',
      daysSupply: 90, dispenseQuantity: 9.6, dispenseUnit: 'mL', packageLabel: '5 mL vial', packageCount: 2,
      orderNumber: 'CMP-1001', orderDate: '2026-09-15T00:00:00Z', clinicName: 'Sunrise Functional Medicine', pharmacyName: 'Strive Pharmacy',
    }))
    expect(text).toContain('Quantity: 2')
    expect(text).not.toContain('Quantity: 1')
    expect(text).toContain('Dispense: 9.6 mL \\(2 x 5 mL vials\\)')
  })
})
