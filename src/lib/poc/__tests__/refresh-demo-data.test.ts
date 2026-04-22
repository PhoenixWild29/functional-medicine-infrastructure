/**
 * @jest-environment node
 *
 * Unit tests for refresh-demo-data — the module that seeds the
 * time-sensitive parts of the POC demo (fax triage + adapter
 * submissions). Added in PR #5 (cowork review finding B2).
 *
 * These tests cover:
 *   - buildSubmissionBatch() row shape + ratios + timing
 *   - refreshDemoData() POC_MODE gate (short-circuits to a
 *     "skipped" report without touching the DB)
 *   - Integration with computeAdapterStatus: green/yellow
 *     pharmacies in the seeded batch classify as expected
 */

import {
  buildSubmissionBatch,
  refreshDemoData,
  DEMO_PHARMACIES,
  DEMO_ORDER_ID,
  SEED_ROW_CAP,
  type SubmissionInsert,
} from '../refresh-demo-data'
import { computeAdapterStatus } from '../../ops/adapter-health'

// ── POC_MODE setup helpers ──────────────────────────────────
// refreshDemoData reads process.env['POC_MODE']. Save + restore
// around tests that toggle it.
const ORIGINAL_POC_MODE = process.env['POC_MODE']

afterEach(() => {
  if (ORIGINAL_POC_MODE === undefined) {
    delete process.env['POC_MODE']
  } else {
    process.env['POC_MODE'] = ORIGINAL_POC_MODE
  }
})

