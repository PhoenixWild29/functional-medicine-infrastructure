/**
 * @jest-environment node
 *
 * HIPAA B6, B7, B17 at the adapters, after B's review (T1-T4, T6):
 * - every adapter refuses, before it reads a credential or calls anything,
 *   an order that is not signed, is in a status nothing may be sent from,
 *   no longer matches its keyed signature (T1), was forged with a bare
 *   64-hex "legacy" value (T1), is going to a pharmacy other than the one
 *   signed for without the ops reroute's proof (T2), or whose patient's
 *   allergies changed after signing (T6);
 * - with no binding key in production, nothing is sent (T1);
 * - what is sent is the verified row (T3) and the snapshots taken at
 *   signing, not live patient or prescriber rows (T2);
 * - Tier 1 refuses an http base_url and never follows a redirect (T4);
 *   Tier 2 refuses an http portal or flow URL; setup save refuses http.
 *
 * No network: fetch, the Vault, the portal browser and Documo are mocked.
 */

import { scriptedDb, type Script, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import {
  boundSignatureValue,
  canonicalSignedContent,
  patientSnapshotFor,
  prescriberSnapshotFor,
  rerouteBinding,
  type SignedOrderRow,
} from '@/lib/orders/signature-binding'

let db = scriptedDb(() => undefined)
const sendFaxMock = jest.fn()
const vaultMock = jest.fn()
const executeFlowMock = jest.fn()
const launchMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/documo/client', () => ({ sendFax: (...a: unknown[]) => sendFaxMock(...a) }))
jest.mock('@/lib/adapters/vault', () => ({
  getVaultSecret: async (...a: unknown[]) => { vaultMock(...a); return 'secret' },
  buildAuthHeaders: async () => ({}),
}))
jest.mock('@/lib/adapters/portal-flow-executor', () => ({ executeFlow: (...a: unknown[]) => executeFlowMock(...a) }))
jest.mock('playwright', () => ({ chromium: { launch: (...a: unknown[]) => launchMock(...a) } }))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: async () => ({ success: true, wasAlreadyTransitioned: false }) }))

import {
  assertOrderTransmittable,
  loadTransmittableOrder,
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

const env = process.env as Record<string, string | undefined>
const fetchMock = jest.fn()
beforeAll(() => {
  env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true';
  (global as { fetch: unknown }).fetch = fetchMock
})
afterAll(() => { delete env['PHARMACY_SUBMISSIONS_ENABLED']; delete env['RX_BINDING_SECRET'] })
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
jest.spyOn(console, 'info').mockImplementation(() => {})

const SIGNED_AT = '2026-10-25T14:03:07.123Z'
const DIGEST = 'c'.repeat(64)
const LIVE_PATIENT = {
  first_name: 'Alex', last_name: 'Demo', date_of_birth: '1980-01-01', address_line1: '1 Main St', address_line2: null,
  city: 'Austin', state: 'TX', zip: '78701', allergies: ['Sulfa'], nkda: false,
}
const LIVE_PROVIDER = { first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: 'BC1234563', license_state: 'TX' }

const BASE_ORDER = {
  order_id: 'o-1', order_number: 'CMP-1', status: 'SUBMISSION_PENDING', pharmacy_id: 'ph-1', clinic_id: 'c-1', reroute_count: 0,
  provider_id: 'pr-1', patient_id: 'pt-1', formulation_id: 'f-1', catalog_item_id: null,
  medication_snapshot: { medication_name: 'Semaglutide 2.5 mg/mL', dea_schedule: 0 },
  pharmacy_snapshot: { pharmacy_id: 'ph-1', name: 'Acme' },
  patient_snapshot: patientSnapshotFor(LIVE_PATIENT),
  prescriber_snapshot: prescriberSnapshotFor({ provider_id: 'pr-1', ...LIVE_PROVIDER }),
  provider_npi_snapshot: '1234567890', quantity: 1, sig_text: 'Inject weekly', sig_mode: 'standard',
  days_supply: 28, dispense_quantity: 1, dispense_unit: 'vial', refills: 0, substitution_allowed: true,
  syringe_option: 'none', shipping_type: 'standard', clinical_difference: 'Dose not available commercially',
  diagnosis_code: 'E66.9', diagnosis_text: 'Obesity', special_instructions: null,
  package_id: null, package_label: null, package_count: 1, titration_steps: [], cycle_on_days: null, cycle_off_days: null,
  fax_attempt_count: 0, created_at: '2026-10-01T00:00:00Z', locked_at: SIGNED_AT,
  shipping_state_snapshot: 'TX', shipping_address_line1_snapshot: '1 Main St', shipping_address_line2_snapshot: null,
  shipping_city_snapshot: 'Austin', shipping_zip_snapshot: '78701', shipping_address_snapshot_at: SIGNED_AT,
}

/** A properly signed (v3) order under the test key. */
function signed(over: Record<string, unknown> = {}) {
  const o = { ...BASE_ORDER, ...over }
  return { ...o, provider_signature_hash_snapshot: boundSignatureValue(DIGEST, SIGNED_AT, canonicalSignedContent(o as unknown as SignedOrderRow)) }
}

let order: Record<string, unknown> = {}
let livePatient: Record<string, unknown> = LIVE_PATIENT
let history: unknown[] = []
let apiBaseUrl = 'https://pharm.test'
let portalUrl = 'https://portal.pharm.test/login'

function world(more: Script = () => undefined): Script {
  return (c: ScriptedCall) => {
    const m = more(c)
    if (m) return m
    if (c.table === 'orders') return { data: order }
    if (c.table === 'order_status_history') return { data: history }
    if (c.table === 'formulations') return { data: { formulation_id: 'f-1', salt_forms: { ingredients: { dea_schedule: null } }, formulation_ingredients: [] } }
    if (c.table === 'pharmacies') return { data: { integration_tier: 'TIER_1_API', name: 'Acme', slug: 'acme', fax_number: '+15125550100' } }
    if (c.table === 'clinics') return { data: { name: 'Sunrise' } }
    if (c.table === 'providers') return { data: { first_name: 'Live', last_name: 'Prescriber', npi_number: '1999999999', dea_number: 'XX0000000', license_state: 'CA' } }
    if (c.table === 'patients') return { data: livePatient }
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
  env['RX_BINDING_SECRET'] = 'test-binding-secret-0123456789abcdef'
  delete env['VERCEL_ENV']
  order = signed()
  livePatient = LIVE_PATIENT
  history = []
  apiBaseUrl = 'https://pharm.test'
  portalUrl = 'https://portal.pharm.test/login'
  db = scriptedDb(world())
  sendFaxMock.mockReset().mockResolvedValue({ faxId: 'fax-1' })
  vaultMock.mockReset()
  executeFlowMock.mockReset().mockResolvedValue([])
  launchMock.mockReset().mockRejectedValue(new Error('no browser in tests'))
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'ext-1' }), text: async () => '{"id":"ext-1"}' })
  errorSpy.mockClear()
  warnSpy.mockClear()
})

