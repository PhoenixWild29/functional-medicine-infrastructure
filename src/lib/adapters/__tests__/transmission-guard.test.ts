/**
 * @jest-environment node
 *
 * HIPAA B6, B7, B17 at the adapters: every adapter refuses, before it reads
 * a credential or calls anything, an order that is not signed, is in a
 * status nothing may be sent from, or no longer matches its signature; and
 * Tier 1 / Tier 2 refuse a pharmacy URL that is not https. An order signed
 * before signature binding is sent as before, with a log line.
 *
 * No network: fetch, the Vault, the portal browser and Documo are mocked.
 */

import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'
import { boundSignatureValue, canonicalSignedContent } from '@/lib/orders/signature-binding'

let db = scriptedDb(() => undefined)
const sendFaxMock = jest.fn()
const vaultMock = jest.fn()
const executeFlowMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/documo/client', () => ({ sendFax: (...a: unknown[]) => sendFaxMock(...a) }))
jest.mock('@/lib/adapters/vault', () => ({
  getVaultSecret: async (...a: unknown[]) => { vaultMock(...a); return 'secret' },
  buildAuthHeaders: async () => ({}),
}))
const launchMock = jest.fn()
jest.mock('@/lib/adapters/portal-flow-executor', () => ({ executeFlow: (...a: unknown[]) => executeFlowMock(...a) }))
jest.mock('playwright', () => ({ chromium: { launch: (...a: unknown[]) => launchMock(...a) } }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: async () => ({ success: true, wasAlreadyTransitioned: false }) }))

import {
  assertOrderTransmittable,
  isSecurePharmacyUrl,
  assertSecurePharmacyUrl,
  isTransmissionRefusedError,
  TRANSMISSION_REFUSAL_CODES,
} from '../transmission-guard'
import { submitTier4Fax } from '../tier4-fax'
import { submitTier1Api } from '../tier1-api'
import { submitTier2Portal } from '../tier2-portal'
import { ADAPTER_ERROR_CODES } from '@/lib/slack/client'
import { plainFailureReason, knownFailureCode } from '@/lib/orders/submission-failure'
import { validateOrdering } from '@/lib/pharmacy-onboarding/validate'

const fetchMock = jest.fn()
beforeAll(() => {
  process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true';
  (global as { fetch: unknown }).fetch = fetchMock
})
afterAll(() => { delete process.env['PHARMACY_SUBMISSIONS_ENABLED'] })
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const SIGNED_AT = '2026-10-25T14:03:07.123Z'
const DIGEST = 'c'.repeat(64)
const PATIENT = { first_name: 'Alex', last_name: 'Demo', date_of_birth: '1980-01-01', allergies: ['Sulfa'], nkda: false }

const BASE_ORDER = {
  order_id: 'o-1', order_number: 'CMP-1', status: 'SUBMISSION_PENDING', pharmacy_id: 'ph-1', clinic_id: 'c-1',
  provider_id: 'pr-1', patient_id: 'pt-1', formulation_id: 'f-1', catalog_item_id: null,
  medication_snapshot: { medication_name: 'Semaglutide 2.5 mg/mL', dea_schedule: 0 },
  pharmacy_snapshot: { pharmacy_id: 'ph-1', name: 'Acme' },
  provider_npi_snapshot: '1234567890', quantity: 1, sig_text: 'Inject weekly', sig_mode: 'standard',
  days_supply: 28, dispense_quantity: 1, dispense_unit: 'vial', refills: 0, substitution_allowed: true,
  syringe_option: 'none', shipping_type: 'standard', clinical_difference: 'Dose not available commercially',
  diagnosis_code: 'E66.9', diagnosis_text: 'Obesity', special_instructions: null,
  package_id: null, package_label: null, package_count: 1, titration_steps: [], cycle_on_days: null, cycle_off_days: null,
  fax_attempt_count: 0, created_at: '2026-10-01T00:00:00Z', locked_at: SIGNED_AT,
  shipping_state_snapshot: 'TX',
}

/** A properly signed (v2) order. */
function signed(over: Record<string, unknown> = {}) {
  const o = { ...BASE_ORDER, ...over }
  return { ...o, provider_signature_hash_snapshot: boundSignatureValue(DIGEST, SIGNED_AT, canonicalSignedContent(o, PATIENT)) }
}

