// ============================================================
// A small in-memory stand-in for the Supabase query builder
// ============================================================
//
// Enough of PostgREST for the batch-sign tests: select / update / insert
// with eq, neq, in, is, order, limit, maybeSingle, single. Every write is
// recorded, so a test can assert that NOTHING was written when a batch is
// refused, and what exactly the signing update carried.
//
// failOn('table:op') makes that call answer { data: null, error }.

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean

export interface FakeWrite {
  table: string
  op:    'update' | 'insert'
  patch?: Row | undefined
  rows?:  Row[] | undefined
  /** The rows the update touched (ids), for update. */
  matched?: Row[]
}

export function fakeDb(tables: Record<string, Row[]>) {
  const writes: FakeWrite[] = []
  const failures = new Map<string, string>()

  function builder(table: string) {
    let op: 'select' | 'update' | 'insert' = 'select'
    let patch: Row | undefined
    let inserted: Row[] | undefined
    let single: 'maybe' | 'one' | null = null
    const filters: Filter[] = []

    const run = (): { data: unknown; error: { message: string } | null } => {
      const failure = failures.get(`${table}:${op}`)
      if (failure) return { data: null, error: { message: failure } }
      const rows = tables[table] ?? (tables[table] = [])
      if (op === 'insert') {
        rows.push(...(inserted ?? []))
        writes.push({ table, op, rows: inserted })
        return { data: single ? (inserted?.[0] ?? null) : inserted, error: null }
      }
      const matched = rows.filter(r => filters.every(f => f(r)))
      if (op === 'update') {
        for (const r of matched) Object.assign(r, patch)
        writes.push({ table, op, patch, matched: matched.map(r => ({ ...r })) })
      }
      if (single) return { data: matched[0] ?? null, error: null }
      return { data: matched.map(r => ({ ...r })), error: null }
    }

    const q = {
      select() { return q },
      update(p: Row) { op = 'update'; patch = p; return q },
      insert(r: Row | Row[]) { op = 'insert'; inserted = Array.isArray(r) ? r : [r]; return q },
      eq(col: string, v: unknown) { filters.push(r => r[col] === v); return q },
      neq(col: string, v: unknown) { filters.push(r => r[col] !== v); return q },
      in(col: string, vs: unknown[]) { filters.push(r => vs.includes(r[col])); return q },
      is(col: string, v: unknown) { filters.push(r => (r[col] ?? null) === v); return q },
      not(col: string, op: string, v: unknown) {
        if (op === 'is') filters.push(r => (r[col] ?? null) !== v)
        else filters.push(r => r[col] !== v)
        return q
      },
      gte(col: string, v: unknown) { filters.push(r => String(r[col]) >= String(v)); return q },
      lt(col: string, v: unknown) { filters.push(r => String(r[col]) < String(v)); return q },
      order() { return q },
      limit() { return q },
      maybeSingle() { single = 'maybe'; return Promise.resolve(run()) },
      single() { single = 'one'; return Promise.resolve(run()) },
      then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return q
  }

  return {
    client: { from: (table: string) => builder(table) } as never,
    tables,
    writes,
    failOn(key: string, message = 'connection reset') { failures.set(key, message) },
    /** Writes to one table (optionally one op). */
    writesTo(table: string, op?: 'update' | 'insert') {
      return writes.filter(w => w.table === table && (!op || w.op === op))
    },
  }
}
