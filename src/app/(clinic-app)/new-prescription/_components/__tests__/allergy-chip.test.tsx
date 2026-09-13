/**
 * WO-97 allergy chip + inline editor.
 *
 * Pins:
 *   - The chip renders the three states with the right tone.
 *   - Clicking the chip opens the editor inline (no navigation).
 *   - Save PATCHes /api/patients/[id]/allergies with the normalised
 *     list, or nkda: true with an empty list, and hands the stored
 *     values back to the caller.
 *   - NKDA and a list are mutually exclusive in the editor itself.
 *   - A failed save keeps the editor open with the error visible.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { AllergyChip, AllergyEditor, EditableAllergyChip } from '../allergy-chip'

const PATIENT_ID = 'a3000000-0000-0000-0000-000000000001'

function mockFetchOk(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }) as unknown as typeof fetch
}

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch
})

describe('AllergyChip — three states', () => {
  it('NKDA', () => {
    render(<AllergyChip patient={{ nkda: true, allergies: [] }} />)
    const chip = screen.getByTestId('allergy-chip')
    expect(chip).toHaveTextContent('NKDA')
    expect(chip).toHaveAttribute('data-allergy-status', 'nkda')
    expect(chip.tagName).toBe('SPAN')
  })

  it('recorded list', () => {
    render(<AllergyChip patient={{ nkda: false, allergies: ['penicillin', 'sulfa'] }} />)
    const chip = screen.getByTestId('allergy-chip')
    expect(chip).toHaveTextContent('Allergies: penicillin, sulfa')
    expect(chip).toHaveAttribute('data-allergy-status', 'recorded')
  })

  it('not recorded (amber) — also for a patient with no allergy fields at all', () => {
    render(<AllergyChip patient={{}} />)
    const chip = screen.getByTestId('allergy-chip')
    expect(chip).toHaveTextContent('Allergies: not recorded')
    expect(chip).toHaveAttribute('data-allergy-status', 'not_recorded')
    expect(chip.className).toMatch(/amber/)
  })

  it('is a button when clickable', () => {
    const onClick = jest.fn()
    render(<AllergyChip patient={{ nkda: true }} onClick={onClick} />)
    const chip = screen.getByRole('button', { name: /NKDA/ })
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('AllergyEditor', () => {
  it('saves a normalised list and reports the stored values', async () => {
    mockFetchOk({ patientId: PATIENT_ID, allergies: ['penicillin', 'sulfa'], nkda: false, allergiesUpdatedAt: '2026-09-12T10:00:00Z' })
    const onSaved = jest.fn()
    render(<AllergyEditor patientId={PATIENT_ID} patient={{}} onSaved={onSaved} onCancel={jest.fn()} />)

    const input = screen.getByLabelText('Drug allergies')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: 'Penicillin, penicillin ; sulfa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save allergies' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({
      allergies: ['penicillin', 'sulfa'],
      nkda: false,
      allergiesUpdatedAt: '2026-09-12T10:00:00Z',
    }))
    expect(global.fetch).toHaveBeenCalledWith(`/api/patients/${PATIENT_ID}/allergies`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ allergies: ['Penicillin', 'sulfa'], nkda: false }),
    }))
  })

  it('NKDA clears and disables the list; typing an allergy un-ticks NKDA', async () => {
    mockFetchOk({ allergies: [], nkda: true, allergiesUpdatedAt: '2026-09-12T10:00:00Z' })
    const onSaved = jest.fn()
    render(<AllergyEditor patientId={PATIENT_ID} patient={{ allergies: ['sulfa'] }} onSaved={onSaved} onCancel={jest.fn()} />)

    const input = screen.getByLabelText('Drug allergies')
    expect(input).toHaveValue('sulfa')
    const nkda = screen.getByLabelText(/No known drug allergies/)
    fireEvent.click(nkda)
    expect(nkda).toBeChecked()
    expect(input).toHaveValue('')
    expect(input).toBeDisabled()

    // Un-tick, type: NKDA stays off.
    fireEvent.click(nkda)
    fireEvent.change(input, { target: { value: 'latex' } })
    expect(nkda).not.toBeChecked()

    // Tick NKDA again and save → nkda: true with an empty list.
    fireEvent.click(nkda)
    fireEvent.click(screen.getByRole('button', { name: 'Save allergies' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ nkda: true, allergies: [] })))
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      body: JSON.stringify({ allergies: [], nkda: true }),
    }))
  })

  it('Enter saves, Escape cancels', async () => {
    mockFetchOk({ allergies: ['sulfa'], nkda: false, allergiesUpdatedAt: null })
    const onSaved = jest.fn()
    const onCancel = jest.fn()
    render(<AllergyEditor patientId={PATIENT_ID} patient={{}} onSaved={onSaved} onCancel={onCancel} />)
    const input = screen.getByLabelText('Drug allergies')
    fireEvent.change(input, { target: { value: 'sulfa' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
  })

  it('a failed save keeps the editor open and shows the server error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'nkda cannot be true when allergies are listed' }) }) as unknown as typeof fetch
    const onSaved = jest.fn()
    render(<AllergyEditor patientId={PATIENT_ID} patient={{}} onSaved={onSaved} onCancel={jest.fn()} />)
    fireEvent.change(screen.getByLabelText('Drug allergies'), { target: { value: 'sulfa' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save allergies' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('nkda cannot be true')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByTestId('allergy-editor')).toBeInTheDocument()
  })
})

describe('EditableAllergyChip — chip toggles the inline editor', () => {
  it('opens on click, closes on save, and hands the result up', async () => {
    mockFetchOk({ allergies: [], nkda: true, allergiesUpdatedAt: '2026-09-12T10:00:00Z' })
    const onSaved = jest.fn()
    render(<EditableAllergyChip patientId={PATIENT_ID} patient={{}} onSaved={onSaved} />)

    expect(screen.queryByTestId('allergy-editor')).not.toBeInTheDocument()
    const chip = screen.getByRole('button', { name: /Allergies: not recorded/ })
    fireEvent.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')
    const editor = screen.getByTestId('allergy-editor')

    fireEvent.click(within(editor).getByLabelText(/No known drug allergies/))
    fireEvent.click(within(editor).getByRole('button', { name: 'Save allergies' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ nkda: true })))
    expect(screen.queryByTestId('allergy-editor')).not.toBeInTheDocument()
  })

  it('Cancel closes without saving', () => {
    render(<EditableAllergyChip patientId={PATIENT_ID} patient={{ nkda: true }} onSaved={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /NKDA/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('allergy-editor')).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
