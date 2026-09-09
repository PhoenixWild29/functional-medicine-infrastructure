/**
 * Protocol quick-load: partial success, total block, and idempotency.
 *
 * Bug this pins down: PR #115 added the state-licensure guard, which
 * SKIPS protocol items pinned to a pharmacy unlicensed in the patient's
 * state. The licensed items were added to the session — and then the
 * function set a red error and returned early, so the provider was left
 * on the quick-actions panel with prescriptions in the session, no
 * forward navigation, and a "Load N Medications" button that silently
 * re-added the same lines on a second click.
 *
 * Behaviors locked in here:
 *   1. Partial load (>= 1 line loaded) navigates to the review step and
 *      carries the skip report through the session, where it renders as
 *      a NON-blocking amber notice naming each skipped medication.
 *   2. Total block (0 lines loadable) stays on the page with the red
 *      error and the per-item reasons — there is nothing to review.
 *   3. Loading the same protocol twice does not duplicate lines.
 *   4. A fully-licensed load is unchanged: it advances, adds no notice,
 *      and keeps the GAP-3 protocolId tag on every line.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  PrescriptionSessionProvider,
  usePrescriptionSession,
} from '../../_context/prescription-session'
import { ProtocolLoadNotices } from '../../review/_components/protocol-load-notices'
import { QuickActionsPanel } from '../quick-actions-panel'

const pushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: jest.fn(), refresh: jest.fn() }),
}))

const STORAGE_KEY = 'compoundiq-rx-session'

const PATIENT_CA = {
  patient_id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Jordan',
  last_name: 'Rivera',
  date_of_birth: '1980-01-01',
  phone: '+15125550000',
  state: 'CA',
  sms_opt_in: true,
}

const PROVIDER = {
  provider_id: '22222222-2222-4222-8222-222222222222',
  first_name: 'Sarah',
  last_name: 'Chen',
  npi_number: '1234567890',
  signature_hash: null,
}

const PROTOCOL_ID = '33333333-3333-4333-8333-333333333333'

const PROTOCOL_SUMMARY = {
  protocol_id: PROTOCOL_ID,
  name: 'Menopause Foundation — BHRT',
  description: 'BHRT foundation protocol',
  therapeutic_category: "Women's Health",
  total_duration_weeks: 12,
  use_count: 3,
}

function item(overrides: Record<string, unknown>) {
  return {
    item_id: 'item-default',
    formulation_id: 'formulation-default',
    pharmacy_id: 'pharmacy-default',
    phase_name: null,
    dose_amount: '1',
    dose_unit: 'mL',
    frequency_code: 'QD',
    sig_text: 'Apply 1 mL topically once daily in the morning.',
    default_quantity: '30',
    default_refills: 0,
    sort_order: 1,
    wholesale_price: 40,
    formulation_active: true,
    pharmacy_licensed: true,
    formulations: {
      formulation_id: 'formulation-default',
      name: 'Formulation',
      concentration: null,
      dosage_forms: { name: 'Cream' },
    },
    pharmacies: {
      pharmacy_id: 'pharmacy-default',
      name: 'Strive Pharmacy',
      slug: 'strive',
      integration_tier: 'TIER_4_FAX',
    },
    ...overrides,
  }
}

const LICENSED_ITEM = item({
  item_id: 'item-biest',
  formulation_id: 'formulation-biest',
  pharmacy_id: 'pharmacy-strive',
  wholesale_price: 40,
  pharmacy_licensed: true,
  sig_text: 'Apply 1 mL topically once daily in the morning.',
  formulations: {
    formulation_id: 'formulation-biest',
    name: 'Biest 80/20 Topical Cream 2.5mg/g',
    concentration: '2.5mg/g',
    dosage_forms: { name: 'Topical Cream' },
  },
  pharmacies: {
    pharmacy_id: 'pharmacy-strive',
    name: 'Strive Pharmacy',
    slug: 'strive',
    integration_tier: 'TIER_4_FAX',
  },
})

const UNLICENSED_ITEM = item({
  item_id: 'item-progesterone',
  formulation_id: 'formulation-progesterone',
  pharmacy_id: 'pharmacy-portal-plus',
  wholesale_price: 22,
  pharmacy_licensed: false,
  sig_text: 'Take 1 capsule by mouth at bedtime.',
  formulations: {
    formulation_id: 'formulation-progesterone',
    name: 'Progesterone Capsule 100mg',
    concentration: '100mg',
    dosage_forms: { name: 'Capsule' },
  },
  pharmacies: {
    pharmacy_id: 'pharmacy-portal-plus',
    name: 'Portal Plus Pharmacy',
    slug: 'portal-plus',
    integration_tier: 'TIER_2_PORTAL',
  },
})

const SECOND_LICENSED_ITEM = item({
  item_id: 'item-dhea',
  formulation_id: 'formulation-dhea',
  pharmacy_id: 'pharmacy-strive',
  wholesale_price: 18,
  pharmacy_licensed: true,
  sig_text: 'Take 1 capsule by mouth once daily in the morning.',
  formulations: {
    formulation_id: 'formulation-dhea',
    name: 'DHEA Capsule 10mg',
    concentration: '10mg',
    dosage_forms: { name: 'Capsule' },
  },
  pharmacies: {
    pharmacy_id: 'pharmacy-strive',
    name: 'Strive Pharmacy',
    slug: 'strive',
    integration_tier: 'TIER_4_FAX',
  },
})

let protocolItems: unknown[] = []

function jsonResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })
}

const fetchMock = jest.fn((input: unknown) => {
  const url = String(input)
  if (url.startsWith('/api/favorites')) return jsonResponse({ data: [] })
  if (url.startsWith('/api/protocols?id=')) {
    return jsonResponse({
      data: { ...PROTOCOL_SUMMARY, items: protocolItems, default_markup_pct: 40 },
    })
  }
  if (url.startsWith('/api/protocols')) return jsonResponse({ data: [PROTOCOL_SUMMARY] })
  throw new Error(`Unexpected fetch: ${url}`)
})

// Probe: renders the session's observable state so assertions don't have
// to reach into React internals.
function SessionProbe() {
  const session = usePrescriptionSession()
  return (
    <div>
      <span data-testid="rx-count">{session.prescriptions.length}</span>
      <span data-testid="notice-count">{session.notices.length}</span>
      <span data-testid="rx-names">
        {session.prescriptions.map(rx => rx.medicationName).join(' | ')}
      </span>
      <span data-testid="rx-protocol-ids">
        {session.prescriptions.map(rx => rx.protocolId ?? 'none').join(',')}
      </span>
    </div>
  )
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PrescriptionSessionProvider>
        <SessionProbe />
        <ProtocolLoadNotices />
        <QuickActionsPanel onLoadFavorite={jest.fn()} />
      </PrescriptionSessionProvider>
    </QueryClientProvider>,
  )
}

function seedSession(patientState: string, prescriptions: unknown[] = []) {
  sessionStorage.setItem(
    STORAGE_KEY,
    // Deliberately WITHOUT a `notices` key: this is the exact shape older
    // builds persisted, and it must still restore.
    JSON.stringify({
      patient: { ...PATIENT_CA, state: patientState },
      provider: PROVIDER,
      prescriptions,
    }),
  )
}

/** Open the Protocols tab, expand the protocol, return the load button. */
async function openProtocol(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /Protocols \(1\)/ }))
  fireEvent.click(screen.getByRole('button', { name: /Menopause Foundation/ }))
  return screen.findByRole('button', { name: /Load \d+ Medications into Session/ })
}

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

