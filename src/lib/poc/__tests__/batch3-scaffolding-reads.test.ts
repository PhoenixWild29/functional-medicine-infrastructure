/**
 * @jest-environment node
 *
 * Batch 3, PR 2: Refresh Demo Data stops on a failed existence read.
 *
 * ensureDemoScaffolding checks each durable row (clinic, patient,
 * provider, orders, pharmacies) before inserting it. Before, a failed
 * check read as "absent" and the insert ran anyway — a duplicate-key
 * error at best, and for the pharmacy slug check, the collision guard
 * was skipped. Now a failed read returns { action: 'error' } naming the
 * read, and nothing after it is written.
 */

import { scriptedDb, DB_DOWN, type ScriptedCall } from '@/__tests__/helpers/scripted-db'
import { ensureDemoScaffolding } from '../refresh-demo-data'

type Case = { name: string; fails: (c: ScriptedCall, n: number) => boolean; error: RegExp; table: string }

const CASES: Case[] = [
  { name: 'clinic',          table: 'clinics',    fails: c => c.table === 'clinics',   error: /^clinic read: connection reset/ },
  { name: 'patient',         table: 'patients',   fails: c => c.table === 'patients',  error: /^patient read: connection reset/ },
  { name: 'provider',        table: 'providers',  fails: c => c.table === 'providers', error: /^provider read: connection reset/ },
  { name: 'order',           table: 'orders',     fails: (c, n) => c.table === 'orders' && n === 0, error: /^order read: connection reset/ },
  { name: 'cross-tier order', table: 'orders',    fails: (c, n) => c.table === 'orders' && n === 1, error: /^cross-tier order TIER_1_API read: connection reset/ },
  { name: 'pharmacy by id',  table: 'pharmacies', fails: c => c.table === 'pharmacies' && 'pharmacy_id' in c.filters, error: /^pharmacy '.+' read: connection reset/ },
  { name: 'pharmacy by slug', table: 'pharmacies', fails: c => c.table === 'pharmacies' && 'slug' in c.filters, error: /^pharmacy '.+' slug read: connection reset/ },
]

describe.each(CASES)('ensureDemoScaffolding: a failed $name read', ({ fails, error, table }) => {
  it('returns an error naming the read and inserts nothing for it', async () => {
    const seen: Record<string, number> = {}
    const db = scriptedDb(c => {
      if (c.op !== 'select') return undefined
      const n = seen[c.table] ?? 0
      seen[c.table] = n + 1
      if (fails(c, n)) return DB_DOWN
      // Everything exists, except pharmacies by id (so the slug check runs).
      if (c.table === 'pharmacies') return { data: null }
      return { data: { id: 'exists' } }
    })
    const result = await ensureDemoScaffolding(db.client)
    expect(result.action).toBe('error')
    expect(result.error).toMatch(error)
    expect(db.to(table, 'insert')).toHaveLength(0)
  })
})
