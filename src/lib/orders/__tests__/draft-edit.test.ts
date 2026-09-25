/**
 * WO-98: draft-edit helpers — the diff written to the audit row, the
 * builder state recovered from a draft row, and the return path.
 */

import {
  structuredLineInputs,
  builderStateFromOrder,
  canEditDraft,
  diffDraftRows,
  draftReturnPath,
  parseSigForBuilder,
  writeDraftAudit,
} from '../draft-edit'

describe('diffDraftRows', () => {
  const before = {
    formulation_id: 'f1', catalog_item_id: null, pharmacy_id: 'p1',
    retail_price_snapshot: 190, wholesale_price_snapshot: 95,
    sig_text: 'Inject 10 units subcutaneously once weekly',
    medication_snapshot: { medication_name: 'Semaglutide', dose: '5mg/mL', prescribed_dose: '10 units', frequency_code: 'QW' },
    pharmacy_snapshot: { name: 'Strive' },
    days_supply: 350, dispense_quantity: 5, dispense_unit: 'mL', refills: 0,
    substitution_allowed: true, syringe_option: 'sc_kit', shipping_type: 'cold_chain',
    clinical_difference: 'x', diagnosis_code: null, diagnosis_text: null, special_instructions: null,
  }

  it('is empty when nothing changed', () => {
    expect(diffDraftRows(before, { ...before })).toEqual({})
  })

  it('records only the changed fields with from/to, flattening snapshot keys', () => {
    const after = {
      ...before,
      sig_text: 'Inject 15 units subcutaneously once weekly',
      days_supply: 233,
      medication_snapshot: { ...before.medication_snapshot, prescribed_dose: '15 units' },
    }
    expect(diffDraftRows(before, after)).toEqual({
      sig_text:    { from: before.sig_text, to: after.sig_text },
      days_supply: { from: 350, to: 233 },
      'medication_snapshot.prescribed_dose': { from: '10 units', to: '15 units' },
    })
  })

  it('treats a missing before-value as null', () => {
    const { medication_snapshot: _m, ...noSnapshot } = before
    void _m
    const diff = diffDraftRows(noSnapshot, { medication_snapshot: { medication_name: 'BPC-157' } })
    expect(diff['medication_snapshot.medication_name']).toEqual({ from: null, to: 'BPC-157' })
  })
})

describe('WO-105: reopening a saved titration', () => {
  const STEPS = [
    { dose: '10', unit: 'units', frequency: 'QW', weeks: 4 },
    { dose: '20', unit: 'units', frequency: 'QW', weeks: 4 },
  ]

  it('comes back as a titration with its steps, not as a standard dose line', () => {
    const state = builderStateFromOrder({
      formulation_id: 'f1', pharmacy_id: 'p1', refills: 0,
      sig_text: 'Weeks 1–4: inject 10 units subcutaneous once weekly. Weeks 5–8: inject 20 units subcutaneous once weekly. Total dispense 1.2 mL over 56 days.',
      medication_snapshot: { prescribed_dose: '10 units', frequency_code: 'QW' },
      sig_mode: 'titration',
      titration_steps: STEPS,
    })
    expect(state.sigMode).toBe('titration')
    expect(state.titrationSteps).toEqual(STEPS)
  })

  it('an order written before WO-105 reopens as standard with no steps', () => {
    const state = builderStateFromOrder({
      formulation_id: 'f1', pharmacy_id: 'p1', refills: 0,
      sig_text: 'Inject 10 units subcutaneously once weekly',
      medication_snapshot: {},
    })
    expect(state.sigMode).toBe('standard')
    expect(state.titrationSteps).toEqual([])
  })

  it('steps on a row whose mode is not titration are ignored', () => {
    const state = builderStateFromOrder({
      formulation_id: 'f1', pharmacy_id: 'p1', refills: 0,
      sig_text: 'Inject 10 units subcutaneously once weekly',
      medication_snapshot: {},
      sig_mode: 'standard',
      titration_steps: STEPS,
    })
    expect(state.titrationSteps).toEqual([])
  })

  it('a malformed steps column reopens as a titration with no steps, never a half-schedule', () => {
    const state = builderStateFromOrder({
      formulation_id: 'f1', pharmacy_id: 'p1', refills: 0,
      sig_text: 'x', medication_snapshot: {},
      sig_mode: 'titration',
      titration_steps: [{ dose: '10', unit: 'units' }],
    })
    expect(state.sigMode).toBe('titration')
    expect(state.titrationSteps).toEqual([])
  })
})

