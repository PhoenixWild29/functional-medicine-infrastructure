/**
 * @jest-environment node
 *
 * Compliance C2: the prescription pages that show patient data each log
 * exactly one phi_access_log row per request.
 *
 *   /new-prescription        the patient picker (the clinic's patients)
 *   /new-prescription/sign   the patients and drafts being signed
 *   /new-prescription/margin editing a draft (its patient is loaded)
 *
 * The page components run; Supabase and the loaders are faked. A page
 * that refuses (no user) logs nothing, and a new prescription on the
 * margin page (no draft, no patient loaded) logs nothing.
 */

import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'
import { logPhiAccessMany } from '@/lib/audit/phi-access'

const CLINIC = 'a1000000-0000-0000-0000-000000000001'
const PATIENT = 'a3000000-0000-0000-0000-000000000001'
const ORDER = 'd1000000-0000-4000-8000-000000000001'

let user: unknown = null
let db = scriptedDb(() => undefined)

jest.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`) },
  notFound: () => { throw new Error('NOT_FOUND') },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
}))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/auth/current-provider', () => ({
  isProviderRole: (r: unknown) => r === 'provider',
  resolveCurrentProvider: async () => ({ provider_id: 'pr-1', clinic_id: CLINIC, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }),
}))
jest.mock('@/lib/orders/apply-bundle-shipping', () => ({ loadShippingRates: async () => new Map() }))
jest.mock('@/lib/orders/load-draft-context', () => ({
  loadDraftContext: async () => ({
    orderId: ORDER,
    patient: { patient_id: PATIENT, first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: false, allergies: [], nkda: true, allergies_updated_at: null },
    provider: { provider_id: 'pr-1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null },
    retailCents: 10000, rxDetails: {}, packageId: null, packageCount: null,
  }),
}))

const rows: Script = c => {
  if (c.table === 'patients') return { data: [{ patient_id: PATIENT, first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX' }] }
  if (c.table === 'providers') return { data: [] }
  if (c.table === 'clinics') return { data: { absorb_shipping: false, default_markup_pct: 40 } }
  if (c.table === 'orders') return { data: [{ order_id: ORDER, status: 'DRAFT', patient_id: PATIENT, provider_id: 'pr-1', pharmacy_id: 'ph-1', medication_snapshot: {} }] }
  return undefined
}

const PROVIDER_USER = { id: 'user-1', email: 'dr.chen@clinic.example', app_metadata: { clinic_id: CLINIC, app_role: 'provider' } }
const MA_USER = { id: 'user-2', email: 'ma@clinic.example', app_metadata: { clinic_id: CLINIC, app_role: 'medical_assistant' } }

beforeEach(() => {
  phiLog.mockClear()
  jest.mocked(logPhiAccessMany).mockClear()
  db = scriptedDb(rows)
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

// Each test imports its page (await import), and the first import of a page
// compiles it and its whole import tree: 2 s alone, up to 12.8 s in a loaded
// full run, against jest's 5 s per-test default (B-2026-10-26-10). Import
// the four pages once here, with room for a cold compile; the tests then get
// them from the module registry (nothing here resets modules).
beforeAll(async () => {
  await Promise.all([import('../page'), import('../search/page'), import('../sign/page'), import('../margin/page')])
}, 120_000)

describe('/new-prescription (patient picker)', () => {
  it('logs view / patient_list once per patient listed', async () => {
    user = MA_USER
    const { default: Page } = await import('../page')
    await Page()
    expect(logPhiAccessMany).toHaveBeenCalledTimes(1)
    const [entry, ids] = jest.mocked(logPhiAccessMany).mock.calls[0]!
    expect(entry).toEqual(expect.objectContaining({ user: MA_USER, action: 'view', resource: 'patient_list', route: '/new-prescription' }))
    expect(ids).toEqual([PATIENT])
    // C-2026-10-26-04 (review L5): list views dedupe over 15 minutes.
    expect(jest.mocked(logPhiAccessMany).mock.calls[0]?.[2]).toEqual({ dedupeMinutes: 15 })
    expect(phiEntries()).toHaveLength(0)
  })

  it('no user, no row', async () => {
    user = null
    const { default: Page } = await import('../page')
    await Page()
    expect(phiEntries()).toHaveLength(0)
    expect(logPhiAccessMany).not.toHaveBeenCalled()
  })
})

describe('/new-prescription/search (a draft reopened)', () => {
  it('?editOrder= logs exactly one row: view, draft_edit, the order and its patient', async () => {
    user = PROVIDER_USER
    const { default: Page } = await import('../search/page')
    await Page({ searchParams: Promise.resolve({ editOrder: ORDER }) })
    expectOnePhiRow({ action: 'view', resource: 'draft_edit', route: '/new-prescription/search', orderId: ORDER, patientId: PATIENT })
  })

  it('?addToOrder= loads the same draft context and logs the same row', async () => {
    user = PROVIDER_USER
    const { default: Page } = await import('../search/page')
    await Page({ searchParams: Promise.resolve({ addToOrder: ORDER }) })
    expectOnePhiRow({ action: 'view', resource: 'draft_edit', route: '/new-prescription/search', orderId: ORDER, patientId: PATIENT })
  })

  it('a new prescription (no draft) logs nothing', async () => {
    user = PROVIDER_USER
    const { default: Page } = await import('../search/page')
    await Page({ searchParams: Promise.resolve({}) })
    expect(phiEntries()).toHaveLength(0)
  })
})

describe('/new-prescription/sign', () => {
  it('logs exactly one row: view, prescription, the patient and draft', async () => {
    user = PROVIDER_USER
    const { default: Page } = await import('../sign/page')
    await Page({ searchParams: Promise.resolve({ orders: ORDER }) })
    expectOnePhiRow({ action: 'view', resource: 'prescription', route: '/new-prescription/sign', patientId: PATIENT, orderId: ORDER })
  })

  it('a non-provider sees a notice and no row is logged', async () => {
    user = MA_USER
    const { default: Page } = await import('../sign/page')
    await Page({ searchParams: Promise.resolve({ orders: ORDER }) })
    expect(phiEntries()).toHaveLength(0)
  })
})

describe('/new-prescription/margin', () => {
  const params = (extra: Record<string, string> = {}) =>
    Promise.resolve({ pharmacyId: 'ph-1', formulation_id: 'f-1', ...extra })

  it('editing a draft logs exactly one row: view, order, its patient', async () => {
    user = PROVIDER_USER
    const { default: Page } = await import('../margin/page')
    await Page({ searchParams: params({ editOrder: ORDER }) } as never).catch(() => undefined)
    expectOnePhiRow({ action: 'view', resource: 'order', route: '/new-prescription/margin', orderId: ORDER, patientId: PATIENT })
  })

  it('a new prescription (no draft) logs nothing here', async () => {
    user = PROVIDER_USER
    const { default: Page } = await import('../margin/page')
    await Page({ searchParams: params() } as never).catch(() => undefined)
    expect(phiEntries()).toHaveLength(0)
  })
})
