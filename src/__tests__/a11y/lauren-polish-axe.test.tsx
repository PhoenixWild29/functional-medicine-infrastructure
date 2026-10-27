/**
 * @jest-environment jsdom
 *
 * Lauren, 23 Oct polish: axe (WCAG 2.0/2.1 A and AA, best practice) on the
 * views this branch touched that other axe suites do not already render:
 * the ops stuck refunds and late payments panels, the product catalog summary,
 * the allergy notice (read failed), and the copy without em dashes. The
 * pending-review banner, checklist card and order drawer history have
 * their own axe checks (pending-review-banner, coaching-axe,
 * order-drawer-expired-history); the dashboard list, practice, refill
 * picker and sidebar are in clinic-ui-fixes-axe.
 */

import { render, cleanup } from '@testing-library/react'
import { configureAxe } from 'jest-axe'
import { StuckRefundsPanel, LatePaymentsPanel } from '@/app/(ops-dashboard)/ops/pipeline/_components/stuck-refunds-panel'
import { ProductCatalogSummary } from '@/app/(ops-dashboard)/ops/catalog/_components/product-catalog-summary'
import { AllergyNotice } from '@/app/(clinic-app)/new-prescription/review/_components/allergy-notice'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), replace: jest.fn() }) }))

const axe = configureAxe({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })
const ids = async (el: Element) => (await axe(el)).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)
const EM = '—'

afterEach(cleanup)

it('the ops stuck refunds and late payments panels', async () => {
  const { container } = render(
    <main>
      <StuckRefundsPanel result={{ ok: true, rows: [{ orderId: 'o-1', pendingSince: '2026-10-20T00:00:00Z', retailCents: 19000 }] }} />
      <LatePaymentsPanel result={{ ok: true, rows: [{ groupId: 'g-1', orderId: 'o-2', paymentIntent: 'pi_1', refundId: 're_1', refundOk: true, error: null, at: '2026-10-20T00:00:00Z' }] }} />
    </main>,
  )
  expect(container.textContent).not.toContain(` ${EM} `)
  expect(await ids(container)).toEqual([])
})

it('the product catalog summary', async () => {
  const { container } = render(<main><ProductCatalogSummary counts={{ ingredients: 12, saltForms: 14, formulations: 30, pharmacyOfferings: 55 }} /></main>)
  expect(container.textContent).not.toContain(` ${EM} `)
  expect(await ids(container)).toEqual([])
})

it('the allergy notice when the read failed', async () => {
  const { container } = render(
    <main>
      <AllergyNotice
        patient={{ patient_id: 'p', first_name: 'Alex', last_name: 'Demo', allergies: [], nkda: false, allergies_updated_at: null, allergiesLoadFailed: true } as never}
        onSaved={() => {}}
      />
    </main>,
  )
  expect(container.textContent).not.toContain(` ${EM} `)
  expect(await ids(container)).toEqual([])
})
