/**
 * WO-107: the markup help text matches what is stored (40 → 1.4×), and the
 * practice-dashboard toggle is the clinic admin's.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ClinicSettingsForm } from '../_components/clinic-settings-form'

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })) as unknown as typeof fetch
})

describe('Clinic Profile', () => {
  it('reads "Example: 40 = 40% markup (1.4× wholesale)"', () => {
    render(<ClinicSettingsForm clinicName="Sunrise" logoUrl={null} defaultMarkupPct={40} />)
    expect(screen.getByText(/Example:/)).toHaveTextContent('Example: 40 = 40% markup (1.4× wholesale).')
    expect(screen.queryByText(/150% of wholesale/)).not.toBeInTheDocument()
  })

  it('the clinic admin sees the toggle and saving sends it', async () => {
    render(<ClinicSettingsForm clinicName="Sunrise" logoUrl={null} defaultMarkupPct={40} isClinicAdmin practiceVisibleToProviders={false} />)
    fireEvent.click(screen.getByTestId('practice-visible-to-providers'))
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))
    expect(body).toMatchObject({ practice_dashboard_visible_to_providers: true })
  })

  it('anyone else does not see it', () => {
    render(<ClinicSettingsForm clinicName="Sunrise" logoUrl={null} defaultMarkupPct={40} practiceVisibleToProviders />)
    expect(screen.queryByTestId('practice-visible-to-providers')).not.toBeInTheDocument()
  })
})
