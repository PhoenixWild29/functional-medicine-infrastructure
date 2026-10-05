/**
 * @jest-environment node
 *
 * Kill switch: PHARMACY_SUBMISSIONS_ENABLED. Production must send nothing
 * to a pharmacy until the owner turns it on, and it is OFF when unset.
 *
 * Belt and braces: every adapter that reaches a pharmacy (Tier 1 API,
 * Tier 2 portal, Tier 4 fax and Documo's sendFax itself) refuses to run
 * while the flag is off, with a typed error, before touching the
 * database, storage or the network. The routing engine does not even
 * claim the order, so a paid order stays in PAID_PROCESSING.
 *
 * Errors are matched by name/code rather than class so this file does not
 * depend on where the error class lives.
 */

const fetchMock = jest.fn()
const dbTables: string[] = []
const casMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      dbTables.push(table)
      throw new Error(`database touched: ${table}`)
    },
    storage: { from: () => { dbTables.push('storage'); throw new Error('storage touched') } },
  }),
}))
jest.mock('@/lib/orders/cas-transition', () => ({ casTransition: (a: unknown) => casMock(a) }))
jest.mock('@/lib/slack/client', () => ({
  sendSlackAlert: jest.fn().mockResolvedValue(undefined),
  buildAdapterFailureAlert: (a: unknown) => a,
  buildSubmissionFailedAlert: (a: unknown) => a,
}))

import { sendFax } from '@/lib/documo/client'
import { submitTier1Api } from '../tier1-api'
import { submitTier2Portal } from '../tier2-portal'
import { submitTier4Fax } from '../tier4-fax'
import { routeOrder } from '../routing-engine'

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const infoSpy  = jest.spyOn(console, 'info').mockImplementation(() => {})
const warnSpy  = jest.spyOn(console, 'warn').mockImplementation(() => {})

const ORIGINAL = process.env['PHARMACY_SUBMISSIONS_ENABLED']

beforeAll(() => { (global as { fetch: unknown }).fetch = fetchMock })

beforeEach(() => {
  delete process.env['PHARMACY_SUBMISSIONS_ENABLED']
  process.env['DOCUMO_API_KEY'] = 'k'
  process.env['DOCUMO_ACCOUNT_ID'] = 'acct'
  process.env['DOCUMO_OUTBOUND_FAX_NUMBER'] = '+15550000000'
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ id: 'fax-1' }), text: async () => '' })
  casMock.mockReset().mockResolvedValue({ success: true, wasAlreadyTransitioned: false })
  dbTables.length = 0
  errorSpy.mockClear(); infoSpy.mockClear(); warnSpy.mockClear()
})

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env['PHARMACY_SUBMISSIONS_ENABLED']
  else process.env['PHARMACY_SUBMISSIONS_ENABLED'] = ORIGINAL
  errorSpy.mockRestore(); infoSpy.mockRestore(); warnSpy.mockRestore()
})

const FAX = { recipientFaxNumber: '+15551112222', recipientName: 'Pharm', documentUrl: 'https://signed/x.pdf' }

async function expectDisabled(p: Promise<unknown>) {
  const err = await p.then(() => null, (e: unknown) => e)
  expect(err).not.toBeNull()
  expect((err as { name?: string }).name).toBe('PharmacySubmissionsDisabledError')
  expect((err as { code?: string }).code).toBe('PHARMACY_SUBMISSIONS_DISABLED')
}

describe.each([
  ['unset', undefined],
  ['false', 'false'],
  ['anything but "true"', 'yes'],
])('flag %s: nothing reaches a pharmacy', (_label, value) => {
  beforeEach(() => {
    if (value === undefined) delete process.env['PHARMACY_SUBMISSIONS_ENABLED']
    else process.env['PHARMACY_SUBMISSIONS_ENABLED'] = value
  })

  it('sendFax refuses and makes no request to Documo', async () => {
    await expectDisabled(sendFax(FAX))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the Tier 1 API adapter refuses before reading anything', async () => {
    await expectDisabled(submitTier1Api('o-1', 'pharm-1'))
    expect(dbTables).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the Tier 2 portal adapter refuses before reading anything', async () => {
    await expectDisabled(submitTier2Portal('o-1', 'pharm-1'))
    expect(dbTables).toEqual([])
  })

  it('the Tier 4 fax adapter refuses before reading anything (even with DOCUMO_ENABLED=false)', async () => {
    process.env['DOCUMO_ENABLED'] = 'false'
    try {
      await expectDisabled(submitTier4Fax('o-1'))
    } finally {
      delete process.env['DOCUMO_ENABLED']
    }
    expect(dbTables).toEqual([])
  })

  it('the routing engine does not claim the order: it stays in PAID_PROCESSING', async () => {
    const result = await routeOrder({ orderId: 'o-1', pharmacyId: 'pharm-1', currentStatus: 'PAID_PROCESSING' })

    expect(result.outcome).toBe('submissions_disabled')
    expect(casMock).not.toHaveBeenCalled()
    expect(dbTables).toEqual([])
  })
})

describe('flag on: unchanged', () => {
  beforeEach(() => { process.env['PHARMACY_SUBMISSIONS_ENABLED'] = 'true' })

  it('sendFax sends to Documo', async () => {
    const result = await sendFax(FAX)

    expect(result).toEqual({ faxId: 'fax-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
