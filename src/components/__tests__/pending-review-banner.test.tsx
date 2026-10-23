/**
 * @jest-environment jsdom
 *
 * Self sign-up, pending review: the banner on every clinic page. Its words
 * are the spec's, verbatim (no em dashes; no promise of an email or text).
 * It links to the remaining setup steps. axe clean.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { PendingReviewBanner } from '../pending-review-banner'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })

it('says what is happening in the spec words, and links to the remaining setup steps', () => {
  render(<PendingReviewBanner />)
  const banner = screen.getByRole('region', { name: 'Account under review' })
  expect(banner).toHaveTextContent("We're verifying your licenses. You can look around; ordering opens once you're approved.")
  const link = screen.getByRole('link', { name: 'See your remaining setup steps' })
  expect(link).toHaveAttribute('href', '/onboarding')
  expect(banner.textContent).not.toMatch(/—/)
  expect(banner.textContent).not.toMatch(/email|text message|we will contact/i)
})

it('is axe clean', async () => {
  const { container } = render(<main><PendingReviewBanner /></main>)
  expect((await axe(container)).violations).toEqual([])
})

// Lauren, 23 Oct: once the clinic has submitted for review, the banner
// says so instead of pointing at remaining setup steps, and links to
// what was submitted. Before submission it is unchanged.
describe('after the clinic has submitted for review', () => {
  it('says it was submitted and links to what was submitted', () => {
    render(<PendingReviewBanner submitted />)
    const banner = screen.getByRole('region', { name: 'Account under review' })
    expect(banner).toHaveTextContent("Submitted. We're reviewing your clinic; ordering opens once you're approved.")
    expect(screen.getByRole('link', { name: 'View what you submitted' })).toHaveAttribute('href', '/onboarding')
    expect(screen.queryByRole('link', { name: 'See your remaining setup steps' })).toBeNull()
    expect(banner.textContent).not.toMatch(/—/)
  })

  it('before submission the text is unchanged', () => {
    render(<PendingReviewBanner submitted={false} />)
    expect(screen.getByRole('link', { name: 'See your remaining setup steps' })).toHaveAttribute('href', '/onboarding')
    expect(screen.queryByText(/^Submitted\./)).toBeNull()
  })

  it('is axe clean', async () => {
    const { container } = render(<main><PendingReviewBanner submitted /></main>)
    expect((await axe(container)).violations).toEqual([])
  })

  it('the clinic layout tells the banner when the clinic has submitted', () => {
    const layout = readFileSync(join(process.cwd(), 'src', 'app', '(clinic-app)', 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/<PendingReviewBanner submitted=\{clinicSubmitted\} \/>/)
    expect(layout).toMatch(/clinicSubmitted = clinic\?\.onboarding_status === 'submitted'/)
  })
})
