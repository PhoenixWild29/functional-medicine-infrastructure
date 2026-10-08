/**
 * @jest-environment node
 *
 * Compliance C10, retention PR 1: /api/cron/retention, dry run only.
 *
 *   - The policies name only allowlisted tables. phi_access_log,
 *     epcs_audit_log, retention_runs, legal_holds, order_status_history
 *     and patients are never a retention target. An orders policy only
 *     ever matches unsigned drafts (status DRAFT, locked_at null).
 *   - No policy is live in PR 1: whatever RETENTION_ENABLED says, the run
 *     only counts. Every policy is recorded in retention_runs (append-
 *     only): mode dry_run, cutoff, rows matched, oldest and newest.
 *   - The runner reads; the only write is the retention_runs insert.
 *   - Anything under a legal hold (clinic or patient) is left out of the
 *     count; holds that cannot be read stop the run (nothing is counted
 *     as if there were none).
 *   - CRON_SECRET: the route answers 500 when it is unset.
 */

import type { NextRequest } from 'next/server'
import { RETENTION_POLICIES, RETENTION_TABLES, NEVER_RETENTION_TARGETS, runRetention } from '../policies'

// ── A recording stand-in for the service client ───────────────
type Call = { table: string; op: string; filters: Array<[string, string, unknown]>; payload?: unknown; head?: boolean; order?: [string, boolean] }

let calls: Call[] = []
let holds: Array<{ scope: string; target_id: string }> = []
let heldOrders: Array<{ order_id: string }> = []
let failHolds = false
let failInsert = false

function fakeClient() {
  return {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      calls.push(call)
      const q: Record<string, unknown> = {}
      const f = (op: string) => (col: string, val?: unknown) => { call.filters.push([op, col, val]); return q }
      q['select'] = (_cols: string, opts?: { head?: boolean }) => { call.head = !!opts?.head; return q }
      for (const op of ['eq', 'is', 'lt', 'not', 'in', 'or']) q[op] = (col: string, a?: unknown, b?: unknown) => { call.filters.push([op, col, b === undefined ? a : [a, b]]); return q }
      q['order'] = (col: string, o?: { ascending?: boolean }) => { call.order = [col, o?.ascending !== false]; return q }
      q['limit'] = () => q
      q['insert'] = (payload: unknown) => { call.op = 'insert'; call.payload = payload; return Promise.resolve({ error: failInsert ? { message: 'down' } : null }) }
      for (const op of ['update', 'delete', 'upsert']) q[op] = () => { call.op = op; return q }
      void f
      q['then'] = (resolve: (v: unknown) => unknown) => {
        if (table === 'legal_holds') return Promise.resolve(failHolds ? { data: null, error: { message: 'down' } } : { data: holds, error: null }).then(resolve)
        if (table === 'orders' && !call.head && !call.order) return Promise.resolve({ data: heldOrders, error: null }).then(resolve)
        if (call.head) return Promise.resolve({ data: null, error: null, count: 7 }).then(resolve)
        const age = call.order?.[0] ?? 'created_at'
        return Promise.resolve({ data: [{ [age]: call.order?.[1] ? '2020-01-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z' }], error: null }).then(resolve)
      }
      return q
    },
  }
}

const NOW = new Date('2026-10-11T09:00:00.000Z')
const run = (enabled = false) => runRetention(fakeClient() as never, { enabled, now: NOW })
const inserted = () => calls.filter(c => c.table === 'retention_runs' && c.op === 'insert').flatMap(c => c.payload as Array<Record<string, unknown>>)

const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
afterAll(() => { errorSpy.mockRestore(); infoSpy.mockRestore() })

beforeEach(() => {
  calls = []
  holds = []
  heldOrders = []
  failHolds = false
  failInsert = false
})

describe('the policies (allowlist)', () => {
  it('every policy names an allowlisted table; protected tables are never targets', () => {
    for (const t of ['phi_access_log', 'epcs_audit_log', 'retention_runs', 'legal_holds', 'order_status_history', 'patients']) {
      expect(NEVER_RETENTION_TARGETS).toContain(t)
      expect(RETENTION_TABLES).not.toContain(t)
    }
    for (const p of RETENTION_POLICIES) {
      expect(RETENTION_TABLES).toContain(p.table)
      expect(NEVER_RETENTION_TARGETS).not.toContain(p.table)
    }
  })

  it('an orders policy only matches unsigned drafts', () => {
    const orders = RETENTION_POLICIES.filter(p => p.table === 'orders')
    expect(orders.length).toBeGreaterThan(0)
    for (const p of orders) {
      expect(p.filters).toEqual(expect.arrayContaining([
        { op: 'eq', column: 'status', value: 'DRAFT' },
        { op: 'is', column: 'locked_at', value: null },
      ]))
    }
  })

  it('no policy is live in PR 1', () => {
    for (const p of RETENTION_POLICIES) expect(p.live).toBe(false)
  })

  it('each policy has a unique key the retention_runs CHECK accepts, a period and a source', () => {
    const keys = RETENTION_POLICIES.map(p => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of RETENTION_POLICIES) {
      expect(p.key).toMatch(/^[a-z0-9_]{1,60}$/)
      expect(p.keepDays).toBeGreaterThanOrEqual(30)
      expect(p.source.length).toBeGreaterThan(10)
    }
  })

  it('covers the plan: drafts, webhook and adapter payloads, prescription PDFs, SMS log, ops notifications', () => {
    expect(RETENTION_POLICIES.map(p => p.key).sort()).toEqual([
      'abandoned_drafts', 'adapter_response_payloads', 'clinic_notifications_acknowledged', 'ops_alert_queue_sent',
      'pharmacy_webhook_payloads', 'prescription_pdfs', 'sla_notifications_log', 'sms_log', 'webhook_payloads',
    ])
  })
})

