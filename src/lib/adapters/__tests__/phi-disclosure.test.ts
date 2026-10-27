/**
 * @jest-environment node
 *
 * C-2026-10-25-17 (B14/B15): every send of PHI outside the app from the
 * pharmacy adapters is a disclosure, logged with logPhiDisclosure (action
 * 'export') right BEFORE the send, with the system as the actor (an
 * adapter acts for the platform) and the order, patient and clinic ids.
 * It is FAIL-CLOSED: when the row cannot be written, nothing is sent.
 *
 *   - Tier 1 API (and Tier 3 spec, the same path): pharmacy_disclosure
 *     before each attempt's POST. Not recorded: that attempt fails as a
 *     transient error (DISCLOSURE_NOT_RECORDED) and is retried with the
 *     adapter's backoff; all three not recorded is 'exhausted', as for a
 *     network error.
 *   - Tier 2 portal: pharmacy_disclosure before the submit flow fills the
 *     form. Not recorded: the form is not filled; portal_error.
 *   - Tier 2 portal, the confirmation screenshot sent to OpenAI for a
 *     score: ai_portal_screenshot before the call. Not recorded: no call,
 *     no score, manual review (the low-confidence path).
 *   - Tier 4 fax: pharmacy_disclosure before the Documo send. Not
 *     recorded: not sent; the adapter's failure (markFailed, then throws).
 *
 * No network: fetch, the Vault, Playwright, Documo and the PDF builder
 * are mocked.
 */

import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

let db = scriptedDb(() => undefined)
const storage = {
  from: () => ({
    upload: async () => ({ error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.test/signed' }, error: null }),
  }),
}
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ ...(db.client as object), storage }) }))
const sendFaxMock = jest.fn()
jest.mock('@/lib/documo/client', () => ({ sendFax: (...a: unknown[]) => sendFaxMock(...a) }))
jest.mock('@/lib/adapters/vault', () => ({
  getVaultSecret: async () => 'secret',
  buildAuthHeaders: async () => ({ Authorization: 'Bearer secret' }),
}))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: async () => ({ success: true, wasAlreadyTransitioned: false }) }))
jest.mock('../prescription-pdf', () => ({ buildPrescriptionPdfBytes: () => new Uint8Array([1, 2, 3]) }))
jest.mock('playwright', () => ({
  chromium: {
    launch: async () => ({
      newContext: async () => ({
        // signed-order-freeze (HIPAA B17): the portal adapter holds the
        // browser context to https (context.route) and reads the page's url().
        route:   async () => undefined,
        newPage: async () => ({
          screenshot: async () => Buffer.from('png'),
          goto:       async () => undefined,
          url:        () => 'https://portal.test/',
        }),
      }),
      close: async () => undefined,
    }),
  },
}))
jest.mock('@/lib/playwright/config', () => ({
  getBrowserLaunchOptions: () => ({}),
  getBrowserContextOptions: () => ({}),
  SCREENSHOT_BUCKET: 'screenshots',
}))
const submitFlowMock = jest.fn()
jest.mock('@/lib/adapters/portal-flow-executor', () => ({
  executeFlow: async (_page: unknown, _steps: unknown, _creds: unknown, values: Record<string, string>) => {
    if (Object.keys(values).length === 0) return []        // login
    submitFlowMock(values)
    return [{ action: 'screenshot', screenshotBytes: Buffer.from('confirmation') }]
  },
}))

// signed-order-freeze: every adapter reads the order through
// loadTransmittableOrder (signature binding verified). These tests are about
// the disclosure rows, so the file's order comes back as verified.
jest.mock('@/lib/adapters/transmission-guard', () => {
  const actual = jest.requireActual('@/lib/adapters/transmission-guard')
  return {
    ...actual,
    loadTransmittableOrder: jest.fn(async () => ({
      order: ORDER,
      patient: PATIENT,
      prescriber: { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' },
      signature: 'bound',
    })),
  }
})

import { logPhiDisclosure, systemActor } from '@/lib/audit/phi-access'
import { submitTier1Api } from '../tier1-api'
import { submitTier2Portal } from '../tier2-portal'
import { submitTier4Fax } from '../tier4-fax'

const disclosure = jest.mocked(logPhiDisclosure)
const fetchMock = jest.fn()
const PHARMACY_RESPONSE = { ok: true, status: 200, json: async () => ({ orderId: 'ext-1', status: 'accepted' }), text: async () => '' }
const OPENAI_RESPONSE = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"is_confirmation": true, "confidence": 0.97}' } }] }) }