describe('parseSigForBuilder / builderStateFromOrder', () => {
  it('recovers dose + frequency from a generated sig', () => {
    expect(parseSigForBuilder('Inject 10 units (0.10mL / 0.50mg) subcutaneously once weekly in the morning'))
      .toEqual({ doseAmount: '10', doseUnit: 'units', frequency: 'QW' })
    expect(parseSigForBuilder('Take 1 tablet by mouth twice daily'))
      .toEqual({ doseAmount: '1', doseUnit: 'tablet', frequency: 'BID' })
    expect(parseSigForBuilder('')).toEqual({ doseAmount: '', doseUnit: '', frequency: '' })
  })

  it('prefers the structured inputs stored on medication_snapshot (post-WO-98 drafts)', () => {
    expect(builderStateFromOrder({
      formulation_id: 'f1', pharmacy_id: 'p1', refills: 2,
      sig_text: 'Inject 10 units subcutaneously once weekly',
      medication_snapshot: { prescribed_dose: '15 units', frequency_code: 'Q2W', quantity_label: '5mL vial' },
    })).toEqual({
      formulationId: 'f1', pharmacyId: 'p1', doseAmount: '15', doseUnit: 'units',
      frequency: 'Q2W', quantity: '5mL vial', refills: 2,
      sigText: 'Inject 10 units subcutaneously once weekly',
      sigMode:        'standard',
      titrationSteps: [],
      cycle: null,
    })
  })

  it('falls back to the sig for drafts saved before WO-98', () => {
    expect(builderStateFromOrder({
      formulation_id: 'f1', pharmacy_id: null, refills: null,
      sig_text: 'Inject 0.5 mL subcutaneously once weekly',
      medication_snapshot: { medication_name: 'Testosterone' },
    })).toEqual({
      formulationId: 'f1', pharmacyId: '', doseAmount: '0.5', doseUnit: 'mL',
      frequency: 'QW', quantity: '', refills: 0,
      sigText: 'Inject 0.5 mL subcutaneously once weekly',
      sigMode:        'standard',
      titrationSteps: [],
      cycle: null,
    })
  })
})

describe('draftReturnPath', () => {
  // WO-99 follow-up: providers go straight to the batch sign page (the
  // old /sign/<id> redirects there anyway, selecting that order alone).
  it('sends providers back to the draft on the batch sign page and everyone else to the dashboard', () => {
    expect(draftReturnPath('o1', true)).toBe('/new-prescription/sign?orders=o1')
    expect(draftReturnPath('o1', false)).toBe('/dashboard?draft=1')
  })
})

// ── Supabase-backed helpers (minimal chain mock) ─────────────

function makeClient(opts: { creatorRows?: unknown[]; insertError?: { message: string } | null } = {}) {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = []
  const filters: Array<[string, unknown]> = []
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  chain['select'] = passthrough
  chain['eq'] = (col: string, v: unknown) => { filters.push([col, v]); return chain }
  chain['contains'] = (col: string, v: unknown) => { filters.push([col, v]); return chain }
  chain['limit'] = () => Promise.resolve({ data: opts.creatorRows ?? [], error: null })
  chain['insert'] = (row: Record<string, unknown>) => {
    inserted.push({ table: 'order_status_history', row })
    return Promise.resolve({ error: opts.insertError ?? null })
  }
  const client = { from: () => chain }
  return { client: client as unknown as Parameters<typeof writeDraftAudit>[0], inserted, filters }
}

describe('writeDraftAudit', () => {
  it('appends one DRAFT → DRAFT row with the actor as changed_by and the envelope as metadata', async () => {
    const { client, inserted } = makeClient()
    const ok = await writeDraftAudit(client, 'o1', {
      event: 'draft_edited',
      actor: { user_id: 'u1', role: 'provider' },
      diff:  { sig_text: { from: 'a', to: 'b' } },
    })
    expect(ok).toBe(true)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.row).toEqual({
      order_id:   'o1',
      old_status: 'DRAFT',
      new_status: 'DRAFT',
      changed_by: 'u1',
      metadata:   { event: 'draft_edited', actor: { user_id: 'u1', role: 'provider' }, diff: { sig_text: { from: 'a', to: 'b' } } },
    })
  })

  it('is non-fatal when the insert fails', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = makeClient({ insertError: { message: 'boom' } })
    await expect(writeDraftAudit(client, 'o1', { event: 'draft_line_removed', actor: { user_id: 'u1', role: null } }))
      .resolves.toBe(false)
    spy.mockRestore()
  })
})

