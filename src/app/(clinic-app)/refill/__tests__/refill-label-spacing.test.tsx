/**
 * Click-through, 14 Oct: the preselected refill item read
 * "5mg/mLtitration": the titration chip was spaced by CSS margin only, so
 * the text (what a screen reader reads, and what is copied) ran the dose
 * and "titration" together. There is now a real space between them.
 */

import { render, screen } from '@testing-library/react'
import { RefillPicker, type RefillablePatient } from '../_components/refill-picker'
import { PrescriptionSessionProvider } from '../../new-prescription/_context/prescription-session'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }) }))

const PATIENTS: RefillablePatient[] = [{
  patient: { patient_id: 'patient-1', first_name: 'Alex', last_name: 'Demo', date_of_birth: '1985-06-15', phone: '+15125550000', state: 'TX', sms_opt_in: true },
  orders: [{
    orderId: 'order-1', medicationName: 'Semaglutide', dose: '5mg/mL', pharmacyId: 'ph', pharmacyName: 'Strive Pharmacy',
    createdAt: '2026-08-12T10:00:00.000Z', status: 'DELIVERED', isTitration: true, packageLabel: null, packageCount: null,
    refillsUsed: 0, refillsAuthorized: 2, refillable: true, blockedReason: null,
  }],
}]

it('the dose and the titration label are separated by a space', () => {
  render(
    <PrescriptionSessionProvider>
      <RefillPicker patients={PATIENTS} provider={null} preselectOrderId="order-1" />
    </PrescriptionSessionProvider>,
  )
  const label = screen.getByText('titration').parentElement!
  expect(label.textContent).toContain('5mg/mL titration')
  expect(label.textContent).not.toContain('5mg/mLtitration')
})
