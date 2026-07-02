/**
 * @jest-environment node
 *
 * PHI debug carve-out tests — markSubmitted side-write to
 * `adapter_submission_debug_payloads` gated by PHI_DEBUG_ENABLED.
 *
 * Coverage:
 *   1. Flag OFF (env unset or != 'true') → NO debug-table insert.
 *   2. Flag ON → debug-table insert fires with raw pre-redaction payload.
 *   3. Flag ON + debug insert fails → primary submission write still
 *      succeeded; warning logged; markSubmitted does not throw.
 *
 * The redaction unit tests live in
 * `src/lib/phi/__tests__/redact-adapter-payload.test.ts`. This file
 * only locks the wiring: that the debug-table writer sees the ORIGINAL
 * (unredacted) payload and that flag/failure semantics behave.
 */

import { markSubmitted } from '../audit-trail'

// ── Mock surface ──────────────────────────────────────────────
// markSubmitted does:
//   1. redact + fingerprint   (pure, no DB)
//   2. SELECT metadata FROM adapter_submissions    (chain ending in .single())
//   3. UPDATE adapter_submissions                   (chain ending in .eq())
//   4. (gated) INSERT adapter_submission_debug_payloads (insert() returns promise)
//
// We route every from('<table>') through a dispatcher so the test can
// inspect what was sent to each.

const adapterSelectSingleMock = jest.fn()
const adapterUpdateEqMock     = jest.fn()
const debugInsertMock         = jest.fn()

jest.mock('@/lib/supabase/service', () => {
  const adapterChain = () => {
    const obj: Record<string, unknown> = {}
    obj['select']      = jest.fn(() => obj)
    obj['update']      = jest.fn(() => obj)
    obj['eq']          = jest.fn(() => {
      // Two terminal shapes for adapter_submissions:
      //   .select(...).eq(...).single()   → returns existing metadata
      //   .update(...).eq(...)            → returns { error }
      // We disambiguate by whether .single() is then called.
      // To avoid coupling tests to call order, we return an object that
      // EITHER awaits (update path) OR exposes .single (select path).
      const thenable: Record<string, unknown> = {}
      thenable['single'] = () => adapterSelectSingleMock()
      // Make the chain awaitable for the UPDATE path
      thenable['then'] = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(adapterUpdateEqMock()).then(resolve)
      return thenable
    })
    return obj
  }

  const debugChain = () => ({
    insert: (row: Record<string, unknown>) => debugInsertMock(row),
  })

  return {
    createServiceClient: jest.fn(() => ({
      from: (table: string) => {
        if (table === 'adapter_submission_debug_payloads') return debugChain()
        return adapterChain()
      },
    })),
  }
})

const SUBMISSION_ID = '11111111-1111-4111-9111-111111111111'

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env['PHI_DEBUG_ENABLED']

  // Default happy-path: existing metadata is empty; UPDATE succeeds.
  adapterSelectSingleMock.mockResolvedValue({ data: { metadata: null }, error: null })
  adapterUpdateEqMock.mockResolvedValue({ error: null })
  debugInsertMock.mockResolvedValue({ error: null })
})

afterAll(() => {
  delete process.env['PHI_DEBUG_ENABLED']
})

describe('markSubmitted — PHI debug carve-out wiring', () => {
  const samplePayload = {
    patient: {
      first_name: 'Jane',
      last_name:  'Doe',
      dob:        '1985-04-12',
    },
    medication: { name: 'Compounded Cream' },
    order_number: 'ORD-1',
  }

  test('flag OFF → no debug-table insert', async () => {
    await markSubmitted(SUBMISSION_ID, samplePayload)

    expect(adapterUpdateEqMock).toHaveBeenCalledTimes(1)
    expect(debugInsertMock).not.toHaveBeenCalled()
  })

  test('flag set to non-true value → no debug-table insert', async () => {
    process.env['PHI_DEBUG_ENABLED'] = '1' // strict string compare
    await markSubmitted(SUBMISSION_ID, samplePayload)

    expect(debugInsertMock).not.toHaveBeenCalled()
  })

  test('flag ON → debug-table insert fires with PRE-redaction raw payload', async () => {
    process.env['PHI_DEBUG_ENABLED'] = 'true'

    await markSubmitted(SUBMISSION_ID, samplePayload)

    expect(debugInsertMock).toHaveBeenCalledTimes(1)
    const row = debugInsertMock.mock.calls[0]?.[0] as {
      adapter_submission_id: string
      raw_payload: typeof samplePayload
    }
    expect(row.adapter_submission_id).toBe(SUBMISSION_ID)
    // CRITICAL: the debug table must receive the ORIGINAL payload,
    // not the redacted one. If this ever regresses, ops loses the
    // entire reason the carve-out exists.
    expect(row.raw_payload).toEqual(samplePayload)
    expect(row.raw_payload.patient.first_name).toBe('Jane')
    expect(row.raw_payload.medication.name).toBe('Compounded Cream')
  })

  test('flag ON + debug insert fails → primary write still succeeded, warning logged, no throw', async () => {
    process.env['PHI_DEBUG_ENABLED'] = 'true'
    debugInsertMock.mockResolvedValueOnce({ error: { message: 'connection refused' } })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(markSubmitted(SUBMISSION_ID, samplePayload)).resolves.toBeUndefined()

    // Primary submission write still happened
    expect(adapterUpdateEqMock).toHaveBeenCalledTimes(1)
    // Debug insert was attempted
    expect(debugInsertMock).toHaveBeenCalledTimes(1)
    // Warning logged with the underlying error message
    expect(warnSpy).toHaveBeenCalled()
    const warnArgs = warnSpy.mock.calls.flat().join(' ')
    expect(warnArgs).toMatch(/PHI debug insert failed/)
    expect(warnArgs).toMatch(/connection refused/)

    warnSpy.mockRestore()
  })

  test('flag ON + debug insert THROWS → primary write still succeeded, warning logged, no throw', async () => {
    process.env['PHI_DEBUG_ENABLED'] = 'true'
    debugInsertMock.mockImplementationOnce(() => {
      throw new Error('client disconnected')
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(markSubmitted(SUBMISSION_ID, samplePayload)).resolves.toBeUndefined()

    expect(adapterUpdateEqMock).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalled()
    const warnArgs = warnSpy.mock.calls.flat().join(' ')
    expect(warnArgs).toMatch(/PHI debug insert threw/)

    warnSpy.mockRestore()
  })

  test('flag ON + primary submission UPDATE fails → no debug insert (no FK target)', async () => {
    process.env['PHI_DEBUG_ENABLED'] = 'true'
    adapterUpdateEqMock.mockResolvedValueOnce({ error: { message: 'primary write failed' } })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await markSubmitted(SUBMISSION_ID, samplePayload)

    // Primary write was attempted and failed
    expect(adapterUpdateEqMock).toHaveBeenCalledTimes(1)
    // Debug insert MUST NOT fire — there's no parent row to reference
    expect(debugInsertMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  test('flag ON + requestPayload undefined → no debug insert (nothing to record)', async () => {
    process.env['PHI_DEBUG_ENABLED'] = 'true'

    await markSubmitted(SUBMISSION_ID, undefined)

    expect(adapterUpdateEqMock).toHaveBeenCalledTimes(1)
    expect(debugInsertMock).not.toHaveBeenCalled()
  })
})
