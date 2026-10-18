/**
 * @jest-environment jsdom
 *
 * Self sign-up, pending review: the banner on every clinic page. Its words
 * are the spec's, verbatim (no em dashes; no promise of an email or text).
 * It links to the remaining setup steps. axe clean.
 */

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
