/**
 * @jest-environment node
 *
 * B16: the ops access review (phi_access_log). Filters, the four review
 * flags and the CSV, as pure functions.
 */

import {
  BULK_VIEW_PATIENTS_PER_HOUR,
  REVIEW_DEFAULT_DAYS,
  REVIEW_MAX_DAYS,
  accessReviewCsv,
  flagAccessRows,
  isOutsideReviewHours,
  parseAccessReviewFilters,
  REVIEW_ACTIONS,
  type AccessReviewRow,
} from '../access-review'
import { PHI_ACTIONS } from '../phi-access'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-10-25T15:00:00.000Z')

function row(over: Partial<AccessReviewRow> = {}): AccessReviewRow {
  return {
    id: 'r1', occurred_at: '2026-10-20T15:00:00.000Z', actor_user_id: ACTOR, actor_role: 'provider',
    clinic_id: CLINIC, patient_id: 'p-1', order_id: null, action: 'view', resource: 'patient',
    route: '/api/patients/[id]', ...over,
  }
}

describe('parseAccessReviewFilters', () => {
  it('defaults to the last 7 days, through today', () => {
    const f = parseAccessReviewFilters(new URLSearchParams(), NOW)
    expect(REVIEW_DEFAULT_DAYS).toBe(7)
    expect(f.errors).toEqual([])
    expect(f.to).toBe('2026-10-25')
    expect(f.from).toBe('2026-10-19')
    expect(f.fromIso).toBe('2026-10-19T00:00:00.000Z')
    expect(f.toIsoExclusive).toBe('2026-10-26T00:00:00.000Z')
  })

  it('reads every filter', () => {
    const f = parseAccessReviewFilters(new URLSearchParams({
      from: '2026-10-01', to: '2026-10-07', clinicId: CLINIC, actorUserId: ACTOR.toUpperCase(),
      actorRole: 'medical_assistant', resource: 'order', action: 'export',
    }), NOW)
    expect(f).toEqual(expect.objectContaining({
      errors: [], from: '2026-10-01', to: '2026-10-07', clinicId: CLINIC, actorUserId: ACTOR,
      actorRole: 'medical_assistant', resource: 'order', action: 'export',
    }))
  })

  it('refuses a malformed filter instead of ignoring it', () => {
    const f = parseAccessReviewFilters(new URLSearchParams({
      from: '2026-13-01', clinicId: 'not-a-uuid', actorUserId: 'x', actorRole: 'Robert; drop', resource: 'a b', action: 'delete',
    }), NOW)
    expect(f.errors.sort()).toEqual(['action', 'actorRole', 'actorUserId', 'clinicId', 'from', 'resource'])
  })

  it('refuses from after to, and a range over the maximum', () => {
    expect(parseAccessReviewFilters(new URLSearchParams({ from: '2026-10-08', to: '2026-10-01' }), NOW).errors).toEqual(['from'])
    expect(REVIEW_MAX_DAYS).toBe(92)
    expect(parseAccessReviewFilters(new URLSearchParams({ from: '2026-01-01', to: '2026-10-01' }), NOW).errors).toEqual(['to'])
    expect(parseAccessReviewFilters(new URLSearchParams({ from: '2026-07-02', to: '2026-10-01' }), NOW).errors).toEqual([])
  })
})

describe('isOutsideReviewHours (06:00 to 22:00 UTC: clinics have no time zone)', () => {
  it.each([
    ['2026-10-20T05:59:59.000Z', true],
    ['2026-10-20T06:00:00.000Z', false],
    ['2026-10-20T21:59:59.000Z', false],
    ['2026-10-20T22:00:00.000Z', true],
    ['2026-10-20T02:00:00.000Z', true],
  ])('%s -> %s', (iso, outside) => {
    expect(isOutsideReviewHours(iso)).toBe(outside)
  })
})

