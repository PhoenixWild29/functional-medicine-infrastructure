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
  cleanupE2EFixtureLeaks,
  ensureDemoScaffolding,
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
      // insertion order. metadata.idx + metadata.slug identify the row.
      const idx0 = forPharmacy.find(r => r.metadata.idx === 0 && r.metadata.slug === pharmacy.slug)
      expect(idx0).toBeDefined()
      expect(idx0!.status).toBe('CONFIRMED')
    }
  })

  it('green pharmacy freshness anchor is within 15 minutes of now', () => {
    const rows = buildSubmissionBatch(NOW)
    for (const pharmacy of DEMO_PHARMACIES.filter(p => p.target === 'green')) {
      const idx0 = rows.find(r => r.metadata.idx === 0 && r.metadata.slug === pharmacy.slug)!
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
    const idx0 = rows.find(r => r.metadata.idx === 0 && r.metadata.slug === yellow.slug)!
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

  it('submission_id is a valid UUID (not the seed marker — cowork round-3 F3)', () => {
    // Regression guard for the PR #5 mistake: submission_id is
    // UUID-typed, so putting a string marker in it fails the DB
    // insert. The marker lives in metadata JSONB instead.
    const rows = buildSubmissionBatch(NOW)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    for (const row of rows) {
      expect(row.submission_id).toMatch(uuidPattern)
    }
  })

  it('every row carries metadata.poc_seed = true (delete-guard contract)', () => {
    // The delete-guard matches on .contains('metadata', { poc_seed: true }).
    // A row without that exact key would be orphaned across refreshes.
    const rows = buildSubmissionBatch(NOW)
    for (const row of rows) {
      expect(row.metadata.poc_seed).toBe(true)
    }
  })

  it('metadata.slug + metadata.idx are present and consistent with pharmacy_id', () => {
    const rows = buildSubmissionBatch(NOW)
    for (const row of rows) {
      const expected = DEMO_PHARMACIES.find(p => p.id === row.pharmacy_id)
      expect(expected).toBeDefined()
      expect(row.metadata.slug).toBe(expected!.slug)
      expect(row.metadata.idx).toBeGreaterThanOrEqual(0)
      expect(row.metadata.idx).toBeLessThan(40)
    }
  })

  it('metadata.ymd matches NOW date in yyyymmdd format', () => {
    const rows = buildSubmissionBatch(NOW)
    // NOW = 2026-04-22 UTC
    for (const row of rows) {
      expect(row.metadata.ymd).toBe('20260422')
    }
  })

  it('does NOT write to external_reference_id (H1: avoid webhook-resolver collision)', () => {
    // external_reference_id is read by the pharmacy webhook resolver
    // at src/app/api/webhooks/pharmacy/[pharmacySlug]/route.ts.
    // Putting a seed value there risks routing a real webhook to
    // DEMO_ORDER_ID — we deliberately leave the column unset on
    // seed rows so the webhook resolver's `.eq(external_reference_id)`
    // lookup can never match one of our rows.
    const rows = buildSubmissionBatch(NOW)
    for (const row of rows) {
      expect((row as unknown as { external_reference_id?: string }).external_reference_id).toBeUndefined()
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

  it('metadata.slug + metadata.idx pair is unique across the batch', () => {
    // Each (slug, idx) pair identifies exactly one row per day.
    // submission_id is the DB primary key — it auto-generates fresh
    // UUIDs every call — so (slug, idx) uniqueness is the only
    // human-traceable row identifier across refreshes.
    const rows = buildSubmissionBatch(NOW)
    const pairs = new Set(rows.map(r => `${r.metadata.slug}-${String(r.metadata.idx).padStart(3, '0')}`))
    expect(pairs.size).toBe(rows.length)
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
    // PR #9 (cowork H1): skipped is a CONFIGURATION problem, not a
    // success. `ok` must be false so the cron handler + admin route
    // surface the config error. Previously `ok: true` on skip let
    // F6 ship to prod silently — every downstream consumer treated
    // the skip as healthy.
    expect(report.ok).toBe(false)
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
      // Same PR #9 H1 contract for any non-'true' value.
      expect(report.ok).toBe(false)
    }
  })
})

describe('SEED_ROW_CAP constant', () => {
  it('is a sane value (larger than nominal batch, smaller than prod signal)', () => {
    expect(SEED_ROW_CAP).toBeGreaterThan(200)  // > nominal batch of 200
    expect(SEED_ROW_CAP).toBeLessThan(10_000)  // <<< prod traffic volume
  })
})

describe('ensureDemoScaffolding — pharmacies (PR #11)', () => {
  // ── Mock helper ──────────────────────────────────────────────
  // Scaffolding makes many fluent-chain calls against supabase.
  // This builder returns a minimal mock that answers each
  // .from(table).select(...).eq(col, val).maybeSingle() based on
  // a table-scoped behavior map. For this test, every base-row
  // (clinic/patient/provider/order) lookup returns an existing
  // row (so those branches no-op), and every pharmacy lookup
  // returns null (so the pharmacy insert path runs for all 5).
  function buildScaffoldingMock() {
    const calls: Array<{ op: string; args: unknown[] }> = []
    let pharmacyInserts = 0
    // PR #16: tracks the circuit_breaker_state upsert the new CB seed
    // path triggers at the end of ensureDemoScaffolding. Separate from
    // pharmacyInserts because upsert ≠ insert (distinct Supabase verb).
    const cbUpsertCalls: Array<Record<string, unknown>[]> = []

    const chainForTable = (table: string) => ({
      eq(col: string, val: unknown) {
        calls.push({ op: `${table}.eq`, args: [col, val] })
        return {
          eq: (col2: string, val2: unknown) => {
            calls.push({ op: `${table}.eq.eq`, args: [col2, val2] })
            return this
          },
          maybeSingle: () => {
            // clinic/patient/provider/order: return existing row
            // (primary-key lookup — skip insert). Pharmacies: no
            // row exists (insert runs).
            if (table === 'pharmacies') {
              return Promise.resolve({ data: null, error: null })
            }
            return Promise.resolve({ data: { id: val }, error: null })
          },
        }
      },
    })

    const supabase = {
      from(table: string) {
        calls.push({ op: 'from', args: [table] })
        return {
          select() {
            return chainForTable(table)
          },
          insert(_payload: Record<string, unknown>) {
            calls.push({ op: `${table}.insert`, args: [_payload] })
            if (table === 'pharmacies') pharmacyInserts++
            return Promise.resolve({ error: null })
          },
          upsert(payload: Record<string, unknown>[] | Record<string, unknown>, _opts?: unknown) {
            calls.push({ op: `${table}.upsert`, args: [payload] })
            if (table === 'circuit_breaker_state') {
              cbUpsertCalls.push(Array.isArray(payload) ? payload : [payload])
            }
            return Promise.resolve({ error: null })
          },
        }
      },
    } as unknown as Parameters<typeof ensureDemoScaffolding>[0]

    return {
      supabase,
      calls,
      get pharmacyInserts() { return pharmacyInserts },
      get cbUpsertCalls()   { return cbUpsertCalls },
    }
  }

  it('inserts all 5 DEMO_PHARMACIES when none exist', async () => {
    const mock = buildScaffoldingMock()
    const result = await ensureDemoScaffolding(mock.supabase)

    expect(result.action).toBe('created')
    // Access via the mock object (getter is live), not destructured —
    // a destructure captures the value at destructure time (0) and
    // misses the post-run increments.
    expect(mock.pharmacyInserts).toBe(DEMO_PHARMACIES.length)
  })

  it('returns error when a slug collision is detected', async () => {
    // Mock where the pharmacy_id lookup returns null (not in the
    // DB by UUID) but the slug lookup returns an existing row
    // (slug taken by a different pharmacy). This should short-
    // circuit the scaffolding with action: 'error' so the caller
    // can surface the conflict rather than insert-and-crash on the
    // UNIQUE constraint.
    let phCallCount = 0
    const supabase = {
      from(table: string) {
        return {
          select() {
            return {
              eq(col: string, _val: unknown) {
                return {
                  eq: () => this,
                  maybeSingle: () => {
                    if (table === 'pharmacies') {
                      phCallCount++
                      // 1st call: byId lookup → null. 2nd call:
                      // bySlug lookup → existing row (conflict).
                      if (phCallCount === 1) return Promise.resolve({ data: null, error: null })
                      return Promise.resolve({
                        data: { pharmacy_id: 'zzzzzzzz-0000-0000-0000-000000000001', slug: 'strive' },
                        error: null,
                      })
                    }
                    return Promise.resolve({ data: { id: _val }, error: null })
                  },
                }
              },
            }
          },
          insert() { return Promise.resolve({ error: null }) },
          upsert() { return Promise.resolve({ error: null }) },
        }
      },
    } as unknown as Parameters<typeof ensureDemoScaffolding>[0]

    const result = await ensureDemoScaffolding(supabase)
    expect(result.action).toBe('error')
    expect(result.error).toContain('slug')
    expect(result.error).toContain('strive')
  })

  it('upserts a CLOSED circuit_breaker_state row for all 5 pharmacies (PR #16 H3)', async () => {
    // Regression guard for the demo-env-renders-no-chips bug. Without
    // this seed, /ops/adapters shows zero CB chips on the 5 POC
    // pharmacies because circuit_breaker_state rows only get written
    // by the routing engine on real submission side-effects (which
    // don't happen for POC pharmacies in isolation). Production
    // pharmacies self-heal; POC pharmacies need the explicit seed.
    const mock = buildScaffoldingMock()
    const result = await ensureDemoScaffolding(mock.supabase)

    expect(result.action).toBe('created')
    expect(mock.cbUpsertCalls).toHaveLength(1)  // one batched upsert call, not 5 separate ones

    const rows = mock.cbUpsertCalls[0]!
    expect(rows).toHaveLength(DEMO_PHARMACIES.length)

    const seededPharmacyIds = new Set(rows.map(r => r['pharmacy_id']))
    for (const pharmacy of DEMO_PHARMACIES) {
      expect(seededPharmacyIds.has(pharmacy.id)).toBe(true)
    }

    // Every row must be CLOSED — the demo narration points at healthy
    // breakers ("if a pharmacy trips, you'd see Offline here"). If a
    // future refactor ever seeds something else, this catches it.
    for (const row of rows) {
      expect(row['state']).toBe('CLOSED')
      expect(row['failure_count']).toBe(0)
      expect(row['last_failure_at']).toBeNull()
      expect(row['cooldown_until']).toBeNull()
    }
  })
})

describe('cleanupE2EFixtureLeaks (PR #10)', () => {
  const E2E_UUIDS = [
    'aaaaaaaa-0000-0000-0000-000000000010',
    'aaaaaaaa-0000-0000-0000-000000000011',
    'aaaaaaaa-0000-0000-0000-000000000013',
  ]

  // Build a fluent supabase mock that records call order and yields
  // configurable responses. Mirrors the fluent chain used in
  // cleanupE2EFixtureLeaks: .from.select.in.is and .from.update.in.is.
  function buildMockSupabase(opts: {
    selectResult?: { data: { pharmacy_id: string }[] | null; error: { message: string } | null }
    updateResult?: { error: { message: string } | null }
  }) {
    const calls: Array<{ op: string; args: unknown[] }> = []

    const selectChain = {
      in(col: string, values: unknown[]) {
        calls.push({ op: 'select.in', args: [col, values] })
        return this
      },
      is(col: string, value: unknown) {
        calls.push({ op: 'select.is', args: [col, value] })
        return Promise.resolve(opts.selectResult ?? { data: [], error: null })
      },
    }

    const updateChain = {
      in(col: string, values: unknown[]) {
        calls.push({ op: 'update.in', args: [col, values] })
        return this
      },
      is(col: string, value: unknown) {
        calls.push({ op: 'update.is', args: [col, value] })
        return Promise.resolve(opts.updateResult ?? { error: null })
      },
    }

    const fromTable = {
      select(_cols: string) {
        calls.push({ op: 'select', args: [_cols] })
        return selectChain
      },
      update(payload: Record<string, unknown>) {
        calls.push({ op: 'update', args: [payload] })
        return updateChain
      },
    }

    const supabase = {
      from(table: string) {
        calls.push({ op: 'from', args: [table] })
        return fromTable
      },
    } as unknown as Parameters<typeof cleanupE2EFixtureLeaks>[0]

    return { supabase, calls }
  }

  it('returns clean with zero rows when nothing leaked', async () => {
    const { supabase } = buildMockSupabase({
      selectResult: { data: [], error: null },
    })
    const result = await cleanupE2EFixtureLeaks(supabase)
    expect(result.action).toBe('clean')
    expect(result.soft_deleted).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('soft-deletes leaked rows and returns the count', async () => {
    const { supabase, calls } = buildMockSupabase({
      selectResult: {
        data: [
          { pharmacy_id: E2E_UUIDS[0]! },
          { pharmacy_id: E2E_UUIDS[1]! },
          { pharmacy_id: E2E_UUIDS[2]! },
        ],
        error: null,
      },
      updateResult: { error: null },
    })
    const result = await cleanupE2EFixtureLeaks(supabase)

    expect(result.action).toBe('soft_deleted')
    expect(result.soft_deleted).toBe(3)
    expect(result.error).toBeUndefined()

    // Verify the update was called with deleted_at, filtered by the
    // E2E UUIDs + deleted_at IS NULL.
    const updateCall = calls.find(c => c.op === 'update')
    expect(updateCall).toBeDefined()
    expect(updateCall!.args[0]).toHaveProperty('deleted_at')

    const updateInCall = calls.find(c => c.op === 'update.in')
    expect(updateInCall).toBeDefined()
    expect(updateInCall!.args[1]).toEqual(E2E_UUIDS)

    const updateIsCall = calls.find(c => c.op === 'update.is')
    expect(updateIsCall).toBeDefined()
    expect(updateIsCall!.args).toEqual(['deleted_at', null])
  })

  it('returns error when the select count query fails', async () => {
    const { supabase } = buildMockSupabase({
      selectResult: { data: null, error: { message: 'permission denied' } },
    })
    const result = await cleanupE2EFixtureLeaks(supabase)
    expect(result.action).toBe('error')
    expect(result.error).toContain('permission denied')
  })

  it('returns error when the update fails after detecting a leak', async () => {
    const { supabase } = buildMockSupabase({
      selectResult: { data: [{ pharmacy_id: E2E_UUIDS[0]! }], error: null },
      updateResult: { error: { message: 'write conflict' } },
    })
    const result = await cleanupE2EFixtureLeaks(supabase)
    expect(result.action).toBe('error')
    expect(result.error).toContain('write conflict')
  })

  it('skips entirely when POC_MODE is unset (via refreshDemoData)', async () => {
    // Cleanup is only reached through refreshDemoData, which gates
    // on POC_MODE. This test confirms the chain short-circuits.
    delete process.env['POC_MODE']
    const supabase = new Proxy({}, {
      get() { throw new Error('supabase must NOT be called when POC_MODE is unset') },
    }) as unknown as Parameters<typeof refreshDemoData>[0]

    const report = await refreshDemoData(supabase)
    expect(report.e2e_leak_cleanup.action).toBe('skipped')
    expect(report.e2e_leak_cleanup.soft_deleted).toBe(0)
  })
})
