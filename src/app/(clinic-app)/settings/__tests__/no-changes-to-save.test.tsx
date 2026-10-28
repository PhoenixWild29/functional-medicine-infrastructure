/**
 * Saving an untouched Clinic Profile says "No changes to save." and sends
 * nothing (it used to resend the markup and say "Settings saved").
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ClinicSettingsForm } from '../_components/clinic-settings-form'

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })) as unknown as typeof fetch
})

it('an untouched form says "No changes to save." and sends nothing', async () => {
  render(<ClinicSettingsForm clinicName="Sunrise" logoUrl={null} defaultMarkupPct={40} isClinicAdmin />)
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
  await waitFor(() => expect(screen.getByText('No changes to save.')).toBeInTheDocument())
  expect(global.fetch).not.toHaveBeenCalled()
  expect(screen.queryByText(/Settings saved successfully/)).not.toBeInTheDocument()
})

it('a changed markup is still sent', async () => {
  render(<ClinicSettingsForm clinicName="Sunrise" logoUrl={null} defaultMarkupPct={40} isClinicAdmin />)
  fireEvent.change(screen.getByDisplayValue('40'), { target: { value: '50' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  const body = JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body))
  expect(body).toMatchObject({ default_markup_pct: 50 })
})
