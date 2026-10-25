/**
 * Coverage gap 6 on the Review card: saved clinical difference statements.
 *
 *   - The clinical difference field lists the clinic's saved statements
 *     for this formulation as one-click choices, this patient's first,
 *     next to the standard list.
 *   - Choosing one fills the field (as "Other (describe)", so it stays
 *     editable). Nothing is chosen automatically: the select still reads
 *     "Select a reason…" and no change is sent on load.
 *   - A typed statement can be saved for the practice or for this patient.
 *   - The chosen statement prints on the Rx exactly as any statement does.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { RxDetailsRow } from '../rx-details-row'
import { defaultRxDetails, STANDARD_CLINICAL_DIFFERENCE_OPTIONS, type RxDetails, type RxRules } from '@/lib/orders/rx-details'
import { buildPrescriptionPdfBytes } from '@/lib/adapters/prescription-pdf'

const FORM = 'a7000000-0000-4000-8000-000000000001'
const PAT  = 'a3000000-0000-4000-8000-000000000001'
const MINE = 'Glycine added to help maintain muscle mass'
const PRACTICE = 'Dye-free preparation for a documented dye sensitivity'

const RULES: RxRules = {
  isControlled: false,
  requiresClinicalDifference: true,
  clinicalDifferenceOptions: [...STANDARD_CLINICAL_DIFFERENCE_OPTIONS],
}

let saved: Array<{ statement_id: string; statement: string; scope: 'patient' | 'practice' }> = []
let calls: Array<{ url: string; method: string; body: unknown }> = []

beforeEach(() => {
  saved = [
    { statement_id: 's-mine', statement: MINE, scope: 'patient' },
    { statement_id: 's-prac', statement: PRACTICE, scope: 'practice' },
  ]
  calls = []
  global.fetch = jest.fn(async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (method === 'POST') {
      const body = JSON.parse(String(init!.body)) as { statement: string; patient_id: string | null }
      const row = { statement_id: 's-new', statement: body.statement, scope: body.patient_id ? 'patient' as const : 'practice' as const }
      saved = [...saved, row]
      return { ok: true, status: 201, json: async () => ({ data: row }) } as unknown as Response
    }
    return { ok: true, status: 200, json: async () => ({ data: saved }) } as unknown as Response
  }) as unknown as typeof fetch
})

function renderRow(details: RxDetails = defaultRxDetails(null), onChange = jest.fn()) {
  const utils = render(
    <RxDetailsRow
      lineId="line-1"
      details={details}
      rules={RULES}
      missing={details.clinicalDifference ? [] : ['clinical_difference']}
      disabled={false}
      onChange={onChange}
      formulationId={FORM}
      patient={{ patientId: PAT, name: 'Alex Demo' }}
    />,
  )
  return { ...utils, onChange }
}

describe('saved statements at the clinical difference step', () => {
  it("lists this patient's statements first, then the practice's; nothing is chosen automatically", async () => {
    const { onChange } = renderRow()
    const list = await screen.findByTestId('saved-clinical-statements-line-1')
    expect(calls[0]!.url).toBe(`/api/clinical-statements?formulation_id=${FORM}&patient_id=${PAT}`)
    const choices = within(list).getAllByRole('button', { name: /^Use: / })
    expect(choices.map(b => b.textContent)).toEqual([`${MINE}For Alex Demo`, PRACTICE])
    expect(within(list).getByText('Saved statements')).toBeInTheDocument()
    expect((screen.getByLabelText('Clinical difference (required)') as HTMLSelectElement).value).toBe('')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('choosing one fills the field as "Other (describe)", still editable', async () => {
    const { onChange, rerender } = renderRow()
    fireEvent.click(await screen.findByRole('button', { name: `Use: ${MINE}` }))
    expect(onChange).toHaveBeenCalledWith({ clinicalDifference: MINE })
    rerender(
      <RxDetailsRow
        lineId="line-1" details={{ ...defaultRxDetails(null), clinicalDifference: MINE }} rules={RULES} missing={[]}
        disabled={false} onChange={onChange} formulationId={FORM} patient={{ patientId: PAT, name: 'Alex Demo' }}
      />,
    )
    expect((screen.getByLabelText('Clinical difference (required)') as HTMLSelectElement).value).toBe('__other__')
    const other = screen.getByLabelText('Clinical difference (other)') as HTMLInputElement
    expect(other.value).toBe(MINE)
    fireEvent.change(other, { target: { value: `${MINE}, 2 mg` } })
    expect(onChange).toHaveBeenLastCalledWith({ clinicalDifference: `${MINE}, 2 mg` })
  })

  it('a typed statement can be saved for the practice or for this patient', async () => {
    const typed = 'Lidocaine removed for a documented allergy to amide anesthetics'
    renderRow({ ...defaultRxDetails(null), clinicalDifference: typed })
    const save = await screen.findByTestId('save-clinical-statement-line-1')
    fireEvent.click(within(save).getByRole('button', { name: 'Save for Alex Demo only' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST')).toBe(true))
    expect(calls.find(c => c.method === 'POST')!.body).toEqual({ formulation_id: FORM, statement: typed, patient_id: PAT })
    expect(await screen.findByRole('button', { name: `Use: ${typed}` })).toBeInTheDocument()
  })

  it('"Save for the practice" saves with no patient', async () => {
    const typed = 'Preservative-free for a documented benzyl alcohol sensitivity'
    renderRow({ ...defaultRxDetails(null), clinicalDifference: typed })
    fireEvent.click(within(await screen.findByTestId('save-clinical-statement-line-1')).getByRole('button', { name: 'Save for the practice' }))
    await waitFor(() => expect(calls.find(c => c.method === 'POST')!.body).toEqual({ formulation_id: FORM, statement: typed, patient_id: null }))
  })

  it('no save offer for a standard reason, an already-saved statement, or one shorter than 20 characters', async () => {
    const { rerender } = renderRow({ ...defaultRxDetails(null), clinicalDifference: STANDARD_CLINICAL_DIFFERENCE_OPTIONS[0]! })
    await screen.findByTestId('saved-clinical-statements-line-1')
    expect(screen.queryByTestId('save-clinical-statement-line-1')).not.toBeInTheDocument()
    for (const value of [MINE, 'too short']) {
      rerender(
        <RxDetailsRow
          lineId="line-1" details={{ ...defaultRxDetails(null), clinicalDifference: value }} rules={RULES} missing={[]}
          disabled={false} onChange={jest.fn()} formulationId={FORM} patient={{ patientId: PAT, name: 'Alex Demo' }}
        />,
      )
      expect(screen.queryByTestId('save-clinical-statement-line-1')).not.toBeInTheDocument()
    }
  })

  it('without a formulation (a legacy catalog line) nothing is fetched and the field works as before', () => {
    render(
      <RxDetailsRow lineId="line-2" details={defaultRxDetails(null)} rules={RULES} missing={['clinical_difference']} disabled={false} onChange={jest.fn()} />,
    )
    expect(calls).toEqual([])
    expect(screen.queryByTestId('saved-clinical-statements-line-2')).not.toBeInTheDocument()
  })
})

describe('the printed Rx', () => {
  it('prints a saved statement as "Clinical difference: ..." like any statement', () => {
    const text = new TextDecoder().decode(buildPrescriptionPdfBytes({
      providerFirstName: 'Sarah', providerLastName: 'Chen', providerNpi: '1234567890', providerDea: null, providerLicenseState: 'TX',
      patientFirstName: 'Alex', patientLastName: 'Demo', patientDateOfBirth: '1985-06-15',
      patientAddressLine1: '1 Main St', patientAddressLine2: null, patientCity: 'Austin', patientState: 'TX', patientZip: '78701',
      medicationName: 'Semaglutide 5mg/mL Injectable', medicationForm: 'Injectable Solution', medicationDose: '5mg/mL',
      quantity: 1, sigText: 'Inject 10 units weekly', clinicalDifference: MINE,
      orderNumber: 'CMP-1', orderDate: '2026-10-25T00:00:00Z', clinicName: 'Sunrise Functional Medicine', pharmacyName: 'Strive Pharmacy',
    }))
    expect(text).toContain(`Clinical difference: ${MINE}`)
  })
})