describe('canEditDraft', () => {
  it('lets a provider edit any draft without a creator lookup', async () => {
    const { client, filters } = makeClient()
    await expect(canEditDraft(client, 'o1', { userId: 'u-prov', role: 'provider' })).resolves.toBe(true)
    expect(filters).toEqual([])
  })

  it('lets a non-provider edit only a draft they created', async () => {
    const created = makeClient({ creatorRows: [{ history_id: 'h1' }] })
    await expect(canEditDraft(created.client, 'o1', { userId: 'u-ma', role: 'medical_assistant' })).resolves.toBe(true)
    expect(created.filters).toEqual([
      ['order_id', 'o1'],
      ['changed_by', 'u-ma'],
      ['metadata', { event: 'draft_created' }],
    ])

    const other = makeClient({ creatorRows: [] })
    await expect(canEditDraft(other.client, 'o1', { userId: 'u-ma', role: 'clinic_admin' })).resolves.toBe(false)
  })
})

// ── WO-96 fix: quantity round-trip on the edit path ───────────
describe('WO-96 fix — a reopened draft keeps its quantity', () => {
  it('builderStateFromOrder reads the quantity the save stored on medication_snapshot', () => {
    const state = builderStateFromOrder({
      formulation_id: 'f1',
      pharmacy_id:    'p1',
      sig_text:       'Inject 10 units (0.10mL / 0.50mg) subcutaneous once weekly in the morning for 30 days',
      refills:        0,
      medication_snapshot: { prescribed_dose: '10 units', frequency_code: 'QW', quantity_label: '1mL vial' },
    })
    expect(state).toEqual(expect.objectContaining({
      doseAmount: '10', doseUnit: 'units', frequency: 'QW', quantity: '1mL vial',
    }))
  })
})

// ── WO-96 fix: structured inputs win over the sig ─────────────
describe('structuredLineInputs — dose, frequency and quantity are structured, not re-parsed', () => {
  // The provider hand-edited the sig on the price step: it now says 20 units
  // twice daily for 90 days. The builder's structured values are 10 units
  // once weekly from a 1 mL vial — those are what must be stored.
  const HAND_EDITED_SIG = 'Inject 20 units (0.20mL / 1.00mg) subcutaneously twice daily for 90 days'

  it('a manually edited sig does not change the stored dose, frequency or quantity', () => {
    expect(structuredLineInputs({
      dose:          '10 units',
      frequencyCode: 'QW',
      quantityLabel: '1mL vial',
      sigText:       HAND_EDITED_SIG,
    })).toEqual({ dose: '10 units', frequencyCode: 'QW', quantityLabel: '1mL vial' })
  })

  it('normalises the structured dose unit', () => {
    expect(structuredLineInputs({ dose: '0.5mg', frequencyCode: 'QW', quantityLabel: null, sigText: HAND_EDITED_SIG }).dose).toBe('0.5 mg')
  })

  it('falls back to the sig only for a legacy line with no structured values', () => {
    expect(structuredLineInputs({ dose: null, frequencyCode: null, quantityLabel: null, sigText: HAND_EDITED_SIG }))
      .toEqual({ dose: '20 units', frequencyCode: 'BID', quantityLabel: null })
  })

  it('falls back per field: a structured frequency still wins when only the dose is missing', () => {
    expect(structuredLineInputs({ dose: '', frequencyCode: 'QW', quantityLabel: '1mL vial', sigText: HAND_EDITED_SIG }))
      .toEqual({ dose: '20 units', frequencyCode: 'QW', quantityLabel: '1mL vial' })
  })

  it('a strength-shaped dose ("5mg/mL", the formulation concentration) is not treated as a prescribed dose', () => {
    expect(structuredLineInputs({ dose: '5mg/mL', frequencyCode: 'QW', quantityLabel: null, sigText: 'Inject 10 units subcutaneously once weekly' }).dose)
      .toBe('10 units')
  })

  it('never parses a quantity out of the sig', () => {
    expect(structuredLineInputs({ dose: null, frequencyCode: null, quantityLabel: null, sigText: 'Take 1 capsule daily, dispense 30 capsules' }).quantityLabel)
      .toBeNull()
  })

  it('builderStateFromOrder applies the same rule: stored snapshot values beat a hand-edited sig', () => {
    expect(builderStateFromOrder({
      formulation_id: 'f1', pharmacy_id: 'p1', refills: 0, sig_text: HAND_EDITED_SIG,
      medication_snapshot: { prescribed_dose: '10 units', frequency_code: 'QW', quantity_label: '1mL vial' },
    })).toEqual(expect.objectContaining({ doseAmount: '10', doseUnit: 'units', frequency: 'QW', quantity: '1mL vial' }))
  })
})
