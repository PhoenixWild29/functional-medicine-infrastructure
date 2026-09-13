/**
 * WO-98: updatePrescription — the session primitive edit-at-review
 * saves through. A patched line keeps its client id and position so
 * the Review card updates in place and totals recompute.
 */

import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PrescriptionSessionProvider, usePrescriptionSession, type SessionPrescription } from '../prescription-session'

const wrapper = ({ children }: { children: ReactNode }) => (
  <PrescriptionSessionProvider>{children}</PrescriptionSessionProvider>
)

function line(name: string, retailCents: number, extra: Partial<Omit<SessionPrescription, 'id'>> = {}): Omit<SessionPrescription, 'id'> {
  return {
    pharmacyId: 'ph1', pharmacyName: 'Strive', itemId: null, formulationId: `f-${name}`,
    medicationName: name, form: 'Injectable Solution', dose: '10 units',
    wholesaleCents: 9500, deaSchedule: null, retailCents,
    sigText: `Inject 10 units subcutaneously once weekly (${name})`, integrationTier: '',
    frequencyCode: 'QW', quantityLabel: '5mL vial',
    ...extra,
  }
}

beforeEach(() => {
  sessionStorage.clear()
})

describe('updatePrescription', () => {
  it('patches the line in place — same id, same position, other lines untouched', () => {
    const { result } = renderHook(() => usePrescriptionSession(), { wrapper })
    act(() => {
      result.current.addPrescription(line('Semaglutide', 19000))
      result.current.addPrescription(line('BPC-157', 12000))
    })
    const [sema, bpc] = result.current.prescriptions
    expect(sema && bpc).toBeTruthy()

    act(() => {
      result.current.updatePrescription(sema!.id, {
        dose: '15 units',
        sigText: 'Inject 15 units subcutaneously once weekly',
        retailCents: 21000,
      })
    })

    const after = result.current.prescriptions
    expect(after.map(rx => rx.id)).toEqual([sema!.id, bpc!.id])
    expect(after[0]).toMatchObject({
      id: sema!.id, medicationName: 'Semaglutide', dose: '15 units',
      sigText: 'Inject 15 units subcutaneously once weekly', retailCents: 21000,
      // untouched fields survive the patch
      pharmacyName: 'Strive', frequencyCode: 'QW', quantityLabel: '5mL vial',
    })
    expect(after[1]).toMatchObject({ id: bpc!.id, retailCents: 12000 })
    // totals recompute from the patched line
    expect(after.reduce((sum, rx) => sum + rx.retailCents, 0)).toBe(33000)
  })

  it('ignores an unknown id and never lets a patch change the id', () => {
    const { result } = renderHook(() => usePrescriptionSession(), { wrapper })
    act(() => { result.current.addPrescription(line('Semaglutide', 19000)) })
    const before = result.current.prescriptions
    act(() => {
      result.current.updatePrescription('nope', { retailCents: 1 })
      result.current.updatePrescription(before[0]!.id, { id: 'hijack', retailCents: 500 } as Partial<SessionPrescription>)
    })
    expect(result.current.prescriptions[0]).toMatchObject({ id: before[0]!.id, retailCents: 500 })
    expect(result.current.prescriptions).toHaveLength(1)
  })

  it('persists the patched line so a navigation (sessionStorage restore) keeps it', () => {
    const { result } = renderHook(() => usePrescriptionSession(), { wrapper })
    act(() => {
      result.current.setPatient({ patient_id: 'p1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '', state: 'TX', sms_opt_in: true })
      result.current.setProvider({ provider_id: 'pr1', first_name: 'Sarah', last_name: 'Chen', npi_number: '1234567890', signature_hash: null })
      result.current.addPrescription(line('Semaglutide', 19000))
    })
    const id = result.current.prescriptions[0]!.id
    act(() => { result.current.updatePrescription(id, { dose: '15 units' }) })

    const stored = JSON.parse(sessionStorage.getItem('compoundiq-rx-session') ?? '{}') as { prescriptions: SessionPrescription[] }
    expect(stored.prescriptions[0]).toMatchObject({ id, dose: '15 units' })
  })
})
