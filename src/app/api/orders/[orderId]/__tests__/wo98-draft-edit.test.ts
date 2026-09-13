/**
 * @jest-environment node
 *
 * WO-98: PATCH / DELETE /api/orders/[orderId] — edit a draft line in
 * place, soft-delete a draft line, audit every change.
 *
 *   - DRAFT only: any other status → 409, nothing written.
 *   - provider edits any clinic draft; a non-provider only a draft they
 *     created (draft_created audit row by them) → 403 otherwise.
 *   - PATCH keeps the order_id, re-resolves the line like POST does,
 *     preserves the WO-96 rx_details columns and writes one
 *     DRAFT → DRAFT audit row with { event, actor, diff }.
 *   - DELETE never hard-deletes: is_active=false + deleted_at, plus an
 *     audit row.
 *
 * WO-100 (shared guard with POST /api/orders): a provider may only edit or
 * remove lines on a draft under their own name — another provider's draft
 * is refused with 403 DRAFT_BELONGS_TO_OTHER_PROVIDER until it is
 * reassigned via Sign as me. MA / clinic admin are unaffected by that check.
 *
 * Mocking pattern reused from ../../__tests__/wo96-rx-details.test.ts.
 */

import { PATCH, DELETE } from '../route'

const CLINIC_ID   = 'a1000000-0000-0000-0000-000000000001'
const ORDER_ID    = 'a6000000-0000-0000-0000-000000000001'
const PHARMACY_ID = 'a4000000-0000-0000-0000-000000000004'
const FORM_ID     = 'a7000000-0000-0000-0000-000000000001'

type ChainBuilder = Record<string, unknown>

let insertedRows: Array<{ table: string; row: Record<string, unknown> }> = []
let updatedRows:  Array<{ table: string; row: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
let queryFilters: Array<{ table: string; filters: Array<[string, unknown]> }> = []

const getSessionMock = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockResolvedValue({
    auth: { getSession: () => getSessionMock() },
  }),
}))

const fixtures: Record<string, () => unknown> = {}

function makeChain(table: string): ChainBuilder {
  const builder: ChainBuilder = {}
  const filters: Array<[string, unknown]> = []
  queryFilters.push({ table, filters })
  const passthrough = () => builder
  let pendingUpdate: Record<string, unknown> | null = null

  builder['select'] = passthrough
  builder['insert'] = (row: Record<string, unknown>) => {
    insertedRows.push({ table, row })
    return builder
  }
  builder['update'] = (row: Record<string, unknown>) => {
    pendingUpdate = row
    return builder
  }
  builder['eq'] = (col: string, v: unknown) => { filters.push([col, v]); return builder }
  builder['is'] = (col: string, v: unknown) => { filters.push([col, v]); return builder }
  builder['contains'] = (col: string, v: unknown) => { filters.push([col, v]); return builder }
  builder['limit'] = () => {
    const fixture = fixtures[`${table}:limit`]
    return Promise.resolve(fixture ? fixture() : { data: [], error: null })
  }
  builder['maybeSingle'] = () => {
    const fixture = fixtures[`${table}:maybeSingle`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null })
  }
  builder['then'] = (resolve: (v: unknown) => unknown) => {
    if (pendingUpdate) {
      updatedRows.push({ table, row: pendingUpdate, filters: [...filters] })
      pendingUpdate = null
      const fixture = fixtures[`${table}:update`]
      return Promise.resolve(fixture ? fixture() : { data: null, error: null }).then(resolve)
    }
    const fixture = fixtures[`${table}:await`]
    return Promise.resolve(fixture ? fixture() : { data: null, error: null }).then(resolve)
  }
  return builder
}

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockReturnValue({
    from: (table: string) => makeChain(table),
  }),
}))

function makeRequest(body?: unknown): import('next/server').NextRequest {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}
const ctx = { params: Promise.resolve({ orderId: ORDER_ID }) }