beforeEach(() => {
  jest.clearAllMocks()
  sessionStorage.clear()
  protocolItems = []
})

describe('protocol quick-load — partial success advances', () => {
  it('loads the licensed line, navigates to review, and carries the skip notice', async () => {
    protocolItems = [LICENSED_ITEM, UNLICENSED_ITEM]
    seedSession('CA')
    renderPanel()

    fireEvent.click(await openProtocol())

    // Advanced — this is the whole point of the fix.
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/new-prescription/review'))

    // Only the licensed line entered the session; the guard still holds.
    expect(screen.getByTestId('rx-count')).toHaveTextContent('1')
    expect(screen.getByTestId('rx-names')).toHaveTextContent('Biest 80/20 Topical Cream 2.5mg/g')
    expect(screen.getByTestId('rx-names')).not.toHaveTextContent('Progesterone')

    // The skip report survived on the session and renders on the review step.
    expect(screen.getByTestId('notice-count')).toHaveTextContent('1')
    expect(
      screen.getByText(/Loaded 1 of 2 medications from Menopause Foundation/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Progesterone Capsule 100mg — Portal Plus Pharmacy is not licensed in CA',
      ),
    ).toBeInTheDocument()
  })

  it('renders the skip report as a non-blocking status, not a red error', async () => {
    protocolItems = [LICENSED_ITEM, UNLICENSED_ITEM]
    seedSession('CA')
    renderPanel()

    fireEvent.click(await openProtocol())
    await waitFor(() => expect(pushMock).toHaveBeenCalled())

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(/Loaded 1 of 2 medications/)
    expect(notice.className).toContain('amber')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('protocol quick-load — total block stays on the page', () => {
  it('does not navigate and shows the red error with per-item reasons', async () => {
    protocolItems = [
      UNLICENSED_ITEM,
      item({
        item_id: 'item-estradiol',
        formulation_id: 'formulation-estradiol',
        pharmacy_id: 'pharmacy-portal-plus',
        pharmacy_licensed: false,
        formulations: {
          formulation_id: 'formulation-estradiol',
          name: 'Estradiol Cream 0.1%',
          concentration: '0.1%',
          dosage_forms: { name: 'Topical Cream' },
        },
        pharmacies: {
          pharmacy_id: 'pharmacy-portal-plus',
          name: 'Portal Plus Pharmacy',
          slug: 'portal-plus',
          integration_tier: 'TIER_2_PORTAL',
        },
      }),
    ]
    seedSession('CA')
    renderPanel()

    fireEvent.click(await openProtocol())

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent(/No medications loaded for this CA patient/)
    expect(error).toHaveTextContent(/Progesterone Capsule 100mg/)
    expect(error).toHaveTextContent(/Estradiol Cream 0.1%/)
    expect(error.className).toContain('red')

    expect(pushMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('rx-count')).toHaveTextContent('0')
    expect(screen.getByTestId('notice-count')).toHaveTextContent('0')
  })
})

describe('protocol quick-load — idempotency', () => {
  it('a fully-licensed load advances with no notice and keeps the protocolId tag', async () => {
    protocolItems = [LICENSED_ITEM, SECOND_LICENSED_ITEM]
    seedSession('TX')
    renderPanel()

    fireEvent.click(await openProtocol())

    await waitFor(() => expect(screen.getByTestId('rx-count')).toHaveTextContent('2'))
    expect(pushMock).toHaveBeenCalledWith('/new-prescription/review')
    expect(pushMock).toHaveBeenCalledTimes(1)
    // No skips, nothing pre-existing — no notice to carry.
    expect(screen.getByTestId('notice-count')).toHaveTextContent('0')
    // GAP-3 (#120) linkage preserved on every loaded line.
    expect(screen.getByTestId('rx-protocol-ids')).toHaveTextContent(
      `${PROTOCOL_ID},${PROTOCOL_ID}`,
    )
  })

  it('loading the same protocol twice does not duplicate the lines', async () => {
    protocolItems = [LICENSED_ITEM, SECOND_LICENSED_ITEM]
    seedSession('TX')
    renderPanel()

    const loadButton = await openProtocol()
    fireEvent.click(loadButton)
    await waitFor(() => expect(screen.getByTestId('rx-count')).toHaveTextContent('2'))

    fireEvent.click(loadButton)

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/already in this session/),
    )
    // Still two lines, and no second navigation for a no-op load.
    expect(screen.getByTestId('rx-count')).toHaveTextContent('2')
    expect(pushMock).toHaveBeenCalledTimes(1)
  })
})

describe('session backward compatibility', () => {
  it('restores a sessionStorage payload written before `notices` existed', async () => {
    protocolItems = [LICENSED_ITEM]
    seedSession('TX', [
      {
        id: 'legacy-line',
        pharmacyId: 'pharmacy-strive',
        pharmacyName: 'Strive Pharmacy',
        itemId: 'legacy-catalog-item',
        formulationId: null,
        medicationName: 'Legacy Catalog Line',
        form: 'Capsule',
        dose: '5 mg',
        wholesaleCents: 1000,
        deaSchedule: null,
        retailCents: 2000,
        sigText: 'Take one capsule by mouth daily.',
        integrationTier: 'TIER_4_FAX',
      },
    ])
    renderPanel()

    await waitFor(() => expect(screen.getByTestId('rx-count')).toHaveTextContent('1'))
    expect(screen.getByTestId('rx-names')).toHaveTextContent('Legacy Catalog Line')
    // Missing `notices` normalises to an empty list rather than crashing.
    expect(screen.getByTestId('notice-count')).toHaveTextContent('0')
    expect(screen.getByTestId('rx-protocol-ids')).toHaveTextContent('none')
  })
})
