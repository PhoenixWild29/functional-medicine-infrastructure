/**
 * @jest-environment node
 *
 * Compliance C4: the NPI.
 *
 *   - Checksum: Luhn over the 9 leading digits prefixed with 80840 (the
 *     ISO 7812 issuer prefix for US health identifiers), as CMS specifies.
 *   - NPPES lookup: the public registry
 *     (https://npiregistry.cms.hhs.gov/api/?version=2.1&number=<npi>).
 *     The NPI must be an individual (NPI-1) whose name matches the
 *     provider's. The result is stored; an unreachable registry yields
 *     "unverified", never a thrown error and never a blocked save.
 *
 * fetch is mocked: nothing reaches NPPES.
 */

import { npiChecksumValid, lookupNpi, nameMatches, NPPES_URL } from '../npi'

describe('npiChecksumValid', () => {
  it.each(['1234567893', '1245319599', '1003000126'])('%s is valid', npi => {
    expect(npiChecksumValid(npi)).toBe(true)
  })
  it.each(['1234567890', '1245319598', '123456789', '12345678931', 'abcdefghij', '', '0000000000'])('%s is not', npi => {
    expect(npiChecksumValid(npi)).toBe(false)
  })
})

describe('nameMatches', () => {
  it('first and last name, ignoring case, spacing, punctuation and accents', () => {
    expect(nameMatches({ firstName: 'Sarah', lastName: 'Chen' }, { firstName: 'SARAH', lastName: 'CHEN' })).toBe(true)
    expect(nameMatches({ firstName: 'José', lastName: "O'Neil-Smith" }, { firstName: 'JOSE', lastName: 'ONEIL SMITH' })).toBe(true)
  })
  it('a first name the registry abbreviates or extends still matches on its start; the last name must match', () => {
    expect(nameMatches({ firstName: 'Sam', lastName: 'Patel' }, { firstName: 'SAMUEL', lastName: 'PATEL' })).toBe(true)
    expect(nameMatches({ firstName: 'Sarah', lastName: 'Chen' }, { firstName: 'SARAH', lastName: 'CHENG' })).toBe(false)
    expect(nameMatches({ firstName: 'Maria', lastName: 'Chen' }, { firstName: 'SARAH', lastName: 'CHEN' })).toBe(false)
  })
})

const fetchMock = jest.fn()
beforeEach(() => {
  fetchMock.mockReset()
  ;(global as { fetch: unknown }).fetch = fetchMock
})

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const INDIVIDUAL = {
  result_count: 1,
  results: [{
    number: '1234567893',
    enumeration_type: 'NPI-1',
    basic: { first_name: 'SARAH', last_name: 'CHEN', status: 'A' },
    taxonomies: [
      { code: '207Q00000X', desc: 'Family Medicine', primary: false },
      { code: '207R00000X', desc: 'Internal Medicine', primary: true, state: 'TX', license: 'X1' },
    ],
  }],
}

describe('lookupNpi', () => {
  const provider = { firstName: 'Sarah', lastName: 'Chen' }

  it('asks the public registry for that number', async () => {
    fetchMock.mockResolvedValue(ok(INDIVIDUAL))
    await lookupNpi('1234567893', provider)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${NPPES_URL}?version=2.1&number=1234567893`)
  })

  it('an individual whose name matches is verified, with the primary taxonomy', async () => {
    fetchMock.mockResolvedValue(ok(INDIVIDUAL))
    expect(await lookupNpi('1234567893', provider)).toEqual({
      status: 'verified', nameMatch: true, enumerationType: 'NPI-1',
      taxonomyCode: '207R00000X', taxonomyDesc: 'Internal Medicine',
      registryFirstName: 'SARAH', registryLastName: 'CHEN', reason: null,
    })
  })

  it('a name that does not match is a mismatch, not verified', async () => {
    fetchMock.mockResolvedValue(ok(INDIVIDUAL))
    const r = await lookupNpi('1234567893', { firstName: 'Raj', lastName: 'Patel' })
    expect(r).toEqual(expect.objectContaining({ status: 'mismatch', nameMatch: false, reason: 'The registry name for this NPI is not this provider\'s.' }))
  })

  it('an organization (NPI-2) cannot prescribe', async () => {
    fetchMock.mockResolvedValue(ok({ result_count: 1, results: [{ ...INDIVIDUAL.results[0], enumeration_type: 'NPI-2', basic: { organization_name: 'SUNRISE CLINIC' } }] }))
    const r = await lookupNpi('1234567893', provider)
    expect(r).toEqual(expect.objectContaining({ status: 'mismatch', enumerationType: 'NPI-2', reason: 'This NPI belongs to an organization, not an individual prescriber.' }))
  })

  it('a deactivated NPI is not verified', async () => {
    fetchMock.mockResolvedValue(ok({ result_count: 1, results: [{ ...INDIVIDUAL.results[0], basic: { first_name: 'SARAH', last_name: 'CHEN', status: 'D' } }] }))
    expect(await lookupNpi('1234567893', provider)).toEqual(expect.objectContaining({ status: 'mismatch', reason: 'The registry lists this NPI as deactivated.' }))
  })

  it('no record is not_found', async () => {
    fetchMock.mockResolvedValue(ok({ result_count: 0, results: [] }))
    expect(await lookupNpi('1234567893', provider)).toEqual(expect.objectContaining({ status: 'not_found', nameMatch: null }))
  })

  it.each([
    ['a network error', () => fetchMock.mockRejectedValue(new TypeError('fetch failed'))],
    ['a 503', () => fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })],
    ['a body that is not the registry\'s', () => fetchMock.mockResolvedValue(ok({ Errors: [{ description: 'bad' }] }))],
  ])('%s is unverified, never a throw', async (_n, arrange) => {
    arrange()
    await expect(lookupNpi('1234567893', provider)).resolves.toEqual(expect.objectContaining({ status: 'unverified', nameMatch: null }))
  })

  it('a timeout is unverified', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    await expect(lookupNpi('1234567893', provider, { timeoutMs: 10 })).resolves.toEqual(expect.objectContaining({ status: 'unverified' }))
  })

  it('a number that fails the checksum is invalid, and the registry is not asked', async () => {
    expect(await lookupNpi('1234567890', provider)).toEqual(expect.objectContaining({ status: 'invalid' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
