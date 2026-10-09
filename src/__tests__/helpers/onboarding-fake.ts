// ============================================================
// An in-memory stand-in for the Supabase service client
// (pharmacy onboarding tests)
// ============================================================
//
// Tables (select / insert / update / upsert / delete with eq, neq, in,
// is, not, gt, gte, lt, order, limit, single, maybeSingle, count),
// auth.admin (createUser, deleteUser, getUserById), storage (upload,
// remove, createSignedUrl) and rpc (create_vault_secret,
// rotate_vault_secret). Every call is recorded; failOn('table:op'),
// failOn('auth:createUser'), failOn('storage:upload'),
// failOn('rpc:create_vault_secret') make that call answer an error.
// Unique columns can be declared per table to mimic constraints.

type Row = Record<string, unknown>

export interface FakeCall { kind: 'table' | 'auth' | 'storage' | 'rpc'; name: string; op: string; payload?: unknown; filters?: string[] }

export function onboardingFake(seed: Record<string, Row[]> = {}, opts: { unique?: Record<string, string[]> } = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map(r => ({ ...r }))]))
  const calls: FakeCall[] = []
  const failures = new Map<string, string>()
  const users: Array<{ id: string; email: string; app_metadata: Row; user_metadata: Row }> = []
  const objects = new Map<string, { bucket: string; path: string; contentType: string; size: number }>()
  const vault = new Map<string, { name: string; secret: string }>()
  let seq = 0
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

  function fail(key: string) {
    const m = failures.get(key)
    return m ? { message: m, code: 'XX000' } : null
  }

  function builder(table: string) {
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
    let payload: Row[] | Row | undefined
    let single: 'one' | 'maybe' | null = null
    let countMode = false
    let head = false
    let selected = false
    const filters: Array<(r: Row) => boolean> = []
    const described: string[] = []
    let order: { col: string; asc: boolean } | null = null
    let limit: number | null = null
    let onConflict: string | null = null

    const run = () => {
      const error = fail(`${table}:${op}`)
      calls.push({ kind: 'table', name: table, op, payload, filters: described })
      if (error) return { data: null, error, count: null }
      const rows = tables[table] ?? (tables[table] = [])
      const unique = opts.unique?.[table] ?? []
      if (op === 'insert' || op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const out: Row[] = []
        for (const r0 of list) {
          const r = { ...r0 }
          const keys = op === 'upsert' && onConflict ? onConflict.split(',').map(s => s.trim()) : null
          const existing = keys ? rows.find(x => keys.every(k => x[k] === r[k])) : undefined
          if (existing) { Object.assign(existing, r); out.push({ ...existing }); continue }
          for (const col of unique) {
            if (r[col] != null && rows.some(x => x[col] === r[col])) return { data: null, error: { message: `duplicate key value violates unique constraint (${col})`, code: '23505' }, count: null }
          }
          const idCol = idColFor(table)
          if (idCol && r[idCol] === undefined) r[idCol] = uuid()
          rows.push(r)
          out.push({ ...r })
        }
        const data = single ? out[0] ?? null : out
        return { data: selected || single ? data : null, error: null, count: null }
      }
      let matched = rows.filter(r => filters.every(f => f(r)))
      if (op === 'update') {
        for (const r of matched) Object.assign(r, payload as Row)
        const data = matched.map(r => ({ ...r }))
        return { data: single ? data[0] ?? null : selected ? data : null, error: null, count: null }
      }
      if (op === 'delete') {
        tables[table] = rows.filter(r => !matched.includes(r))
        return { data: null, error: null, count: null }
      }
      if (order) {
        const { col, asc } = order
        matched = [...matched].sort((a, b) => (String(a[col] ?? '') < String(b[col] ?? '') ? -1 : String(a[col] ?? '') > String(b[col] ?? '') ? 1 : 0) * (asc ? 1 : -1))
      }
      if (limit != null) matched = matched.slice(0, limit)
      const data = matched.map(r => ({ ...r }))
      if (single === 'one' && data.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, count: null }
      if (single) return { data: data[0] ?? null, error: null, count: null }
      return { data: head ? null : data, error: null, count: countMode ? data.length : null }
    }

    const q: Record<string, unknown> = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) { selected = true; if (o?.count) countMode = true; if (o?.head) head = true; return q },
      insert(p: Row | Row[]) { op = 'insert'; payload = p; return q },
      upsert(p: Row | Row[], o?: { onConflict?: string }) { op = 'upsert'; payload = p; onConflict = o?.onConflict ?? null; return q },
      update(p: Row) { op = 'update'; payload = p; return q },
      delete() { op = 'delete'; return q },
      eq(c: string, v: unknown) { described.push(`${c}=${String(v)}`); filters.push(r => r[c] === v); return q },
      neq(c: string, v: unknown) { filters.push(r => r[c] !== v); return q },
      in(c: string, vs: unknown[]) { filters.push(r => vs.includes(r[c])); return q },
      is(c: string, v: unknown) { described.push(`${c} is ${String(v)}`); filters.push(r => (r[c] ?? null) === v); return q },
      not(c: string, o: string, v: unknown) { filters.push(r => (o === 'is' ? (r[c] ?? null) !== v : true)); return q },
      gt(c: string, v: unknown) { described.push(`${c}>${String(v)}`); filters.push(r => String(r[c]) > String(v)); return q },
      gte(c: string, v: unknown) { filters.push(r => String(r[c]) >= String(v)); return q },
      lt(c: string, v: unknown) { filters.push(r => String(r[c]) < String(v)); return q },
      order(c: string, o?: { ascending?: boolean }) { order = { col: c, asc: o?.ascending !== false }; return q },
      limit(n: number) { limit = n; return q },
      single() { single = 'one'; return Promise.resolve(run()) },
      maybeSingle() { single = 'maybe'; return Promise.resolve(run()) },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(run()).then(resolve, reject) },
    }
    return q
  }

  function idColFor(table: string): string | null {
    return ({
      pharmacy_invites: 'invite_id',
      pharmacy_onboarding_applications: 'application_id',
      pharmacy_agreement_acceptances: 'acceptance_id',
      pharmacy_onboarding_events: 'event_id',
      pharmacies: 'pharmacy_id',
    } as Record<string, string>)[table] ?? null
  }

  const client = {
    from: (t: string) => builder(t),
    rpc: async (fn: string, args: Row) => {
      calls.push({ kind: 'rpc', name: fn, op: 'call', payload: args })
      const error = fail(`rpc:${fn}`)
      if (error) return { data: null, error }
      if (fn === 'create_vault_secret') {
        const id = uuid()
        vault.set(id, { name: String(args['p_name']), secret: String(args['p_secret']) })
        return { data: id, error: null }
      }
      if (fn === 'rotate_vault_secret') {
        const v = vault.get(String(args['p_secret_id']))
        if (v) v.secret = String(args['p_new_secret'])
        return { data: null, error: null }
      }
      return { data: null, error: null }
    },
    auth: {
      admin: {
        createUser: async (u: { email: string; password: string; email_confirm?: boolean; app_metadata?: Row; user_metadata?: Row }) => {
          calls.push({ kind: 'auth', name: 'createUser', op: 'call', payload: { ...u, password: '[redacted]' } })
          const error = fail('auth:createUser')
          if (error) return { data: { user: null }, error }
          if (users.some(x => x.email === u.email)) return { data: { user: null }, error: { message: 'A user with this email address has already been registered', code: 'email_exists', status: 422 } }
          const user = { id: uuid(), email: u.email, app_metadata: u.app_metadata ?? {}, user_metadata: u.user_metadata ?? {} }
          users.push(user)
          return { data: { user }, error: null }
        },
        deleteUser: async (id: string) => {
          calls.push({ kind: 'auth', name: 'deleteUser', op: 'call', payload: id })
          const i = users.findIndex(u => u.id === id)
          if (i >= 0) users.splice(i, 1)
          return { data: {}, error: null }
        },
        getUserById: async (id: string) => {
          const user = users.find(u => u.id === id) ?? null
          return { data: { user }, error: user ? null : { message: 'not found' } }
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: { size?: number; byteLength?: number }, o?: { contentType?: string; upsert?: boolean }) => {
          calls.push({ kind: 'storage', name: bucket, op: 'upload', payload: { path, contentType: o?.contentType } })
          const error = fail('storage:upload')
          if (error) return { data: null, error }
          objects.set(`${bucket}/${path}`, { bucket, path, contentType: o?.contentType ?? '', size: body?.size ?? body?.byteLength ?? 0 })
          return { data: { path }, error: null }
        },
        remove: async (paths: string[]) => {
          calls.push({ kind: 'storage', name: bucket, op: 'remove', payload: paths })
          for (const p of paths) objects.delete(`${bucket}/${p}`)
          return { data: [], error: null }
        },
        createSignedUrl: async (path: string, expiresIn: number) => {
          calls.push({ kind: 'storage', name: bucket, op: 'createSignedUrl', payload: { path, expiresIn } })
          const error = fail('storage:createSignedUrl')
          if (error) return { data: null, error }
          return { data: { signedUrl: `https://storage.example/${bucket}/${path}?token=signed&expires=${expiresIn}` }, error: null }
        },
      }),
    },
  }

  return {
    client: client as never,
    tables,
    users,
    objects,
    vault,
    calls,
    failOn(key: string, message = 'connection reset') { failures.set(key, message) },
    clearFailures() { failures.clear() },
    rows(table: string) { return tables[table] ?? [] },
    writes(table: string, op?: string) { return calls.filter(c => c.kind === 'table' && c.name === table && c.op !== 'select' && (!op || c.op === op)) },
  }
}
