// ============================================================
// Compliance C2: asserting a route's PHI access log row
// ============================================================
//
// jest.setup.ts replaces logPhiAccess with a jest.fn for every test file.
// A route test resets it, runs one request, and checks that exactly one
// row was logged, and what it says.

import { logPhiAccess, type PhiAccessEntry } from '@/lib/audit/phi-access'

export const phiLog = jest.mocked(logPhiAccess)

/** The entries logged since the last reset. */
export function phiEntries(): PhiAccessEntry[] {
  return phiLog.mock.calls.map(c => c[0])
}

/** Exactly one row for this request, matching `expected`. */
export function expectOnePhiRow(expected: Partial<Record<keyof PhiAccessEntry, unknown>>) {
  const entries = phiEntries()
  expect(entries).toHaveLength(1)
  expect(entries[0]).toEqual(expect.objectContaining(expected))
  expect(entries[0]!.user).toBeTruthy()
}