const logged = () => [...errorSpy.mock.calls, ...warnSpy.mock.calls].map(c => c.map(String).join(' ')).join('\n')
const refusedWith = async (code: string, opts?: { pharmacyId?: string }) => {
  const err = await assertOrderTransmittable(db.client, 'o-1', opts).then(() => null, (e: unknown) => e)
  expect(isTransmissionRefusedError(err)).toBe(true)
  expect((err as { code: string }).code).toBe(code)
}
const beforeCutoff = '2026-10-01T00:00:00.000Z'

// ── The guard ────────────────────────────────────────────────

describe('assertOrderTransmittable', () => {
  it('a signed order whose content still matches its keyed signature may be sent', async () => {
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
    for (const status of ['DRAFT', 'AWAITING_PAYMENT', 'CANCELLED', 'SUBMISSION_FAILED', 'FAX_FAILED', 'SHIPPED']) {
      order = signed({ status })
      await refusedWith('order_not_submittable')
    }
  })

  it('B7: a change after signing is refused as a signature mismatch', async () => {
    order = { ...signed(), refills: 5 }
    await refusedWith('signature_mismatch')
    order = { ...signed(), patient_snapshot: { ...patientSnapshotFor(LIVE_PATIENT), first_name: 'Robin' } }
    await refusedWith('signature_mismatch')
  })

  it('T1: a forged bare 64-hex value (no signing history) is refused', async () => {
    order = { ...signed(), provider_signature_hash_snapshot: '0'.repeat(64) }
    await refusedWith('signature_mismatch')
  })

  it('T1: a value computed without the server key (another key) is refused', async () => {
    env['RX_BINDING_SECRET'] = 'attacker-guess-0000000000000000000'
    const forged = signed({ sig_text: 'Inject 2.5 mg daily', refills: 11 })
    env['RX_BINDING_SECRET'] = 'test-binding-secret-0123456789abcdef'
    order = forged
    await refusedWith('signature_mismatch')
  })

  it('T1: legacy only with the service-written signing row from before the cutoff, and logged as such', async () => {
    order = { ...BASE_ORDER, locked_at: beforeCutoff, patient_snapshot: null, prescriber_snapshot: null, provider_signature_hash_snapshot: DIGEST }
    history = [{ old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', created_at: beforeCutoff, metadata: { actor: 'provider_batch_sign', signed_at: beforeCutoff, signature_hash: DIGEST } }]
    await expect(assertOrderTransmittable(db.client, 'o-1')).resolves.toBe('legacy')
    expect(logged()).toMatch(/order=o-1 was signed before signature binding/)
    history = [{ old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', created_at: beforeCutoff, metadata: { actor: 'provider_batch_sign', signed_at: beforeCutoff, signature_hash: 'd'.repeat(64) } }]
    await refusedWith('signature_mismatch')
    // RX_LEGACY_CUTOFF unset: no legacy at all.
    history = [{ old_status: 'DRAFT', new_status: 'AWAITING_PAYMENT', created_at: beforeCutoff, metadata: { actor: 'provider_batch_sign', signed_at: beforeCutoff, signature_hash: DIGEST } }]
    const cutoff = env['RX_LEGACY_CUTOFF']
    delete env['RX_LEGACY_CUTOFF']
    try { await refusedWith('signature_mismatch') } finally { env['RX_LEGACY_CUTOFF'] = cutoff }
  })

  it('T1: with no binding key on any Vercel deployment (production or preview) nothing is sent', async () => {
    delete env['RX_BINDING_SECRET']
    env['VERCEL_ENV'] = 'production'
    await refusedWith('binding_key_missing')
    env['VERCEL_ENV'] = 'preview'
    await refusedWith('binding_key_missing')
  })

  it('T2: a pharmacy other than the one signed for is refused without the reroute proof', async () => {
    order = { ...signed(), pharmacy_id: 'ph-2' }
    await refusedWith('pharmacy_mismatch')
    history = [{ old_status: 'FAX_FAILED', new_status: 'REROUTE_PENDING', created_at: '2026-10-26T10:00:00Z',
      metadata: { reason: 'ops_reroute', new_pharmacy_id: 'ph-2', reroute_count: 1, reroute_binding: 'f'.repeat(64) } }]
    await refusedWith('pharmacy_mismatch')
  })

  it('T2: the ops reroute re-binds: its keyed proof lets the new pharmacy receive it', async () => {
    const s = signed()
    order = { ...s, pharmacy_id: 'ph-2', reroute_count: 1 }
    history = [{ old_status: 'FAX_FAILED', new_status: 'REROUTE_PENDING', created_at: '2026-10-26T10:00:00Z',
      metadata: { reason: 'ops_reroute', new_pharmacy_id: 'ph-2', reroute_count: 1, reroute_binding: rerouteBinding('o-1', s.provider_signature_hash_snapshot, 'ph-2', 1) } }]
    await expect(assertOrderTransmittable(db.client, 'o-1')).resolves.toBe('bound')
  })

  it("T2: a caller naming another pharmacy than the order's is refused", async () => {
    await refusedWith('pharmacy_mismatch', { pharmacyId: 'ph-9' })
  })

  it("T6: the patient's allergies changed after signing: refused with its own reason", async () => {
    livePatient = { ...LIVE_PATIENT, allergies: ['Sulfa', 'Penicillin'] }
    await refusedWith('allergies_changed')
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

describe('T2 / T3: what is sent is the verified row and the signing snapshots', () => {
  it('loadTransmittableOrder returns the snapshot patient name and DOB and the snapshot prescriber, not live rows', async () => {
    livePatient = { ...LIVE_PATIENT, first_name: 'Robin', date_of_birth: '1999-09-09' }
    const t = await loadTransmittableOrder(db.client, 'o-1')
    expect(t.patient).toMatchObject({ first_name: 'Alex', last_name: 'Demo', date_of_birth: '1980-01-01', allergies: ['Sulfa'] })
    expect(t.prescriber).toEqual({ first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', dea_number: 'BC1234563', license_state: 'TX' })
    expect(db.to('providers')).toHaveLength(0)
  })

  it('Tier 1 sends the snapshot names, reads the order once, and never follows a redirect (T4)', async () => {
    livePatient = { ...LIVE_PATIENT, first_name: 'Robin' }
    await submitTier1Api('o-1', 'ph-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(init.redirect).toBe('error')
    const body = String(init.body)
    expect(body).toContain('Alex')
    expect(body).not.toContain('Robin')
    expect(body).toContain('Sarah')
    expect(body).not.toContain('Live')
    // One read of the order's content: the guard's, which the payload is built from.
    expect(db.to('orders').filter(c => (c.columns ?? '').includes('sig_text'))).toHaveLength(1)
  })

  it('T3: a write after the check cannot reach the pharmacy (the payload is the checked row)', async () => {
    let reads = 0
    const verified = signed()
    db = scriptedDb(world(c => {
      if (c.table === 'orders' && (c.columns ?? '').includes('sig_text')) {
        reads++
        return { data: reads === 1 ? verified : { ...verified, sig_text: 'Tampered after the check' } }
      }
      return undefined
    }))
    await submitTier1Api('o-1', 'ph-1')
    const body = String((fetchMock.mock.calls[0]![1] as RequestInit).body)
    expect(body).toContain('Inject weekly')
    expect(body).not.toContain('Tampered')
  })
})

// ── Every adapter refuses ────────────────────────────────────

describe('the adapters refuse before sending anything', () => {
  const cases: Array<[string, () => void, string]> = [
    ['unsigned', () => { order = { ...signed(), locked_at: null } }, 'unsigned_order'],
    ['not submittable', () => { order = signed({ status: 'AWAITING_PAYMENT' }) }, 'order_not_submittable'],
    ['changed after signing', () => { order = { ...signed(), quantity: 9 } }, 'signature_mismatch'],
    ['forged legacy hash', () => { order = { ...signed(), provider_signature_hash_snapshot: '0'.repeat(64) } }, 'signature_mismatch'],
    ['another pharmacy', () => { order = { ...signed(), pharmacy_id: 'ph-2' } }, 'pharmacy_mismatch'],
    ['allergies changed', () => { livePatient = { ...LIVE_PATIENT, nkda: true, allergies: [] } }, 'allergies_changed'],
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

  it("Tier 1 / 2 refuse a caller pharmacy that is not the order's", async () => {
    await expect(submitTier1Api('o-1', 'ph-9')).rejects.toMatchObject({ code: 'pharmacy_mismatch' })
    await expect(submitTier2Portal('o-1', 'ph-9')).rejects.toMatchObject({ code: 'pharmacy_mismatch' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Tier 4 fax goes on to build the fax for a signed, matching order', async () => {
    const err = await submitTier4Fax('o-1').then(() => null, (e: unknown) => e)
    expect(isTransmissionRefusedError(err)).toBe(false)
    expect(db.to('clinics', 'select').length).toBeGreaterThan(0)
  })
})

describe('T5: the Tier 2 browser is https-only', () => {
  it('Tier 2 routes the browser context https-only before the page is opened', async () => {
    env['PLAYWRIGHT_HEADLESS'] = 'true'
    const route = jest.fn(async () => undefined)
    const page = { url: () => 'https://portal.pharm.test/x', goto: jest.fn(async () => null), close: jest.fn(async () => undefined), screenshot: jest.fn(async () => Buffer.from('')) }
    const context = { route, newPage: jest.fn(async () => page), close: jest.fn(async () => undefined) }
    launchMock.mockResolvedValue({ newContext: jest.fn(async () => context), close: jest.fn(async () => undefined) })
    await submitTier2Portal('o-1', 'ph-1').catch(() => undefined)
    expect(route).toHaveBeenCalledWith('**/*', expect.any(Function))
    // Installed before the page exists, so even the first navigation is covered.
    expect(route.mock.invocationCallOrder[0]!).toBeLessThan(context.newPage.mock.invocationCallOrder[0]!)
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
    expect(env['NODE_ENV']).toBe('test')
    expect(isSecurePharmacyUrl('http://localhost:4010')).toBe(true)
    expect(isSecurePharmacyUrl('http://localhost.evil.test')).toBe(false)
    const was = env['NODE_ENV']
    env['NODE_ENV'] = 'production'
    try { expect(isSecurePharmacyUrl('http://localhost:4010')).toBe(false) } finally { env['NODE_ENV'] = was }
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
  })

  it('Tier 2 refuses an http portal_url or flow URL before reading credentials or opening the portal', async () => {
    portalUrl = 'http://portal.pharm.test/login'
    await expect(submitTier2Portal('o-1', 'ph-1')).rejects.toMatchObject({ code: 'insecure_pharmacy_url' })
    portalUrl = 'https://portal.pharm.test/login'
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

// ── Ops and the clinic see a reason ──────────────────────────

describe('the refusal codes reach ops in plain words', () => {
  it('each code is a known failure code with its own plain reason, and may be sent in an alert', () => {
    expect([...TRANSMISSION_REFUSAL_CODES].sort()).toEqual([
      'allergies_changed', 'binding_key_missing', 'insecure_pharmacy_url', 'order_not_submittable',
      'pharmacy_mismatch', 'signature_mismatch', 'unsigned_order',
    ])
    for (const code of TRANSMISSION_REFUSAL_CODES) {
      expect(knownFailureCode(code)).toBe(code)
      expect(plainFailureReason(code)).not.toBe(plainFailureReason(null))
      expect((ADAPTER_ERROR_CODES as readonly string[]).includes(code)).toBe(true)
    }
    expect(plainFailureReason('allergies_changed')).toBe("the patient's allergies changed after the prescription was signed")
  })
})
