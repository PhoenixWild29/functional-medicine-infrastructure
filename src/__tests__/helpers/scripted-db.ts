// ============================================================
// A scripted stand-in for the Supabase client — Batch 3 tests
// ============================================================
//
// Every awaited query is answered by one function that sees what was
// asked: the table, the operation, the filters, the payload and whether
// it ended in single()/maybeSingle(). A test answers the calls it cares
// about and lets the rest fall through to { data: null, error: null }.
// Every call is recorded, so a test can assert what was (not) written.
//
// For the crons, webhooks and adapters, whose queries are too varied for
// fake-db.ts: the point of these tests is what the code does when one
// specific call fails.

export interface ScriptedCall {
  table:   string
  op:      'select' | 'update' | 'insert' | 'upsert' | 'delete' | 'rpc'
  filters: Record<string, unknown>
  payload: unknown
  single:  'maybe' | 'one' | null
  head:    boolean
}

export interface ScriptedAnswer {
  data?:  unknown
  error?: { message: string; code?: string } | null
  count?: number | null
}

export type Script = (call: ScriptedCall) => ScriptedAnswer | undefined

export const DB_DOWN = { data: null, error: { message: 'connection reset' }, count: null }

export function scriptedDb(script: Script) {
  const calls: ScriptedCall[] = []

  function builder(table: string, op: ScriptedCall['op'] = 'select', payload: unknown = undefined) {
    const call: ScriptedCall = { table, op, filters: {}, payload, single: null, head: false }
    const run = () => {
      calls.push(call)
      const a = script(call) ?? {}
      return { data: a.data ?? null, error: a.error ?? null, count: a.count ?? null }
    }
    const filter = (kind: string) => (col: string, v?: unknown, w?: unknown) => {
      call.filters[kind === 'eq' ? col : `${col}:${kind}`] = w === undefined ? v : [v, w]
      return q
    }
    const q: Record<string, unknown> = {
      select(_cols?: string, opts?: { head?: boolean }) { if (opts?.head) call.head = true; return q },
      update(p: unknown) { call.op = 'update'; call.payload = p; return q },
      insert(p: unknown) { call.op = 'insert'; call.payload = p; return q },
      upsert(p: unknown) { call.op = 'upsert'; call.payload = p; return q },
      delete() { call.op = 'delete'; return q },
      eq: filter('eq'), neq: filter('neq'), in: filter('in'), is: filter('is'), not: filter('not'),
      gt: filter('gt'), gte: filter('gte'), lt: filter('lt'), lte: filter('lte'),
      or: filter('or'), ilike: filter('ilike'), contains: filter('contains'),
      order() { return q }, limit() { return q }, range() { return q }, returns() { return q },
      maybeSingle() { call.single = 'maybe'; return Promise.resolve(run()) },
      single() { call.single = 'one'; return Promise.resolve(run()) },
      then<T>(resolve: (v: ReturnType<typeof run>) => T, reject?: (e: unknown) => T) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    return q
  }

  const client: Record<string, unknown> = {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => builder(fn, 'rpc', args),
  }
  // .schema('vault').from('decrypted_secrets') answers as table 'decrypted_secrets'
  client['schema'] = () => client

  return {
    client: client as never,
    calls,
    /** Calls to one table, optionally one op. */
    to(table: string, op?: ScriptedCall['op']) {
      return calls.filter(c => c.table === table && (!op || c.op === op))
    },
  }
}