let order: Record<string, unknown> = signed()
let apiBaseUrl = 'https://pharm.test'
let portalUrl = 'https://portal.pharm.test/login'

function world(more: Script = () => undefined): Script {
  return c => {
    const m = more(c)
    if (m) return m
    if (c.table === 'orders') return { data: order }
    if (c.table === 'formulations') return { data: { formulation_id: 'f-1', salt_forms: { ingredients: { dea_schedule: null } }, formulation_ingredients: [] } }
    if (c.table === 'pharmacies') return { data: { integration_tier: 'TIER_1_API', name: 'Acme', slug: 'acme', fax_number: '+15125550100' } }
    if (c.table === 'clinics') return { data: { name: 'Sunrise' } }
    if (c.table === 'providers') return { data: { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: null, license_state: 'TX' } }
    if (c.table === 'patients') return { data: PATIENT }
    if (c.table === 'pharmacy_api_configs') {
      return { data: { config_id: 'cfg-1', base_url: apiBaseUrl, vault_secret_id: 'v-1', endpoints: null, auth_type: 'api_key', payload_transformer: null, response_parser: null, rate_limit_rpm: null, rate_limit_concurrent: null, timeout_ms: 1000 } }
    }
    if (c.table === 'pharmacy_portal_configs') {
      return { data: { config_id: 'pcfg-1', portal_url: portalUrl, portal_type: 'generic', username_vault_id: 'u-1', password_vault_id: 'p-1', login_flow: [], submit_flow: [], status_check_flow: null, selectors: {}, poll_interval_minutes: 30, screenshot_on_error: false } }
    }
    if (c.table === 'adapter_submissions') return c.op === 'insert' ? { data: { submission_id: 'sub-1' } } : { data: null, count: 0 }
    return undefined
  }
}

beforeEach(() => {
  order = signed()
  apiBaseUrl = 'https://pharm.test'
  portalUrl = 'https://portal.pharm.test/login'
  db = scriptedDb(world())
  sendFaxMock.mockReset().mockResolvedValue({ faxId: 'fax-1' })
  vaultMock.mockReset()
  executeFlowMock.mockReset().mockResolvedValue({ success: true })
  launchMock.mockReset().mockRejectedValue(new Error('no browser in tests'))
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })
  errorSpy.mockClear()
  warnSpy.mockClear()
})

const logged = () => [...errorSpy.mock.calls, ...warnSpy.mock.calls].map(c => c.map(String).join(' ')).join('\n')

// ── The guard ────────────────────────────────────────────────

describe('assertOrderTransmittable', () => {
  const refusedWith = async (code: string) => {
    const err = await assertOrderTransmittable(db.client, 'o-1').then(() => null, (e: unknown) => e)
    expect(isTransmissionRefusedError(err)).toBe(true)
    expect((err as { code: string }).code).toBe(code)
  }

  it('a signed order whose content still matches its signature may be sent', async () => {
    await expect(assertOrderTransmittable(db.client, 'o-1')).resolves.toBe('bound')
  })

  it('B6: no locked_at, or no signature, is refused as unsigned', async () => {
    order = { ...signed(), locked_at: null }
    await refusedWith('unsigned_order')
    order = { ...signed(), provider_signature_hash_snapshot: null }
    await refusedWith('unsigned_order')
  })

  it('B6: only PAID_PROCESSING, SUBMISSION_PENDING and FAX_QUEUED may be sent from', async () => {
    for (const status of ['PAID_PROCESSING', 'SUBMISSION_PENDING', 'FAX_QUEUED']) {
      order = signed({ status })
      await expect(assertOrderTransmittable(db.client, 'o-1')).resolves.toBe('bound')
    }
    for (const status of ['DRAFT', 'AWAITING_PAYMENT', 'CANCELLED', 'REFUNDED', 'SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_ACKNOWLEDGED', 'SHIPPED']) {
      order = signed({ status })
      await refusedWith('order_not_submittable')
    }
  })

  it('B7: a change after signing is refused as a signature mismatch', async () => {
    order = { ...signed(), refills: 5 }
    await refusedWith('signature_mismatch')
    order = { ...signed(), sig_text: 'Inject daily' }
    await refusedWith('signature_mismatch')
    // The patient's allergies changed after signing.
    order = signed()
    db = scriptedDb(world(c => (c.table === 'patients' ? { data: { ...PATIENT, allergies: [], nkda: true } } : undefined)))
    await refusedWith('signature_mismatch')
  })

  it('B7: a malformed bound value is refused', async () => {
    order = { ...signed(), provider_signature_hash_snapshot: `v2:${DIGEST}:nothex` }
    await refusedWith('signature_mismatch')
  })

  it('B7: an order signed before binding (a bare digest) is sent, with a log line that it predates binding', async () => {
    order = { ...BASE_ORDER, provider_signature_hash_snapshot: DIGEST }
    await expect(assertOrderTransmittable(db.client, 'o-1')).resolves.toBe('legacy')
    expect(logged()).toMatch(/order=o-1 was signed before signature binding/)
  })

  it('a read that fails throws a plain error: nothing is sent blind', async () => {
    db = scriptedDb(world(c => (c.table === 'orders' ? { data: null, error: { message: 'connection reset' } } : undefined)))
    const err = await assertOrderTransmittable(db.client, 'o-1').then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isTransmissionRefusedError(err)).toBe(false)
  })

  it('refusal logs carry the order id and code, never content', async () => {
    order = { ...signed(), sig_text: 'Inject daily' }
    await assertOrderTransmittable(db.client, 'o-1').catch(() => undefined)
    const text = logged()
    expect(text).toMatch(/order=o-1 \| code=signature_mismatch/)
    for (const phi of ['Alex', 'Demo', 'Sulfa', 'Semaglutide', 'Inject', 'Obesity', 'E66.9']) expect(text).not.toContain(phi)
  })
})

