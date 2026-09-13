/**
 * WO-98: draft-edit helpers — the diff written to the audit row, the
 * builder state recovered from a draft row, and the return path.
 */

import {
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
    })
  })
})

describe('draftReturnPath', () => {
  it('sends providers back to the draft and everyone else to the dashboard', () => {
    expect(draftReturnPath('o1', true)).toBe('/new-prescription/sign/o1')
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
