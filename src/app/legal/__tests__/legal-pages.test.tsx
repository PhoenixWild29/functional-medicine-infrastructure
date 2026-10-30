/**
 * Public legal pages: /legal/privacy and /legal/patient-terms.
 *
 * They render the final v1.0 Markdown under src/content/legal/ with
 * LegalMarkdown (React text only), so replacing the Markdown changes the
 * page with no code change. The text carries its own version line
 * ("Version 1.0. Effective October 12, 2026."); there is no draft banner.
 * No session is needed: nothing here reads auth.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import PrivacyPage from '../privacy/page'
import PatientTermsPage from '../patient-terms/page'
import { PUBLIC_LEGAL_DOCUMENTS } from '@/lib/legal/public-documents'
import { LegalMarkdown } from '@/components/onboarding/legal-markdown'

// No session exists on these pages: any auth read would throw.
jest.mock('@/lib/supabase/server', () => ({ createServerClient: () => { throw new Error('legal pages must not read auth') } }))
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('legal pages must not read the database') } }))

const md = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

describe.each([
  ['privacy', PrivacyPage, 'Privacy Policy', 'src/content/legal/privacy-policy-v1.1.md', '1.1', 'October 30, 2026'],
  ['patientTerms', PatientTermsPage, 'Patient Terms of Use', 'src/content/legal/patient-terms-v1.0.md', '1.0', 'October 12, 2026'],
] as const)('%s', (key, Page, title, file, version, effective) => {
  it('renders without a session: the Markdown title as the page heading', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('is the final text, with its version line', () => {
    const doc = PUBLIC_LEGAL_DOCUMENTS[key]
    expect(doc.file).toBe(file)
    expect(doc.version).toBe(version)
    expect(doc.effective).toBe(effective)
    const text = md(file).replace(/\r\n/g, '\n')
    expect(text.startsWith(`# ${title}\n`)).toBe(true)
    expect(text).toContain(`_Version ${version}. Effective ${effective}._`)
    render(<Page />)
    expect(screen.getAllByText(`Version ${version}. Effective ${effective}.`)).toHaveLength(1)
  })

  it('shows no draft banner, draft line or draft wording', () => {
    const { container } = render(<Page />)
    expect(container.textContent).not.toMatch(/DRAFT|Draft|draft|pending legal review/)
    expect('draft' in PUBLIC_LEGAL_DOCUMENTS[key]).toBe(false)
  })
})

it('LegalMarkdown can start at h1 for a standalone page', () => {
  render(<LegalMarkdown text={'# Title\n\n## Section\n\nBody'} headingLevel={1} />)
  expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument()
})

it('markup in the Markdown is shown as text, never injected', () => {
  const { container } = render(<LegalMarkdown text={'# T\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>'} headingLevel={1} />)
  expect(container.querySelector('script, img')).toBeNull()
  expect(within(container).getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument()
})