// ── Every adapter refuses ────────────────────────────────────

describe('the adapters refuse before sending anything', () => {
  const cases: Array<[string, () => void, string]> = [
    ['unsigned', () => { order = { ...signed(), locked_at: null } }, 'unsigned_order'],
    ['not submittable', () => { order = signed({ status: 'AWAITING_PAYMENT' }) }, 'order_not_submittable'],
    ['changed after signing', () => { order = { ...signed(), quantity: 9 } }, 'signature_mismatch'],
  ]

  it.each(cases)('Tier 4 fax: %s', async (_n, setUp, code) => {
    setUp()
    await expect(submitTier4Fax('o-1')).rejects.toMatchObject({ name: 'TransmissionRefusedError', code })
    expect(sendFaxMock).not.toHaveBeenCalled()
    expect(db.to('adapter_submissions', 'insert')).toHaveLength(0)
  })

  it.each(cases)('Tier 1 API (and Tier 3 spec): %s', async (_n, setUp, code) => {
    setUp()
    await expect(submitTier1Api('o-1', 'ph-1')).rejects.toMatchObject({ code })
    await expect(submitTier1Api('o-1', 'ph-1', 'TIER_3_SPEC')).rejects.toMatchObject({ code })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vaultMock).not.toHaveBeenCalled()
  })

  it.each(cases)('Tier 2 portal: %s', async (_n, setUp, code) => {
    setUp()
    await expect(submitTier2Portal('o-1', 'ph-1')).rejects.toMatchObject({ code })
    expect(executeFlowMock).not.toHaveBeenCalled()
    expect(launchMock).not.toHaveBeenCalled()
    expect(vaultMock).not.toHaveBeenCalled()
  })

  it('Tier 4 fax goes on to build the fax for a signed, matching order', async () => {
    // The harness has no storage, so the build stops at the PDF upload,
    // after the guard: not a refusal.
    const err = await submitTier4Fax('o-1').then(() => null, (e: unknown) => e)
    expect(isTransmissionRefusedError(err)).toBe(false)
    expect(db.to('clinics', 'select').length).toBeGreaterThan(0)
  })
})

// ── B17: https only ──────────────────────────────────────────

