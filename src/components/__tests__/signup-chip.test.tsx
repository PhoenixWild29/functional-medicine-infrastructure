/**
 * Patient Intake PR 3: a patient who signed up from the clinic's link says
 * so in Select Patient: "From sign-up link". Words, not colour alone;
 * nothing for any other source.
 */

import { render, screen } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { SignupChip } from '../signup-chip'

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })

it('signup_link: "From sign-up link", accessible', async () => {
  const { container } = render(<main><SignupChip source="signup_link" /></main>)
  expect(screen.getByTestId('signup-chip')).toHaveTextContent('From sign-up link')
  expect((await axe(container)).violations).toEqual([])
})

it.each(['staff', 'self_intake', 'csv_import', 'ehr', null, undefined])('%s: nothing', source => {
  const { container } = render(<SignupChip source={source} />)
  expect(container).toBeEmptyDOMElement()
})
