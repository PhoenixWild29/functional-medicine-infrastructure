/**
 * @jest-environment node
 *
 * An error on a route outside the clinic, ops and checkout groups (an
 * onboarding invite whose lookup fails, sign-up, login, legal, MFA) had no
 * error boundary, so Next served its bare default error document: no
 * <html lang> and no <title> (axe: html-has-lang, document-title, both
 * WCAG 2.1 A). Found by the all-routes axe pass on /onboard/clinic/[token]
 * and /onboard/join/[token] when the database could not be reached.
 *
 *   - src/app/error.tsx catches a page's error inside the root layout
 *     (which carries lang="en" and the CompoundIQ title): a main landmark,
 *     an h1 and a way to retry.
 *   - src/app/global-error.tsx replaces the document when the root layout
 *     itself fails, so it brings its own <html lang="en"> and <title>.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import RootError from '../error'
import GlobalError from '../global-error'

const err = Object.assign(new Error('lookup failed'), { digest: 'abc' })
const noop = () => {}

beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}) })

it('a page error: a main landmark with an h1 and a retry button, and no error detail', () => {
  const html = renderToStaticMarkup(<RootError error={err} reset={noop} />)
  expect(html).toMatch(/<main[^>]*>/)
  expect(html).toMatch(/<h1[^>]*>Something went wrong<\/h1>/)
  expect(html).toMatch(/<button[^>]*>Try again<\/button>/)
  expect(html).not.toContain('lookup failed')
})

it('a root layout error: its own document, with lang="en", a title, a main and an h1', () => {
  const html = renderToStaticMarkup(<GlobalError error={err} reset={noop} />)
  expect(html).toMatch(/^<html lang="en"/)
  expect(html).toMatch(/<title>Something went wrong \| CompoundIQ<\/title>/)
  expect(html).toMatch(/<main[^>]*>/)
  expect(html).toMatch(/<h1[^>]*>Something went wrong<\/h1>/)
  expect(html).not.toContain('lookup failed')
})
