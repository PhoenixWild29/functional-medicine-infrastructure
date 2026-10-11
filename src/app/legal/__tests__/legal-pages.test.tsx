/**
 * Public legal pages: /legal/privacy and /legal/patient-terms.
 *
 * They render the Markdown under src/content/legal/ with LegalMarkdown
 * (React text only), so replacing the Markdown changes the page with no
 * code change. Each shows the draft banner and a version line, and needs
 * no session: nothing here reads auth.
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
  ['privacy', PrivacyPage, 'Privacy Policy', 'src/content/legal/privacy-policy-draft-v0.1.md'],
  ['patientTerms', PatientTermsPage, 'Patient Terms of Use', 'src/content/legal/patient-terms-draft-v0.1.md'],
] as const)('%s', (key, Page, title, file) => {
  it('renders without a session: the Markdown title as the page heading', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('shows the draft banner and a version line', () => {
    render(<Page />)
    expect(screen.getByText(/Draft, pending legal review/)).toBeInTheDocument()
    const doc = PUBLIC_LEGAL_DOCUMENTS[key]
    expect(doc.version).toBe('v0.1')
    expect(screen.getByText(`Version ${doc.version} (draft)`)).toBeInTheDocument()
  })

  it('the Markdown file is a title plus the DRAFT banner line, and the page renders it', () => {
    const text = md(file)
    expect(PUBLIC_LEGAL_DOCUMENTS[key].file).toBe(file)
    expect(text.replace(/\r\n/g, '\n').startsWith(`# ${title}\n`)).toBe(true)
    expect(text).toMatch(/^> DRAFT, PENDING LEGAL REVIEW\./m)
    render(<Page />)
    expect(screen.getByText(/^DRAFT, PENDING LEGAL REVIEW\./)).toBeInTheDocument()
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
