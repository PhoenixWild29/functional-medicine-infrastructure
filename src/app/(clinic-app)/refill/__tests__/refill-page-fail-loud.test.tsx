/**
 * /refill must not turn a failed query into an empty clinic.
 *
 * On prod at cac80ff, /refill rendered "No patient has a prescription to
 * refill yet" for a clinic whose dashboard showed ten non-draft orders.
 * The page read `ordersResult.data ?? []` and never looked at
 * `ordersResult.error`, so a PostgREST error became an empty state that
 * a provider cannot tell from a real one — and nothing was logged.
 *
 * Pinned here: an error renders an explicit failure state carrying the
 * error code and message, and is logged; a genuinely empty result still
 * renders the empty state. The real page component runs; only the
 * Supabase clients are faked.
 */

import { render, screen } from '@testing-library/react'
import RefillPage from '../page'
import { phiLog, phiEntries, expectOnePhiRow } from '@/__tests__/helpers/phi-log'
import { PrescriptionSessionProvider } from '../../new-prescription/_context/prescription-session'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@/components/hipaa-timeout', () => ({ HipaaTimeout: () => null }))

const CLINIC = 'a1000000-0000-0000-0000-000000000001'

jest.mock('@/lib/supabase/server', () => ({
  createServerClient: jest.fn().mockImplementation(async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: 'user-1', app_metadata: { clinic_id: CLINIC, app_role: 'clinic_admin' } } },
      }),
    },
  })),
}))

let ordersResult: { data: unknown; error: unknown } = { data: [], error: null }

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: jest.fn().mockImplementation(() => {
    const chain: Record<string, unknown> = {}
    chain['from']   = () => chain
    chain['select'] = () => chain
    chain['eq']     = () => chain
    chain['is']     = () => chain
    chain['neq']    = () => chain
    chain['order']  = () => chain
    chain['limit']  = () => Promise.resolve(ordersResult)
    return chain
  }),
}))

async function renderPage() {
  const element = await RefillPage({ searchParams: Promise.resolve({ order: 'd1000000-0000-4000-8000-000000000001' }) })
  return render(<PrescriptionSessionProvider>{element}</PrescriptionSessionProvider>)
}

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  errorSpy.mockClear()
  ordersResult = { data: [], error: null }
})

describe('/refill when the orders query fails', () => {
  it('says it failed, with the code and message — not "no patient has a prescription"', async () => {
    ordersResult = {
      data: null,
      error: { code: '42703', message: 'column orders.example does not exist', details: null, hint: null },
    }
    await renderPage()

    expect(screen.getByTestId('refill-load-error')).toHaveTextContent('Prescriptions could not be loaded for refill.')
    expect(screen.getByTestId('refill-load-error')).toHaveTextContent('This is an error, not an empty list')
    expect(screen.getByTestId('refill-load-error-detail')).toHaveTextContent('42703: column orders.example does not exist')
    expect(screen.queryByTestId('refill-empty')).not.toBeInTheDocument()
  })

  // C9: `details` is left out. On some errors PostgREST echoes row values
  // there, and row values on this page are patient data.
  it('logs the error code, message and hint, with the clinic, so it reaches the runtime logs', async () => {
    ordersResult = {
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired', details: 'Jane Doe 1980-01-01', hint: 'h' },
    }
    await renderPage()

    expect(errorSpy).toHaveBeenCalledWith(
      '[refill] orders query failed:',
      JSON.stringify({ code: 'PGRST301', message: 'JWT expired', hint: 'h' }),
      '| clinic=', CLINIC,
    )
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('Jane Doe')
  })
})

describe('/refill when the clinic genuinely has nothing to refill', () => {
  it('still renders the empty state, and logs nothing', async () => {
    ordersResult = { data: [], error: null }
    await renderPage()

    expect(screen.getByTestId('refill-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('refill-load-error')).not.toBeInTheDocument()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

// Compliance C2: the refill picker (patients and their orders) is logged once.
describe('PHI access log', () => {
  beforeEach(() => phiLog.mockClear())

  it('a rendered picker logs exactly one row: view, refill', async () => {
    await renderPage()
    expectOnePhiRow({ action: 'view', resource: 'refill', route: '/refill' })
  })

  it('a failed load logs nothing (no patient data was shown)', async () => {
    ordersResult = { data: null, error: { code: '42703', message: 'x', details: null, hint: null } }
    await renderPage()
    expect(phiEntries()).toHaveLength(0)
  })
})
