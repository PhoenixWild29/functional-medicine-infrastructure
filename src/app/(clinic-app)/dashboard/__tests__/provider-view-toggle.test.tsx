/**
 * F-3 follow-up: provider opt-in clinic view toggle — UI behavior.
 *
 * The toggle re-points the URL between '/dashboard' and
 * '/dashboard?view=clinic' so the Next server component can re-render
 * with the correct Supabase header. Both buttons have aria-pressed for
 * a11y; the active button is reflected immediately on click.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { ProviderViewToggle } from '../_components/provider-view-toggle'

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter:   () => ({ push: pushMock }),
  usePathname: () => '/dashboard',
}))

beforeEach(() => {
  pushMock.mockReset()
})

describe('<ProviderViewToggle />', () => {
  it('renders both options with the current view marked aria-pressed', () => {
    render(<ProviderViewToggle viewMode="mine" />)
    expect(screen.getByRole('button', { name: 'My patients' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All clinic orders' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking "All clinic orders" pushes ?view=clinic', () => {
    render(<ProviderViewToggle viewMode="mine" />)
    fireEvent.click(screen.getByRole('button', { name: 'All clinic orders' }))
    expect(pushMock).toHaveBeenCalledWith('/dashboard?view=clinic', { scroll: false })
  })

  it('clicking "My patients" pushes the bare path (no query)', () => {
    render(<ProviderViewToggle viewMode="clinic" />)
    fireEvent.click(screen.getByRole('button', { name: 'My patients' }))
    expect(pushMock).toHaveBeenCalledWith('/dashboard', { scroll: false })
  })

  it('clicking the already-active option is a no-op', () => {
    render(<ProviderViewToggle viewMode="mine" />)
    fireEvent.click(screen.getByRole('button', { name: 'My patients' }))
    expect(pushMock).not.toHaveBeenCalled()
  })
})