describe('B17: Tier 1 and Tier 2 pharmacy URLs must be https', () => {
  it('https passes; http, other schemes and junk do not', () => {
    expect(isSecurePharmacyUrl('https://pharm.test/api')).toBe(true)
    for (const bad of ['http://pharm.test/api', 'ftp://pharm.test', 'pharm.test', '', null, undefined, 'https://', 'javascript:alert(1)']) {
      expect(isSecurePharmacyUrl(bad)).toBe(false)
    }
  })

  it('http to localhost only in tests', () => {
    expect(process.env['NODE_ENV']).toBe('test')
    expect(isSecurePharmacyUrl('http://localhost:4010')).toBe(true)
    expect(isSecurePharmacyUrl('http://127.0.0.1:4010/orders')).toBe(true)
    expect(isSecurePharmacyUrl('http://localhost.evil.test')).toBe(false)
    const env = process.env as Record<string, string | undefined>
    const was = env['NODE_ENV']
    env['NODE_ENV'] = 'production'
    try {
      expect(isSecurePharmacyUrl('http://localhost:4010')).toBe(false)
    } finally {
      env['NODE_ENV'] = was
    }
  })

  it('assertSecurePharmacyUrl throws insecure_pharmacy_url and does not log the URL', () => {
    expect(() => assertSecurePharmacyUrl('http://pharm.test', { orderId: 'o-1', pharmacyId: 'ph-1', what: 'API base URL' }))
      .toThrow(expect.objectContaining({ code: 'insecure_pharmacy_url' }))
    expect(logged()).not.toContain('http://pharm.test')
  })

  it('Tier 1 refuses an http base_url before reading the credential or calling anything', async () => {
    apiBaseUrl = 'http://pharm.test'
    await expect(submitTier1Api('o-1', 'ph-1')).rejects.toMatchObject({ code: 'insecure_pharmacy_url' })
    expect(vaultMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.to('adapter_submissions', 'insert')).toHaveLength(0)
  })

  it('Tier 2 refuses an http portal_url before reading credentials or opening the portal', async () => {
    portalUrl = 'http://portal.pharm.test/login'
    await expect(submitTier2Portal('o-1', 'ph-1')).rejects.toMatchObject({ code: 'insecure_pharmacy_url' })
    expect(vaultMock).not.toHaveBeenCalled()
    expect(executeFlowMock).not.toHaveBeenCalled()
    expect(launchMock).not.toHaveBeenCalled()
    expect(db.to('adapter_submissions', 'insert')).toHaveLength(0)
  })

  it('Tier 2 refuses a portal flow that navigates to an http page', async () => {
    db = scriptedDb(world(c => (c.table === 'pharmacy_portal_configs'
      ? { data: { config_id: 'pcfg-1', portal_url: portalUrl, portal_type: 'generic', username_vault_id: 'u-1', password_vault_id: 'p-1', login_flow: [{ action: 'navigate', url: 'http://portal.pharm.test/login' }], submit_flow: [], status_check_flow: null, selectors: {}, poll_interval_minutes: 30, screenshot_on_error: false } }
      : undefined)))
    await expect(submitTier2Portal('o-1', 'ph-1')).rejects.toMatchObject({ code: 'insecure_pharmacy_url' })
    expect(vaultMock).not.toHaveBeenCalled()
    expect(launchMock).not.toHaveBeenCalled()
  })

  it('at pharmacy setup save: an http API base URL or portal URL is refused', () => {
    expect(validateOrdering({ method: 'api', api: { baseUrl: 'http://insecure.example', authType: 'api_key', apiKey: 'k' } }).ok).toBe(false)
    expect(validateOrdering({ method: 'portal', portal: { portalUrl: 'http://insecure.example/login', username: 'u', password: 'p' } }).ok).toBe(false)
    expect(validateOrdering({ method: 'portal', portal: { portalUrl: 'https://secure.example/login', username: 'u', password: 'p' } }).ok).toBe(true)
  })
})

// ── Ops see a reason ─────────────────────────────────────────

describe('the refusal codes reach ops in plain words', () => {
  it('each code is a known failure code with its own plain reason, and may be sent in an alert', () => {
    for (const code of TRANSMISSION_REFUSAL_CODES) {
      expect(knownFailureCode(code)).toBe(code)
      expect(plainFailureReason(code)).not.toBe(plainFailureReason(null))
      expect((ADAPTER_ERROR_CODES as readonly string[]).includes(code)).toBe(true)
    }
    expect(plainFailureReason('signature_mismatch')).toBe('the prescription changed after it was signed')
    expect(plainFailureReason('unsigned_order')).toBe('the prescription has not been signed')
  })
})