describe('a run', () => {
  it('counts every policy and records each in retention_runs as a dry run', async () => {
    const result = await run()
    expect(result.ok).toBe(true)
    const rows = inserted()
    expect(rows.map(r => r['policy']).sort()).toEqual(RETENTION_POLICIES.map(p => p.key).sort())
    for (const r of rows) {
      expect(r).toEqual(expect.objectContaining({ mode: 'dry_run', rows_matched: 7, rows_affected: 0, error: null }))
      expect(typeof r['run_id']).toBe('string')
      expect(r['oldest_at']).toBe('2020-01-01T00:00:00.000Z')
      expect(r['newest_at']).toBe('2026-01-01T00:00:00.000Z')
    }
    const drafts = rows.find(r => r['policy'] === 'abandoned_drafts')!
    expect(drafts['cutoff']).toBe('2026-07-13T09:00:00.000Z') // 90 days before NOW
  })

  it('RETENTION_ENABLED on still only counts in PR 1', async () => {
    await run(true)
    for (const r of inserted()) expect(r).toEqual(expect.objectContaining({ mode: 'dry_run', rows_affected: 0 }))
  })

  it('only reads; the one write is the retention_runs insert', async () => {
    await run(true)
    const writes = calls.filter(c => c.op !== 'select')
    expect(writes.length).toBeGreaterThan(0)
    for (const w of writes) expect(w).toEqual(expect.objectContaining({ table: 'retention_runs', op: 'insert' }))
    // legal_holds is read, retention_runs written (above); the other protected tables are never touched.
    for (const c of calls) expect(NEVER_RETENTION_TARGETS.filter(t => t !== 'legal_holds' && t !== 'retention_runs')).not.toContain(c.table)
  })

  it('each count is bounded by the cutoff and the policy filters; drafts only', async () => {
    await run()
    const draftCount = calls.find(c => c.table === 'orders' && c.head)!
    expect(draftCount.filters).toEqual(expect.arrayContaining([
      ['eq', 'status', 'DRAFT'], ['is', 'locked_at', null], ['lt', 'updated_at', '2026-07-13T09:00:00.000Z'],
    ]))
  })

  it('a clinic or patient under a legal hold is left out of the counts', async () => {
    holds = [{ scope: 'clinic', target_id: 'c-held' }, { scope: 'patient', target_id: 'p-held' }]
    heldOrders = [{ order_id: 'o-held' }]
    await run()
    const draftCount = calls.find(c => c.table === 'orders' && c.head)!
    expect(draftCount.filters).toEqual(expect.arrayContaining([
      ['not', 'clinic_id', ['in', '(c-held)']], ['not', 'patient_id', ['in', '(p-held)']],
    ]))
    const payloadCount = calls.find(c => c.table === 'webhook_events' && c.head)!
    expect(payloadCount.filters).toEqual(expect.arrayContaining([['not', 'order_id', ['in', '(o-held)']]]))
  })

  it('legal holds that cannot be read stop the run: nothing is counted as if there were none', async () => {
    failHolds = true
    const result = await run()
    expect(result.ok).toBe(false)
    expect(calls.filter(c => c.head)).toEqual([])
    for (const r of inserted()) expect(r).toEqual(expect.objectContaining({ rows_matched: 0, error: expect.stringContaining('legal holds could not be read') }))
  })

  it('a run that cannot be recorded is a failure', async () => {
    failInsert = true
    expect((await run()).ok).toBe(false)
  })
})

describe('GET /api/cron/retention', () => {
  it('500 when CRON_SECRET is unset, nothing read', async () => {
    delete process.env['CRON_SECRET']
    jest.resetModules()
    const createServiceClient = jest.fn()
    jest.doMock('@/lib/supabase/service', () => ({ createServiceClient }))
    const { GET } = await import('@/app/api/cron/retention/route')
    const res = await GET({ headers: { get: () => 'Bearer undefined' } } as unknown as NextRequest)
    expect(res.status).toBe(500)
    expect(createServiceClient).not.toHaveBeenCalled()
  })
})
