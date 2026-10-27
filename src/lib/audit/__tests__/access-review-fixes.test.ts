/**
 * @jest-environment node
 *
 * C's review of the access review (docs/qa/review-2026-10-25-high-risk.md 7b):
 *   D1  outside-hours is read in the clinic's time zone (from its state), not UTC.
 *   D2  list views do not count toward bulk_patients.
 *   D3  a truncated CSV says so in its last line.
 */

import {
  LIST_REVIEW_RESOURCES,
  accessReviewCsv,
  flagAccessRows,
  isOutsideReviewHours,
  timeZoneForState,
  type AccessReviewRow,
} from '../access-review'

const CLINIC = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'

function row(over: Partial<AccessReviewRow> = {}): AccessReviewRow {
  return {
    id: 'r1', occurred_at: '2026-10-20T15:00:00.000Z', actor_user_id: ACTOR, actor_role: 'provider',
    clinic_id: CLINIC, patient_id: 'p-1', order_id: null, action: 'view', resource: 'patient',
    route: '/api/patients/[id]', ...over,
  }
}

describe('D1: timeZoneForState', () => {
  it('maps every state and DC, by code, any case', () => {
    expect(timeZoneForState('CA')).toBe('America/Los_Angeles')
    expect(timeZoneForState('ny')).toBe('America/New_York')
    expect(timeZoneForState(' az ')).toBe('America/Phoenix')
    expect(timeZoneForState('HI')).toBe('Pacific/Honolulu')
    expect(timeZoneForState('DC')).toBe('America/New_York')
    const codes = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')
    expect(codes).toHaveLength(51)
    for (const c of codes) expect(timeZoneForState(c)).toMatch(/^(America|Pacific)\//)
  })

  it('a multi-zone state gets the zone most of its people live in', () => {
    expect(timeZoneForState('TX')).toBe('America/Chicago')
    expect(timeZoneForState('FL')).toBe('America/New_York')
    expect(timeZoneForState('TN')).toBe('America/Chicago')
    expect(timeZoneForState('ID')).toBe('America/Boise')
    expect(timeZoneForState('OR')).toBe('America/Los_Angeles')
  })

  it('an unknown or missing state has no zone', () => {
    expect(timeZoneForState('XX')).toBeNull()
    expect(timeZoneForState('California')).toBeNull()
    expect(timeZoneForState(null)).toBeNull()
  })
})

describe('D1: outside hours in the clinic time zone', () => {
  it.each([
    // 3:30pm and 11:30pm in Los Angeles (PDT): C's probe.
    ['2026-10-20T22:30:00.000Z', 'America/Los_Angeles', false],
    ['2026-10-21T06:30:00.000Z', 'America/Los_Angeles', true],
    // 6:30pm in New York (EDT), and 5:30am.
    ['2026-10-20T22:30:00.000Z', 'America/New_York', false],
    ['2026-10-20T09:30:00.000Z', 'America/New_York', true],
    // Winter (EST): 06:00 local is 11:00Z.
    ['2026-12-01T10:59:00.000Z', 'America/New_York', true],
    ['2026-12-01T11:00:00.000Z', 'America/New_York', false],
    ['2026-10-20T22:30:00.000Z', 'UTC', true],
  ])('%s in %s -> %s', (iso, zone, outside) => {
    expect(isOutsideReviewHours(iso, zone)).toBe(outside)
  })

  it('each row is read in its clinic zone, and says which zone (UTC with no zone)', () => {
    const rows = [
      row({ id: 'la', occurred_at: '2026-10-20T22:30:00.000Z' }),
      row({ id: 'none', occurred_at: '2026-10-20T22:30:00.000Z', clinic_id: '99999999-9999-4999-8999-999999999999' }),
    ]
    const out = flagAccessRows(rows, {
      deactivatedActorIds: new Set(),
      relatedPatients: new Set(rows.map(r => `${r.clinic_id}:${r.patient_id}`)),
      clinicTimeZones: new Map([[CLINIC, 'America/Los_Angeles']]),
    })
    expect(out[0]).toEqual(expect.objectContaining({ flags: [], time_zone: 'America/Los_Angeles', local_time: '2026-10-20 15:30' }))
    expect(out[1]).toEqual(expect.objectContaining({ flags: ['outside_hours'], time_zone: 'UTC', local_time: '2026-10-20 22:30' }))
  })
})

describe('D2: list views do not count toward bulk_patients', () => {
  it('the list resources', () => {
    expect([...LIST_REVIEW_RESOURCES].sort()).toEqual(['inbound_fax', 'order_list', 'patient_import_preview', 'patient_list', 'practice_dashboard'])
  })

  function views(count: number, resource: string, prefix = 'p', route?: string): AccessReviewRow[] {
    const start = Date.parse('2026-10-20T15:00:00.000Z')
    return Array.from({ length: count }, (_, i) => row({
      id: `${resource}-${i}`, patient_id: `${prefix}-${i}`, resource,
      occurred_at: new Date(start + i * 1000).toISOString(),
      ...(route ? { route } : resource === 'inbound_fax' ? { route: '/ops/fax' } : {}),
    }))
  }
  const ctxFor = (rows: AccessReviewRow[]) => ({
    deactivatedActorIds: new Set<string>(),
    relatedPatients: new Set(rows.map(r => `${r.clinic_id}:${r.patient_id}`)),
  })

  it.each(['order_list', 'patient_list', 'practice_dashboard', 'patient_import_preview', 'inbound_fax'])('one %s render of 40 patients is not flagged', resource => {
    const rows = views(40, resource)
    expect(flagAccessRows(rows, ctxFor(rows)).some(r => r.flags.includes('bulk_patients'))).toBe(false)
  })

  it.each(['/ops/fax', '/api/ops/fax'])('inbound_fax on the queue route %s is a list view', route => {
    const rows = views(40, 'inbound_fax', 'p', route)
    expect(flagAccessRows(rows, ctxFor(rows)).some(r => r.flags.includes('bulk_patients'))).toBe(false)
  })

  it('opened fax PDFs (inbound_fax on /api/ops/fax/[faxId]/pdf) count toward bulk_patients', () => {
    const rows = views(31, 'inbound_fax', 'p', '/api/ops/fax/[faxId]/pdf')
    expect(flagAccessRows(rows, ctxFor(rows)).every(r => r.flags.includes('bulk_patients'))).toBe(true)
  })

  it('single-record views still count: 31 is flagged, 20 plus a 40-patient list is not', () => {
    const singles = views(31, 'patient')
    expect(flagAccessRows(singles, ctxFor(singles)).every(r => r.flags.includes('bulk_patients'))).toBe(true)
    const mixed = [...views(20, 'order'), ...views(40, 'order_list', 'q')]
    expect(flagAccessRows(mixed, ctxFor(mixed)).some(r => r.flags.includes('bulk_patients'))).toBe(false)
  })
})

describe('D3: a truncated CSV says so', () => {
  const ctx = { deactivatedActorIds: new Set<string>(), relatedPatients: new Set([`${CLINIC}:p-1`]) }

  it('has the zone columns, and a last line when cut off', () => {
    const flagged = flagAccessRows([row()], ctx)
    const full = accessReviewCsv(flagged).trimEnd().split('\n')
    expect(full[0]).toBe('occurred_at,time_zone,local_time,actor_user_id,actor_role,clinic_id,patient_id,order_id,action,resource,route,flags')
    expect(full).toHaveLength(2)
    const cut = accessReviewCsv(flagged, { truncated: true, rowLimit: 5000 }).trimEnd().split('\n')
    expect(cut).toHaveLength(3)
    expect(cut[2]).toBe('# TRUNCATED: only the newest 5000 rows are in this file. Narrow the range or the filters and export again.')
  })
})