const DRAFT_ROW = {
  order_id: ORDER_ID, status: 'DRAFT', clinic_id: CLINIC_ID,
  patient_id: 'pat', provider_id: 'prov',
  formulation_id: FORM_ID, catalog_item_id: null, pharmacy_id: PHARMACY_ID,
  retail_price_snapshot: 190, wholesale_price_snapshot: 95,
  medication_snapshot: { formulation_id: FORM_ID, medication_name: 'Semaglutide 5mg/mL Injectable', form: 'Injectable Solution', dose: '5mg/mL', wholesale_price: 95, dea_schedule: 0, prescribed_dose: '10 units', frequency_code: 'QW', quantity_label: '5mL vial' },
  pharmacy_snapshot: { pharmacy_id: PHARMACY_ID, name: 'Strive Pharmacy', integration_tier: 'TIER_1_API', fax_number: null },
  sig_text: 'Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly',
  shipping_state_snapshot: 'TX',
  days_supply: 350, dispense_quantity: 5, dispense_unit: 'mL', refills: 0,
  substitution_allowed: true, syringe_option: 'sc_kit', shipping_type: 'cold_chain',
  clinical_difference: 'Patient requires a dose not commercially available',
  diagnosis_code: null, diagnosis_text: null, special_instructions: null,
}

function patchBody(extra: Record<string, unknown> = {}) {
  return {
    formulationId: FORM_ID,
    pharmacyId:    PHARMACY_ID,
    retailCents:   19000,
    sigText:       'Inject 15 units (0.15mL / 0.75mg) subcutaneously once weekly',
    dose:          '15 units',
    frequencyCode: 'QW',
    quantityLabel: '5mL vial',
    rxDetails: {
      daysSupply: 233, dispenseQuantity: 5, dispenseUnit: 'mL', refills: 0,
      substitutionAllowed: true, syringeOption: 'sc_kit', shippingType: 'cold_chain',
      clinicalDifference: 'Patient requires a dose not commercially available',
      diagnosisCode: null, diagnosisText: null, specialInstructions: null,
    },
    ...extra,
  }
}

const MY_PROVIDER_ID    = 'prov'            // DRAFT_ROW.provider_id
const OTHER_PROVIDER_ID = 'prov-someone-else'

/** The signed-in provider's own provider row (resolveCurrentProvider). */
function signedInProviderIs(providerId: string | null) {
  fixtures['providers:maybeSingle'] = () => ({
    data: providerId
      ? { provider_id: providerId, clinic_id: CLINIC_ID, first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null }
      : null,
    error: null,
  })
}

function installHappyFixtures(row: Record<string, unknown> = DRAFT_ROW) {
  fixtures['orders:maybeSingle'] = () => ({ data: row, error: null })
  signedInProviderIs(MY_PROVIDER_ID)
  fixtures['formulations:maybeSingle'] = () => ({
    data: { formulation_id: FORM_ID, name: 'Semaglutide 5mg/mL Injectable', concentration: '5mg/mL', dosage_forms: { name: 'Injectable Solution' } },
    error: null,
  })
  fixtures['pharmacy_formulations:maybeSingle'] = () => ({ data: { wholesale_price: 95 }, error: null })
  fixtures['formulation_ingredients:await'] = () => ({ data: [{ ingredients: { dea_schedule: null } }], error: null })
  fixtures['pharmacies:maybeSingle'] = () => ({
    data: { pharmacy_id: PHARMACY_ID, name: 'Strive Pharmacy', integration_tier: 'TIER_1_API', fax_number: null },
    error: null,
  })
  fixtures['pharmacy_state_licenses:maybeSingle'] = () => ({ data: { pharmacy_id: PHARMACY_ID }, error: null })
}

function sessionAs(role: string, userId = `auth-${role}`) {
  getSessionMock.mockResolvedValue({
    data: { session: { user: { id: userId, user_metadata: { clinic_id: CLINIC_ID, app_role: role } } } },
  })
}

beforeEach(() => {
  insertedRows = []
  updatedRows = []
  queryFilters = []
  Object.keys(fixtures).forEach(k => delete fixtures[k])
  sessionAs('provider')
  installHappyFixtures()
})

function auditRows() {
  return insertedRows.filter(r => r.table === 'order_status_history').map(r => r.row)
}