beforeAll(() => {
  (global as { fetch: unknown }).fetch = fetchMock
  process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true'
  process.env['OPENAI_API_KEY'] = 'sk-test'
})
afterAll(() => {
  delete process.env['PHARMACY_SUBMISSIONS_ENABLED']
  delete process.env['OPENAI_API_KEY']
})

beforeEach(() => {
  disclosure.mockClear()
  sendFaxMock.mockReset().mockResolvedValue({ faxId: 'fax-1' })
  submitFlowMock.mockReset()
  fetchMock.mockReset().mockImplementation(async (url: string) => (String(url).includes('openai.com') ? OPENAI_RESPONSE : PHARMACY_RESPONSE))
  delete process.env['DOCUMO_ENABLED']
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
  // The Tier 1 retry backoff (5 s, 15 s) runs at once.
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0 }) as unknown as typeof setTimeout)
})
afterEach(() => jest.restoreAllMocks())

const ORDER = {
  order_id: 'o-1', order_number: 'CMP-1', status: 'SUBMISSION_PENDING',
  pharmacy_id: 'ph-1', clinic_id: 'c-1', provider_id: 'pr-1', patient_id: 'pt-1', formulation_id: 'f-sema', catalog_item_id: null,
  medication_snapshot: { medication_name: 'Semaglutide' }, provider_npi_snapshot: '1234567890',
  quantity: 1, sig_text: 'Inject weekly', fax_attempt_count: 0, created_at: '2026-10-01T00:00:00Z', locked_at: '2026-10-06T15:00:00Z',
  shipping_state_snapshot: 'TX',
}
const PATIENT = { first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', allergies: [], nkda: true, address_line1: '1 Main', address_line2: null, city: 'Austin', state: 'TX', zip: '78701' }

function world(tier: string): Script {
  return c => {
    switch (c.table) {
      case 'orders':    return c.op === 'select' ? { data: ORDER } : undefined
      case 'providers': return { data: { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' } }
      case 'patients':  return { data: PATIENT }
      case 'clinics':   return { data: { name: 'Sunrise Functional Medicine' } }
      case 'formulations': return { data: { formulation_id: 'f-sema', salt_forms: { ingredients: { dea_schedule: null } }, formulation_ingredients: [] } }
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

const pharmacyFetches = () => fetchMock.mock.calls.filter(c => String(c[0]).startsWith('https://pharm.test'))
const openAiFetches = () => fetchMock.mock.calls.filter(c => String(c[0]).includes('openai.com'))
const failedWith = (code: string) => db.to('adapter_submissions', 'update').filter(c => (c.payload as Record<string, unknown>)['error_code'] === code)

const PHARMACY_DISCLOSURE = {
  actor: systemActor('c-1'), resource: 'pharmacy_disclosure', orderId: 'o-1', patientId: 'pt-1', clinicId: 'c-1',
}

describe('Tier 1 API', () => {
  beforeEach(() => { db = scriptedDb(world('TIER_1_API')) })

  it('one pharmacy_disclosure before the POST to the pharmacy', async () => {
    await submitTier1Api('o-1', 'ph-1')
    expect(disclosure).toHaveBeenCalledTimes(1)
    expect(disclosure).toHaveBeenCalledWith(expect.objectContaining({ ...PHARMACY_DISCLOSURE, route: '/adapters/tier1-api' }))
    expect(pharmacyFetches()).toHaveLength(1)
    expect(disclosure.mock.invocationCallOrder[0]!).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!)
  })

  it('Tier 3 spec (the same path) is recorded under its own route', async () => {
    db = scriptedDb(world('TIER_3_SPEC'))
    await submitTier1Api('o-1', 'ph-1', 'TIER_3_SPEC')
    expect(disclosure).toHaveBeenCalledWith(expect.objectContaining({ ...PHARMACY_DISCLOSURE, route: '/adapters/tier3-spec' }))
  })

  it('not recorded once: that attempt is not sent and fails as transient; the retry records and sends', async () => {
    disclosure.mockResolvedValueOnce(false)
    const result = await submitTier1Api('o-1', 'ph-1')
    expect(disclosure).toHaveBeenCalledTimes(2)
    expect(pharmacyFetches()).toHaveLength(1)
    expect(result.attemptsMade).toBe(2)
    expect(failedWith('DISCLOSURE_NOT_RECORDED')).toHaveLength(1)
  })

  it('never recorded: nothing is sent; exhausted after 3 attempts, as for a network error', async () => {
    disclosure.mockResolvedValue(false)
    const result = await submitTier1Api('o-1', 'ph-1')
    disclosure.mockResolvedValue(true)
    expect(pharmacyFetches()).toHaveLength(0)
    expect(result).toEqual(expect.objectContaining({ outcome: 'exhausted', attemptsMade: 3, errorCode: 'DISCLOSURE_NOT_RECORDED' }))
  })
})

describe('Tier 2 portal', () => {
  beforeEach(() => { db = scriptedDb(world('TIER_2_PORTAL')) })

  it('a pharmacy_disclosure before the form is filled, and an ai_portal_screenshot before the screenshot goes to OpenAI', async () => {
    const result = await submitTier2Portal('o-1', 'ph-1')
    expect(result.outcome).toBe('acknowledged')
    expect(disclosure).toHaveBeenCalledTimes(2)
    expect(disclosure.mock.calls[0]![0]).toEqual(expect.objectContaining({ ...PHARMACY_DISCLOSURE, route: '/adapters/tier2-portal' }))
    expect(disclosure.mock.calls[1]![0]).toEqual(expect.objectContaining({
      actor: systemActor('c-1'), resource: 'ai_portal_screenshot', route: '/adapters/tier2-portal', orderId: 'o-1', patientId: 'pt-1', clinicId: 'c-1',
    }))
    expect(submitFlowMock).toHaveBeenCalledTimes(1)
    expect(disclosure.mock.invocationCallOrder[0]!).toBeLessThan(submitFlowMock.mock.invocationCallOrder[0]!)
    expect(disclosure.mock.invocationCallOrder[1]!).toBeLessThan(fetchMock.mock.invocationCallOrder[0]!)
  })

  it('the pharmacy disclosure not recorded: the form is not filled; portal_error (cascades like any portal failure)', async () => {
    disclosure.mockResolvedValueOnce(false)
    const result = await submitTier2Portal('o-1', 'ph-1')
    expect(result.outcome).toBe('portal_error')
    expect(result.errorCode).toBe('DISCLOSURE_NOT_RECORDED')
    expect(submitFlowMock).not.toHaveBeenCalled()
    expect(openAiFetches()).toHaveLength(0)
  })

  it('the screenshot disclosure not recorded: nothing sent to OpenAI; scored 0 (as an unreadable answer), manual review', async () => {
    disclosure.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const result = await submitTier2Portal('o-1', 'ph-1')
    expect(openAiFetches()).toHaveLength(0)
    expect(submitFlowMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual(expect.objectContaining({ outcome: 'manual_review', aiConfidenceScore: 0 }))
    const review = db.to('adapter_submissions', 'update').find(c => (c.payload as Record<string, unknown>)['status'] === 'MANUAL_REVIEW')
    expect(review?.payload).toEqual(expect.objectContaining({ ai_confidence_score: 0 }))
  })
})

describe('Tier 4 fax', () => {
  beforeEach(() => { db = scriptedDb(world('TIER_4_FAX')) })

  it('one pharmacy_disclosure before the Documo send', async () => {
    await submitTier4Fax('o-1')
    expect(disclosure).toHaveBeenCalledTimes(1)
    expect(disclosure).toHaveBeenCalledWith(expect.objectContaining({ ...PHARMACY_DISCLOSURE, route: '/adapters/tier4-fax' }))
    expect(sendFaxMock).toHaveBeenCalledTimes(1)
    expect(disclosure.mock.invocationCallOrder[0]!).toBeLessThan(sendFaxMock.mock.invocationCallOrder[0]!)
  })

  it('not recorded: the fax is not sent; the attempt fails and the adapter throws (the caller\'s retryable failure)', async () => {
    disclosure.mockResolvedValueOnce(false)
    await expect(submitTier4Fax('o-1')).rejects.toThrow(/could not be recorded/)
    expect(sendFaxMock).not.toHaveBeenCalled()
    expect(failedWith('fax_submission_error')).toHaveLength(1)
    // The order is not touched: no fax id, no attempt counted.
    expect(db.to('orders', 'update')).toHaveLength(0)
  })

  it('DOCUMO_ENABLED=false (nothing leaves the platform): no disclosure', async () => {
    process.env['DOCUMO_ENABLED'] = 'false'
    await submitTier4Fax('o-1')
    expect(sendFaxMock).not.toHaveBeenCalled()
    expect(disclosure).not.toHaveBeenCalled()
  })
})