describe('buildSubmissionBatch', () => {
  const NOW = new Date('2026-04-22T15:00:00.000Z')

  it('produces 40 rows per pharmacy × 5 pharmacies = 200 total', () => {
    const rows = buildSubmissionBatch(NOW)
    expect(rows).toHaveLength(DEMO_PHARMACIES.length * 40)
    expect(DEMO_PHARMACIES.length).toBe(5)
  })

  it('green pharmacies have 40 successes + 0 failures', () => {
    const rows = buildSubmissionBatch(NOW)
    for (const pharmacy of DEMO_PHARMACIES.filter(p => p.target === 'green')) {
      const forPharmacy = rows.filter(r => r.pharmacy_id === pharmacy.id)
      const successes = forPharmacy.filter(r => r.status === 'CONFIRMED')
      const failures  = forPharmacy.filter(r => r.status === 'FAILED')
      expect(successes).toHaveLength(40)
      expect(failures).toHaveLength(0)
    }
  })

  it('yellow pharmacy has 34 successes + 6 failures (85% success rate)', () => {
    const rows = buildSubmissionBatch(NOW)
    const yellowPharmacies = DEMO_PHARMACIES.filter(p => p.target === 'yellow')
    expect(yellowPharmacies).toHaveLength(1)

    const yellow = yellowPharmacies[0]!
    const forYellow = rows.filter(r => r.pharmacy_id === yellow.id)
    const successes = forYellow.filter(r => r.status === 'CONFIRMED')
    const failures  = forYellow.filter(r => r.status === 'FAILED')
    expect(successes).toHaveLength(34)
    expect(failures).toHaveLength(6)
    // 34/40 = 0.85 — inside the 80-95% yellow band
    expect(successes.length / forYellow.length).toBeCloseTo(0.85, 2)
  })

  it('freshness anchor is a SUCCESS (not a failure) for every pharmacy', () => {
    // Critical: if idx=0 is a failure for the yellow pharmacy,
    // lastSuccess.at(-1) in the Adapter Health calc falls back to
    // a 4h+ old row → the card flips to red.
    const rows = buildSubmissionBatch(NOW)
    for (const pharmacy of DEMO_PHARMACIES) {
      const forPharmacy = rows.filter(r => r.pharmacy_id === pharmacy.id)
      // Batch layout: idx=0 is the first row for each pharmacy in
      // insertion order. The submission_id encodes the idx.
      const idx0 = forPharmacy.find(r => r.submission_id.includes(`-${pharmacy.slug}-000-`))
      expect(idx0).toBeDefined()
      expect(idx0!.status).toBe('CONFIRMED')
    }
  })

  it('green pharmacy freshness anchor is within 15 minutes of now', () => {
    const rows = buildSubmissionBatch(NOW)
    for (const pharmacy of DEMO_PHARMACIES.filter(p => p.target === 'green')) {
      const idx0 = rows.find(r => r.submission_id.includes(`-${pharmacy.slug}-000-`))!
      const ageMs = NOW.getTime() - new Date(idx0.created_at).getTime()
      // 2 minutes target. Allow a generous 15-min ceiling for the
      // adapter-health green threshold.
      expect(ageMs).toBeLessThan(15 * 60_000)
      expect(ageMs).toBeGreaterThan(0)
    }
  })

  it('yellow pharmacy freshness anchor lands in the 15-60 min band', () => {
    const rows = buildSubmissionBatch(NOW)
    const yellow = DEMO_PHARMACIES.find(p => p.target === 'yellow')!
    const idx0 = rows.find(r => r.submission_id.includes(`-${yellow.slug}-000-`))!
    const ageMs = NOW.getTime() - new Date(idx0.created_at).getTime()
    // 25 min target — inside the yellow band (15-60 min).
    expect(ageMs).toBeGreaterThan(15 * 60_000)
    expect(ageMs).toBeLessThan(60 * 60_000)
  })

  it('all rows land inside the 24h rolling window', () => {
    const rows = buildSubmissionBatch(NOW)
    const TWENTY_FOUR_HOURS = 24 * 3_600_000
    for (const row of rows) {
      const ageMs = NOW.getTime() - new Date(row.created_at).getTime()
      expect(ageMs).toBeLessThan(TWENTY_FOUR_HOURS)
      expect(ageMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('submission_id matches poc-seed-<slug>-<idx>-<yyyymmdd> format', () => {
    const rows = buildSubmissionBatch(NOW)
    const pattern = /^poc-seed-[a-z][a-z0-9-]*-\d{3}-\d{8}$/
    for (const row of rows) {
      expect(row.submission_id).toMatch(pattern)
    }
  })

  it('submission_id encodes the correct yyyymmdd', () => {
    const rows = buildSubmissionBatch(NOW)
    // NOW = 2026-04-22 UTC
    for (const row of rows) {
      expect(row.submission_id.endsWith('-20260422')).toBe(true)
    }
  })

  it('every row references DEMO_ORDER_ID and a valid pharmacy UUID', () => {
    const rows = buildSubmissionBatch(NOW)
    const validIds = new Set(DEMO_PHARMACIES.map(p => p.id))
    for (const row of rows) {
      expect(row.order_id).toBe(DEMO_ORDER_ID)
      expect(validIds.has(row.pharmacy_id)).toBe(true)
    }
  })

  it('failures carry error_code + error_message; successes do not', () => {
    const rows = buildSubmissionBatch(NOW)
    for (const row of rows) {
      if (row.status === 'FAILED') {
        expect(row.error_code).toBe('POC_SEED_FAILURE')
        expect(row.error_message).not.toBeNull()
        expect(row.acknowledged_at).toBeNull()
      } else {
        expect(row.error_code).toBeNull()
        expect(row.error_message).toBeNull()
        expect(row.acknowledged_at).not.toBeNull()
      }
    }
  })

  it('submission_ids are unique across the batch', () => {
    const rows = buildSubmissionBatch(NOW)
    const ids = new Set(rows.map(r => r.submission_id))
    expect(ids.size).toBe(rows.length)
  })
})

describe('buildSubmissionBatch + computeAdapterStatus integration', () => {
  // computeAdapterStatus reads Date.now() internally. Freeze wall-
  // clock to NOW so lastSuccessMs is measured from the same anchor
  // the batch was built against — otherwise tests flake depending
  // on wall-clock drift between batch creation and classification.
  const NOW = new Date('2026-04-22T15:00:00.000Z')

  beforeAll(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'setTimeout', 'setInterval', 'nextTick'] })
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  const rows: SubmissionInsert[] = buildSubmissionBatch(NOW)

  // Mirrors the API route's classification flow (page.tsx and
  // api/ops/adapters/route.ts). If this assertion breaks, the
  // live Ops dashboard will also render incorrectly.
  function classifyPharmacy(pharmacyId: string): ReturnType<typeof computeAdapterStatus> {
    const pharmacyRows = rows
      .filter(r => r.pharmacy_id === pharmacyId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    const successes = pharmacyRows.filter(r => r.status === 'CONFIRMED')
    const successRate = Math.round((successes.length / pharmacyRows.length) * 100 * 10) / 10

    const lastSuccess = successes.at(-1)
    const lastSuccessTs = lastSuccess
      ? (lastSuccess.acknowledged_at ?? lastSuccess.completed_at ?? lastSuccess.created_at)
      : null

    return computeAdapterStatus(successRate, null, lastSuccessTs, pharmacyRows.length)
  }

  it('classifies every green pharmacy as green', () => {
    for (const pharmacy of DEMO_PHARMACIES.filter(p => p.target === 'green')) {
      expect(classifyPharmacy(pharmacy.id)).toBe('green')
    }
  })

  it('classifies the yellow pharmacy as yellow', () => {
    const yellow = DEMO_PHARMACIES.find(p => p.target === 'yellow')!
    expect(classifyPharmacy(yellow.id)).toBe('yellow')
  })

  it('classifies no pharmacy as red or idle', () => {
    for (const pharmacy of DEMO_PHARMACIES) {
      const status = classifyPharmacy(pharmacy.id)
      expect(status).not.toBe('red')
      expect(status).not.toBe('idle')
    }
  })
})

describe('refreshDemoData POC_MODE gate', () => {
  it('short-circuits to skipped report when POC_MODE is unset', async () => {
    delete process.env['POC_MODE']

    // Supabase mock that would throw loudly on any call — proves
    // the short-circuit really prevents all DB access.
    const supabase = new Proxy({}, {
      get() { throw new Error('supabase should NOT be called when POC_MODE is unset') },
    }) as unknown as Parameters<typeof refreshDemoData>[0]

    const report = await refreshDemoData(supabase)

    expect(report.skipped).toBe('not_poc_mode')
    expect(report.ok).toBe(true)  // skipped is a deliberate no-op, not a failure
    expect(report.fax_seed.action).toBe('skipped')
    expect(report.submission_seed.action).toBe('skipped')
  })

  it('short-circuits when POC_MODE is anything other than "true"', async () => {
    // Set POC_MODE to 'false' and 'TRUE' (case sensitivity check).
    for (const val of ['false', 'TRUE', '1', 'yes']) {
      process.env['POC_MODE'] = val
      const supabase = new Proxy({}, {
        get() { throw new Error(`supabase should NOT be called when POC_MODE=${val}`) },
      }) as unknown as Parameters<typeof refreshDemoData>[0]

      const report = await refreshDemoData(supabase)
      expect(report.skipped).toBe('not_poc_mode')
    }
  })
})

describe('SEED_ROW_CAP constant', () => {
  it('is a sane value (larger than nominal batch, smaller than prod signal)', () => {
    expect(SEED_ROW_CAP).toBeGreaterThan(200)  // > nominal batch of 200
    expect(SEED_ROW_CAP).toBeLessThan(10_000)  // <<< prod traffic volume
  })
})
