/**
 * Pharmacy wizard, agreement step (prod findings):
 *
 *   1. The BAA was shown as raw Markdown ("# Business Associate
 *      Agreement", "_Draft v0.1..._", "> DRAFT...", "## 1. Definitions",
 *      "- " bullets). It now uses the clinic wizard's LegalMarkdown
 *      renderer: real headings, lists, blockquote and emphasis, all React
 *      text (no injected HTML).
 *   2. The step was titled "BAA and terms" but only the BAA is shown. The
 *      only terms text in the shared source (AGREEMENTS.terms) is the
 *      clinic's terms of service (it speaks of the clinic, its providers
 *      and prescribing), so it is not shown to pharmacies; the step is
 *      titled "BAA" wherever it appears.
 *
 * The expectations are derived from the shared BAA text itself, so a new
 * BAA version does not break them.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/react'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }), usePathname: () => '/pharmacy/onboarding' }))

import { OnboardingWizard } from '@/app/pharmacy/onboarding/_components/onboarding-wizard'
import { PharmacyApplicationReview } from '@/app/(ops-dashboard)/ops/onboarding/_components/pharmacy/pharmacy-application-review'
import { AGREEMENT, agreementText, agreementTextSha256 } from '@/lib/pharmacy-onboarding/agreement'
import { ONBOARDING_STEPS } from '@/lib/pharmacy-onboarding/steps'
import type { WizardState } from '@/lib/pharmacy-onboarding/application'
import { PHARMACY_TERMS } from '@/lib/onboarding/agreement-texts'

const BEFORE_AGREEMENT = ['details', 'facility', 'licenses', 'ordering', 'shipping']

function state(over: Partial<WizardState> = {}): WizardState {
  return {
    status: 'in_progress', stepsCompleted: BEFORE_AGREEMENT, reviewNote: null, submittedAt: null,
    pharmacy: { name: 'Strive Pharmacy', ship_carriers: [], ship_to_states: [] },
    licenses: [], ordering: null, catalog: { choice: null, rowCount: null, warnings: [] },
    agreement: { key: AGREEMENT.key, version: AGREEMENT.version, title: AGREEMENT.title, text: agreementText(), textSha256: agreementTextSha256(), acceptance: null },
    terms: { key: 'pharmacy_terms', version: PHARMACY_TERMS.version, title: PHARMACY_TERMS.title, text: PHARMACY_TERMS.text, textSha256: 'x'.repeat(64), acceptance: null },
    ...over,
  }
}

const lines = agreementText().split('\n').map(l => l.trimEnd())
const headingLines = lines.filter(l => /^#{1,3}\s+/.test(l)).map(l => l.replace(/^#{1,3}\s+/, ''))
const bulletCount = lines.filter(l => l.startsWith('- ')).length
const quoteCount = lines.filter(l => l.startsWith('> ')).length

describe('the BAA text is rendered, not shown as Markdown source', () => {
  it('headings, list items and the draft blockquote are real elements', () => {
    render(<OnboardingWizard initial={state()} />)
    const region = screen.getByRole('region', { name: /agreement text/i })
    const headings = within(region).getAllByRole('heading')
    expect(headingLines.length).toBeGreaterThan(1)
    expect(headings.map(h => h.textContent)).toEqual(headingLines)
    // Below the step's own h2.
    expect(headings[0]!.tagName).toBe('H3')
    expect(within(region).getAllByRole('listitem').length).toBe(bulletCount)
    expect(region.querySelectorAll('blockquote').length).toBe(quoteCount)
  })

  it('no Markdown markers are left in the text', () => {
    render(<OnboardingWizard initial={state()} />)
    const region = screen.getByRole('region', { name: /agreement text/i })
    for (const el of Array.from(region.querySelectorAll('h3, h4, h5, h6, p, li, blockquote'))) {
      const t = (el.textContent ?? '').trimStart()
      expect(t).not.toMatch(/^#{1,3}\s/)
      expect(t).not.toMatch(/^>\s/)
      expect(t).not.toMatch(/^-\s/)
      expect(t).not.toMatch(/^_.*_$/)
    }
    expect(region.textContent).not.toContain('# ')
    expect(region.textContent).not.toContain('## ')
  })

  it('the step renders no injected HTML', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/pharmacy/onboarding/_components/steps.tsx'), 'utf8')
    expect(src).not.toMatch(/dangerouslySetInnerHTML/)
  })
})

describe('the step is titled "BAA" (only the BAA is shown)', () => {
  it('step list, heading and review summary', () => {
    expect(ONBOARDING_STEPS.find(s => s.key === 'agreement')!.label).toBe('BAA')
    const { unmount } = render(<OnboardingWizard initial={state()} />)
    expect(screen.getByRole('heading', { level: 2, name: 'BAA' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Onboarding steps' })
    expect(within(nav).getByRole('button', { name: /^BAA$/ })).toHaveAttribute('aria-current', 'step')
    expect(document.body.textContent).not.toMatch(/BAA and terms/i)
    unmount()

    render(<OnboardingWizard initial={state({ status: 'submitted', stepsCompleted: [...BEFORE_AGREEMENT, 'agreement', 'catalog'] })} />)
    const summary = screen.getByRole('list', { name: 'Steps' })
    expect(within(summary).getByText('BAA')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/BAA and terms/i)
  })

  it('the ops review says BAA too', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ review: {
      applicationId: 'a-1', pharmacyId: 'p-1', status: 'submitted', stepsCompleted: [], submittedAt: null, reviewNote: null,
      pharmacy: { name: 'Strive Pharmacy' }, ordering: { method: 'fax', faxNumber: '+15125550199' }, adapter: { required: false, configuredAt: null }, acceptances: { baa: null, terms: null },
      catalog: { choice: 'skipped', rowCount: null, warnings: [], rows: [] }, events: [], licenses: [],
    } }) })) as unknown as typeof fetch
    render(<PharmacyApplicationReview applicationId="a-1" />)
    expect(await screen.findByRole('heading', { name: 'BAA' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/BAA and terms/i)
  })
})
