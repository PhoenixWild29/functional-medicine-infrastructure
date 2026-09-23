/**
 * The settings page shows clinic settings read-only to anyone but the
 * clinic admin, and says why.
 */

import { render, screen } from '@testing-library/react'
import { ClinicSettingsForm } from '../_components/clinic-settings-form'

describe('Clinic Profile for a non-admin', () => {
  it('shows the fields read-only, says only the clinic admin can change them, and offers no Save', () => {
    render(<ClinicSettingsForm clinicName="Sunrise" logoUrl="https://example.com/l.png" defaultMarkupPct={40} absorbShipping isClinicAdmin={false} />)
    expect(screen.getByTestId('settings-read-only')).toHaveTextContent('Only the clinic admin can change these settings.')
    expect(screen.getByLabelText('Default Markup %')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Absorb shipping costs' })).toBeDisabled()
    expect(screen.getByLabelText('Logo URL')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save Settings' })).not.toBeInTheDocument()
  })

  it('the clinic admin can edit and save', () => {
    render(<ClinicSettingsForm clinicName="Sunrise" logoUrl={null} defaultMarkupPct={40} isClinicAdmin />)
    expect(screen.queryByTestId('settings-read-only')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Default Markup %')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save Settings' })).toBeEnabled()
  })
})