describe('flagAccessRows', () => {
  const ctx = { deactivatedActorIds: new Set<string>(), relatedPatients: new Set([`${CLINIC}:p-1`]) }

  it('a normal row has no flags', () => {
    expect(flagAccessRows([row()], ctx)[0]!.flags).toEqual([])
  })

  it('flags access outside 06:00 to 22:00', () => {
    expect(flagAccessRows([row({ occurred_at: '2026-10-20T23:30:00.000Z' })], ctx)[0]!.flags).toEqual(['outside_hours'])
  })

  it('flags access by a deactivated user', () => {
    const out = flagAccessRows([row()], { ...ctx, deactivatedActorIds: new Set([ACTOR]) })
    expect(out[0]!.flags).toEqual(['deactivated_actor'])
  })

  it('flags a patient with no order or proposal in that clinic', () => {
    const out = flagAccessRows([row({ patient_id: 'p-2' }), row({ patient_id: null, resource: 'patient_list' })], ctx)
    expect(out[0]!.flags).toEqual(['no_relationship'])
    expect(out[1]!.flags).toEqual([])
  })

  function views(count: number, spacingSeconds: number, actor = ACTOR): AccessReviewRow[] {
    const start = Date.parse('2026-10-20T12:00:00.000Z')
    return Array.from({ length: count }, (_, i) => row({
      id: `v${i}`, actor_user_id: actor, patient_id: `p-${i}`,
      occurred_at: new Date(start + i * spacingSeconds * 1000).toISOString(),
    }))
  }
  const related = (rows: AccessReviewRow[]) => ({ ...ctx, relatedPatients: new Set(rows.map(r => `${CLINIC}:${r.patient_id}`)) })

  it(`flags an actor viewing more than ${BULK_VIEW_PATIENTS_PER_HOUR} distinct patients within an hour`, () => {
    expect(BULK_VIEW_PATIENTS_PER_HOUR).toBe(30)
    const atLimit = views(30, 60)
    expect(flagAccessRows(atLimit, related(atLimit)).every(r => r.flags.length === 0)).toBe(true)
    const over = views(31, 60)
    const flagged = flagAccessRows(over, related(over))
    expect(flagged.every(r => r.flags.includes('bulk_patients'))).toBe(true)
  })

  it('does not flag the same count spread over more than an hour, or one patient viewed many times', () => {
    const spread = views(31, 125)
    expect(flagAccessRows(spread, related(spread)).some(r => r.flags.includes('bulk_patients'))).toBe(false)
    const same = views(40, 10).map(r => ({ ...r, patient_id: 'p-1' }))
    expect(flagAccessRows(same, ctx).some(r => r.flags.includes('bulk_patients'))).toBe(false)
  })

  it('counts each actor separately, and only views', () => {
    const a = views(20, 30, ACTOR)
    const b = views(20, 30, 'other-actor').map(r => ({ ...r, patient_id: `q-${r.id}` }))
    const both = [...a, ...b]
    expect(flagAccessRows(both, related(both)).some(r => r.flags.includes('bulk_patients'))).toBe(false)
    const exports = views(31, 60).map(r => ({ ...r, action: 'export' }))
    expect(flagAccessRows(exports, related(exports)).some(r => r.flags.includes('bulk_patients'))).toBe(false)
  })
})

describe('accessReviewCsv', () => {
  it('has a header, one line per row, the flags, and neutralises formulas', () => {
    const [flagged] = flagAccessRows([row({ occurred_at: '2026-10-20T23:00:00.000Z', route: '=HYPERLINK("x")' })], {
      deactivatedActorIds: new Set(), relatedPatients: new Set([`${CLINIC}:p-1`]),
    })
    const lines = accessReviewCsv([flagged!]).trimEnd().split('\n')
    expect(lines[0]).toBe('occurred_at,actor_user_id,actor_role,clinic_id,patient_id,order_id,action,resource,route,flags')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('2026-10-20T23:00:00.000Z')
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`)
    expect(lines[1]!.endsWith(',outside_hours')).toBe(true)
  })
})

it('the review action list is phi_access_log\'s (PHI_ACTIONS)', () => {
  expect([...REVIEW_ACTIONS]).toEqual([...PHI_ACTIONS])
})