describe('PATCH /api/orders/[orderId] — WO-98 edit a draft line', () => {
  it('updates the draft in place (same order id), preserves rx_details, writes an audit row with actor + diff', async () => {
    const res = await PATCH(makeRequest(patchBody()), ctx)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      orderId: ORDER_ID,
      changed: expect.arrayContaining(['sig_text', 'days_supply', 'medication_snapshot.prescribed_dose']),
    })

    const update = updatedRows.find(u => u.table === 'orders')
    expect(update).toBeDefined()
    // Scoped to this DRAFT row — the id never changes.
    expect(update!.filters).toEqual([['order_id', ORDER_ID], ['status', 'DRAFT']])
    expect(update!.row).toMatchObject({
      formulation_id:           FORM_ID,
      pharmacy_id:              PHARMACY_ID,
      retail_price_snapshot:    190,
      wholesale_price_snapshot: 95,
      sig_text:                 'Inject 15 units (0.15mL / 0.75mg) subcutaneously once weekly',
      days_supply:              233,
      dispense_quantity:        5,
      dispense_unit:            'mL',
      refills:                  0,
      substitution_allowed:     true,
      syringe_option:           'sc_kit',
      shipping_type:            'cold_chain',
      clinical_difference:      'Patient requires a dose not commercially available',
    })
    expect(update!.row['medication_snapshot']).toMatchObject({ prescribed_dose: '15 units', frequency_code: 'QW', quantity_label: '5mL vial' })
    expect(update!.row).not.toHaveProperty('status')
    expect(update!.row).not.toHaveProperty('patient_id')
    expect(update!.row).not.toHaveProperty('provider_id')

    const audit = auditRows()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      order_id: ORDER_ID, old_status: 'DRAFT', new_status: 'DRAFT', changed_by: 'auth-provider',
    })
    const metadata = audit[0]!['metadata'] as { event: string; actor: unknown; diff: Record<string, { from: unknown; to: unknown }> }
    expect(metadata.event).toBe('draft_edited')
    expect(metadata.actor).toEqual({ user_id: 'auth-provider', role: 'provider' })
    expect(metadata.diff['sig_text']).toEqual({ from: DRAFT_ROW.sig_text, to: 'Inject 15 units (0.15mL / 0.75mg) subcutaneously once weekly' })
    expect(metadata.diff['days_supply']).toEqual({ from: 350, to: 233 })
    expect(metadata.diff['medication_snapshot.prescribed_dose']).toEqual({ from: '10 units', to: '15 units' })
    expect(metadata.diff).not.toHaveProperty('retail_price_snapshot')
  })

  it('rejects a non-DRAFT order with 409 and writes nothing', async () => {
    installHappyFixtures({ ...DRAFT_ROW, status: 'AWAITING_PAYMENT' })
    const res = await PATCH(makeRequest(patchBody()), ctx)
    expect(res.status).toBe(409)
    expect(updatedRows).toEqual([])
    expect(auditRows()).toEqual([])
  })

  it('404s when the draft is not in the caller clinic (clinic-scoped lookup)', async () => {
    fixtures['orders:maybeSingle'] = () => ({ data: null, error: null })
    const res = await PATCH(makeRequest(patchBody()), ctx)
    expect(res.status).toBe(404)
    const lookup = queryFilters.find(q => q.table === 'orders')
    expect(lookup!.filters).toEqual(expect.arrayContaining([['order_id', ORDER_ID], ['clinic_id', CLINIC_ID], ['is_active', true], ['deleted_at', null]]))
  })

  it('403s a medical assistant on a draft they did not create; allows one they did', async () => {
    sessionAs('medical_assistant', 'auth-ma')
    fixtures['order_status_history:limit'] = () => ({ data: [], error: null })
    const denied = await PATCH(makeRequest(patchBody()), ctx)
    expect(denied.status).toBe(403)
    expect(updatedRows).toEqual([])
    const creatorLookup = queryFilters.find(q => q.table === 'order_status_history')
    expect(creatorLookup!.filters).toEqual([
      ['order_id', ORDER_ID],
      ['changed_by', 'auth-ma'],
      ['metadata', { event: 'draft_created' }],
    ])

    fixtures['order_status_history:limit'] = () => ({ data: [{ history_id: 'h1' }], error: null })
    const allowed = await PATCH(makeRequest(patchBody()), ctx)
    expect(allowed.status).toBe(200)
    expect(updatedRows.find(u => u.table === 'orders')).toBeDefined()
    expect(auditRows()[0]!['changed_by']).toBe('auth-ma')
  })

  it('validates the body before touching the database', async () => {
    expect((await PATCH(makeRequest(patchBody({ retailCents: 0 })), ctx)).status).toBe(400)
    expect((await PATCH(makeRequest(patchBody({ sigText: 'short' })), ctx)).status).toBe(400)
    expect((await PATCH(makeRequest(patchBody({ formulationId: null })), ctx)).status).toBe(400)
    expect((await PATCH(makeRequest(patchBody({ rxDetails: { refills: 'nine' } })), ctx)).status).toBe(400)
    expect(queryFilters).toEqual([])
  })

  it('re-validates the edited line like POST: unlicensed pharmacy → 400, retail below wholesale → 422', async () => {
    fixtures['pharmacy_state_licenses:maybeSingle'] = () => ({ data: null, error: null })
    expect((await PATCH(makeRequest(patchBody()), ctx)).status).toBe(400)

    installHappyFixtures()
    expect((await PATCH(makeRequest(patchBody({ retailCents: 100 })), ctx)).status).toBe(422)
    expect(updatedRows).toEqual([])
  })

  it('401s without a session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    expect((await PATCH(makeRequest(patchBody()), ctx)).status).toBe(401)
  })
})

