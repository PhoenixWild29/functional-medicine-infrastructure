/**
 * Ops nav after #215 (clinic onboarding at /ops/onboarding) met pharmacy
 * onboarding (/ops/onboarding/pharmacies). The active tab was any tab
 * whose href the path starts with, so on the pharmacy page both tabs were
 * aria-current="page". The current tab is now the longest matching href,
 * and the two tabs say which onboarding they are, side by side.
 */

import { render, screen } from '@testing-library/react'

let pathname = '/ops/pipeline'
jest.mock('next/navigation', () => ({ usePathname: () => pathname }))

import { OpsNav } from '../ops-nav'

const current = () =>
  screen.getAllByRole('link').filter(a => a.getAttribute('aria-current') === 'page').map(a => a.textContent)

it.each([
  ['/ops/onboarding', 'Clinic onboarding'],
  ['/ops/onboarding?invite=1', 'Clinic onboarding'],
  ['/ops/onboarding/pharmacies', 'Pharmacy onboarding'],
  ['/ops/onboarding/pharmacies/aaaaaaaa-0000-0000-0000-0000000000b2', 'Pharmacy onboarding'],
  ['/ops/pipeline', 'Pipeline'],
])('%s: exactly one current tab, %s', (path, label) => {
  pathname = path
  render(<OpsNav />)
  expect(current()).toEqual([label])
})

it('shows the clinic and pharmacy onboarding tabs, next to each other', () => {
  pathname = '/ops/pipeline'
  render(<OpsNav />)
  const labels = screen.getAllByRole('link').map(a => a.textContent)
  const clinic = labels.indexOf('Clinic onboarding')
  expect(clinic).toBeGreaterThanOrEqual(0)
  expect(labels[clinic + 1]).toBe('Pharmacy onboarding')
  expect(screen.getByRole('link', { name: 'Clinic onboarding' })).toHaveAttribute('href', '/ops/onboarding')
  expect(screen.getByRole('link', { name: 'Pharmacy onboarding' })).toHaveAttribute('href', '/ops/onboarding/pharmacies')
})
