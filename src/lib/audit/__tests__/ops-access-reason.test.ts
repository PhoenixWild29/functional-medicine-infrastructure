/**
 * @jest-environment node
 *
 * B13: the ops access reasons. A clinic admin's access log names the
 * reason ops gave, in words, not as a code.
 */

import { OPS_ACCESS_REASONS, opsAccessReasonResource, parseOpsAccessReason } from '../ops-access-reason'
import { resourceLabel } from '../access-log-view'

it('parses only a listed code', () => {
  expect(parseOpsAccessReason('emergency')).toBe('emergency')
  expect(parseOpsAccessReason(null)).toBeNull()
  expect(parseOpsAccessReason('')).toBeNull()
  expect(parseOpsAccessReason('Emergency')).toBeNull()
  expect(parseOpsAccessReason('toString')).toBeNull()
})

it('each reason has a resource code that fits the column, and a label in the clinic access log', () => {
  for (const r of OPS_ACCESS_REASONS) {
    const resource = opsAccessReasonResource(r.code)
    expect(resource).toMatch(/^[a-z_]{1,40}$/)
    expect(resourceLabel(resource)).toBe(`Reason given by CompoundIQ operations: ${r.label}`)
  }
})