describe('DELETE /api/orders/[orderId] — WO-98 remove a draft line', () => {
  it('soft-deletes (is_active=false + deleted_at) and writes a draft_line_removed audit row', async () => {
    const res = await DELETE(makeRequest(), ctx)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ orderId: ORDER_ID, removed: true })

    const update = updatedRows.find(u => u.table === 'orders')
    expect(update!.row).toEqual({ is_active: false, deleted_at: expect.any(String) })
    expect(update!.filters).toEqual([['order_id', ORDER_ID], ['status', 'DRAFT']])

    const audit = auditRows()
    expect(audit).toHaveLength(1)
    expect(audit[0]!['metadata']).toEqual({ event: 'draft_line_removed', actor: { user_id: 'auth-provider', role: 'provider' } })
  })

  it('refuses to remove anything but a DRAFT (409) and enforces the creator rule for non-providers (403)', async () => {
    installHappyFixtures({ ...DRAFT_ROW, status: 'PAID_PROCESSING' })
    expect((await DELETE(makeRequest(), ctx)).status).toBe(409)

    installHappyFixtures()
    sessionAs('clinic_admin', 'auth-admin')
    fixtures['order_status_history:limit'] = () => ({ data: [], error: null })
    expect((await DELETE(makeRequest(), ctx)).status).toBe(403)
    expect(updatedRows).toEqual([])
  })
})

describe('WO-100 — PATCH / DELETE apply the provider-owns-draft rule (shared with POST /api/orders)', () => {
  const REASSIGN_MESSAGE =
    'This draft belongs to another provider. Reassign it to yourself with Sign as me before adding or editing prescriptions.'

  const send = {
    PATCH:  () => PATCH(makeRequest(patchBody()), ctx),
    DELETE: () => DELETE(makeRequest(), ctx),
  } as const

  describe.each(['PATCH', 'DELETE'] as const)('%s', (method) => {
    it("403 DRAFT_BELONGS_TO_OTHER_PROVIDER on another provider's draft — nothing changed, no audit row", async () => {
      signedInProviderIs(OTHER_PROVIDER_ID)
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await send[method]()
      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({
        error: REASSIGN_MESSAGE,
        code:  'DRAFT_BELONGS_TO_OTHER_PROVIDER',
      })
      expect(updatedRows).toEqual([])
      expect(auditRows()).toEqual([])
      // The line was never re-resolved either (PATCH) — refused before any work.
      expect(queryFilters.find(q => q.table === 'pharmacy_formulations')).toBeUndefined()
      // Resolved by the caller's auth user, scoped to the clinic.
      const lookup = queryFilters.find(q => q.table === 'providers')
      expect(lookup!.filters).toEqual(expect.arrayContaining([['user_id', 'auth-provider'], ['clinic_id', CLINIC_ID]]))
      warn.mockRestore()
    })

    it('403 when the provider login is not linked to a provider row — nothing changed', async () => {
      signedInProviderIs(null)
      const res = await send[method]()
      expect(res.status).toBe(403)
      expect((await res.json()).error).toMatch(/not linked/)
      expect(updatedRows).toEqual([])
      expect(auditRows()).toEqual([])
    })

    it("succeeds on the provider's own draft", async () => {
      signedInProviderIs(MY_PROVIDER_ID)
      const res = await send[method]()
      expect(res.status).toBe(200)
      expect(updatedRows.find(u => u.table === 'orders')).toBeDefined()
      expect(auditRows()).toHaveLength(1)
    })

    it.each(['medical_assistant', 'clinic_admin'])('a %s who created the draft still succeeds (provider check not applied)', async (role) => {
      sessionAs(role, `auth-${role}`)
      // Even if a provider row lookup would say "someone else", staff are not providers.
      signedInProviderIs(OTHER_PROVIDER_ID)
      fixtures['order_status_history:limit'] = () => ({ data: [{ history_id: 'h1' }], error: null })

      const res = await send[method]()
      expect(res.status).toBe(200)
      expect(updatedRows.find(u => u.table === 'orders')).toBeDefined()
      expect(queryFilters.find(q => q.table === 'providers')).toBeUndefined()
    })
  })
})
