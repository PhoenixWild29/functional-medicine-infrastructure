/**
 * @jest-environment node
 *
 * GAP-3 writer — resolveProtocolLinkage unit tests.
 *
 * The resolver is the only place protocol_instance_id /
 * protocol_version_id values are minted, so its contract is what the
 * pilot validation gates ultimately stand on:
 *
 *   1. Existing published version + existing active instance → both
 *      reused, nothing written.
 *   2. Existing published version + no active instance → new instance
 *      with cycle_number = 1 + max prior cycle (any status).
 *   3. No published version → first-use auto-publish bootstrap:
 *      version 1, status 'published', intent_snapshot of template +
 *      items, sha256 intent_hash of the stable serialization.
 *   4. Unknown/cross-clinic protocol → null, no writes.
 *   5. Any DB error → null, never a throw (linkage is instrumentation
 *      and must not block prescribing).
 *   6. Unique-violation races on publish → the concurrent winner's
 *      version is reused.
 *
 * The fake client below replays queued results per table in FIFO
 * order (the resolver's query order is deterministic) and records
 * every call so tests can assert exactly what was read and written.
 */

import {
  resolveProtocolLinkage,
  stableSerialize,
  computeIntentHash,
  type ResolveProtocolLinkageArgs,
} from '../resolve-instance'
import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

// ── IDs ──────────────────────────────────────────────────────

const PROTOCOL_ID = 'b1000000-0000-0000-0000-000000000001'
const PATIENT_ID  = 'b2000000-0000-0000-0000-000000000001'
const PROVIDER_ID = 'b3000000-0000-0000-0000-000000000001'
const CLINIC_ID   = 'b4000000-0000-0000-0000-000000000001'
const VERSION_ID  = 'b5000000-0000-0000-0000-000000000001'
const INSTANCE_ID = 'b6000000-0000-0000-0000-000000000001'

const TEMPLATE_ROW = {
  protocol_id: PROTOCOL_ID,
  clinic_id:   CLINIC_ID,
  name:        'Thyroid Optimization',
  description: 'T3/T4 titration',
}

const ITEM_ROWS = [
  { item_id: 'i1', protocol_id: PROTOCOL_ID, formulation_id: 'f1', sort_order: 1 },
  { item_id: 'i2', protocol_id: PROTOCOL_ID, formulation_id: 'f2', sort_order: 2 },
]

// ── Fake supabase client ─────────────────────────────────────

type QueryResult = { data: unknown; error: { code?: string; message: string } | null }

interface RecordedCall {
  table: string
  action: 'select' | 'insert'
  payload?: Record<string, unknown>
  methods: Array<{ method: string; args: unknown[] }>
}

function makeClient(queues: Record<string, QueryResult[]>) {
  const calls: RecordedCall[] = []

  const client = {
    from(table: string) {
      const call: RecordedCall = { table, action: 'select', methods: [] }
      calls.push(call)

      const next = (): QueryResult => {
        const q = queues[table]
        if (!q || q.length === 0) return { data: null, error: null }
        return q.shift()!
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {}
      const chain = (method: string) => (...args: unknown[]) => {
        call.methods.push({ method, args })
        return builder
      }
      builder.select = chain('select')
      builder.eq     = chain('eq')
      builder.order  = chain('order')
      builder.limit  = chain('limit')
      builder.insert = (payload: Record<string, unknown>) => {
        call.action = 'insert'
        call.payload = payload
        call.methods.push({ method: 'insert', args: [payload] })
        return builder
      }
      builder.maybeSingle = () => Promise.resolve(next())
      builder.single      = () => Promise.resolve(next())
      builder.then = (
        resolve: (v: QueryResult) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(next()).then(resolve, reject)
      return builder
    },
  }

  return { client: client as unknown as SupabaseClient<Database>, calls }
}

function args(client: SupabaseClient<Database>): ResolveProtocolLinkageArgs {
  return {
    supabase:   client,
    protocolId: PROTOCOL_ID,
    patientId:  PATIENT_ID,
    providerId: PROVIDER_ID,
    clinicId:   CLINIC_ID,
  }
}

function inserts(calls: RecordedCall[], table?: string): RecordedCall[] {
  return calls.filter(c => c.action === 'insert' && (!table || c.table === table))
}

const ok = (data: unknown): QueryResult => ({ data, error: null })

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────

describe('resolveProtocolLinkage', () => {
  it('reuses an existing published version and active instance without writing', async () => {
    const { client, calls } = makeClient({
      protocol_templates:         [ok(TEMPLATE_ROW)],
      protocol_template_versions: [ok({ version_id: VERSION_ID })],
      protocol_instances:         [ok({ instance_id: INSTANCE_ID })],
    })

    const linkage = await resolveProtocolLinkage(args(client))

    expect(linkage).toEqual({
      protocolInstanceId: INSTANCE_ID,
      protocolVersionId:  VERSION_ID,
    })
    expect(inserts(calls)).toHaveLength(0)
  })

  it('scopes the protocol lookup to the caller clinic', async () => {
    const { client, calls } = makeClient({
      protocol_templates:         [ok(TEMPLATE_ROW)],
      protocol_template_versions: [ok({ version_id: VERSION_ID })],
      protocol_instances:         [ok({ instance_id: INSTANCE_ID })],
    })

    await resolveProtocolLinkage(args(client))

    const templateCall = calls.find(c => c.table === 'protocol_templates')!
    const eqs = templateCall.methods.filter(m => m.method === 'eq')
    expect(eqs).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['protocol_id', PROTOCOL_ID] },
        { method: 'eq', args: ['clinic_id', CLINIC_ID] },
      ]),
    )
  })

  it('starts a new cycle at 1 + max prior cycle when no active instance exists', async () => {
    const { client, calls } = makeClient({
      protocol_templates:         [ok(TEMPLATE_ROW)],
      protocol_template_versions: [ok({ version_id: VERSION_ID })],
      protocol_instances: [
        ok(null),                    // active-instance lookup → none
        ok({ cycle_number: 2 }),     // max prior cycle (completed runs)
        ok({ instance_id: INSTANCE_ID }), // insert result
      ],
    })

    const linkage = await resolveProtocolLinkage(args(client))

    expect(linkage).toEqual({
      protocolInstanceId: INSTANCE_ID,
      protocolVersionId:  VERSION_ID,
    })
    const [insert] = inserts(calls, 'protocol_instances')
    expect(insert).toBeDefined()
    expect(insert!.payload).toMatchObject({
      patient_id:   PATIENT_ID,
      provider_id:  PROVIDER_ID,
      clinic_id:    CLINIC_ID,
      protocol_id:  PROTOCOL_ID,
      version_id:   VERSION_ID,
      cycle_number: 3,
      status:       'active',
    })
  })

  it('bootstraps version 1 (published, snapshotted, hashed) when no published version exists', async () => {
    const { client, calls } = makeClient({
      protocol_templates:         [ok(TEMPLATE_ROW)],
      protocol_template_versions: [
        ok(null),                    // published lookup → none
        ok(null),                    // max version_number → none
        ok({ version_id: VERSION_ID }), // insert result
      ],
      protocol_items:     [ok(ITEM_ROWS)],
      protocol_instances: [
        ok(null),                    // active-instance lookup → none
        ok(null),                    // max cycle → none
        ok({ instance_id: INSTANCE_ID }),
      ],
    })

    const linkage = await resolveProtocolLinkage(args(client))

    expect(linkage).toEqual({
      protocolInstanceId: INSTANCE_ID,
      protocolVersionId:  VERSION_ID,
    })

    const [versionInsert] = inserts(calls, 'protocol_template_versions')
    expect(versionInsert).toBeDefined()
    const payload = versionInsert!.payload!
    expect(payload).toMatchObject({
      protocol_id:    PROTOCOL_ID,
      version_number: 1,
      status:         'published',
      published_by:   PROVIDER_ID,
    })
    expect(payload['published_at']).toEqual(expect.any(String))
    expect(payload['intent_snapshot']).toEqual({
      protocol: TEMPLATE_ROW,
      items:    ITEM_ROWS,
    })
    expect(payload['intent_hash']).toBe(
      computeIntentHash({ protocol: TEMPLATE_ROW, items: ITEM_ROWS }),
    )

    const [instanceInsert] = inserts(calls, 'protocol_instances')
    expect(instanceInsert!.payload).toMatchObject({ cycle_number: 1, version_id: VERSION_ID })
  })

  it('reuses the concurrent winner version on a unique-violation publish race', async () => {
    const { client, calls } = makeClient({
      protocol_templates:         [ok(TEMPLATE_ROW)],
      protocol_template_versions: [
        ok(null),                                        // published lookup → none
        ok(null),                                        // max version_number
        { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_ptv_one_published"' } },
        ok({ version_id: VERSION_ID }),                  // race re-select
      ],
      protocol_items:     [ok(ITEM_ROWS)],
      protocol_instances: [ok({ instance_id: INSTANCE_ID })],
    })

    const linkage = await resolveProtocolLinkage(args(client))

    expect(linkage).toEqual({
      protocolInstanceId: INSTANCE_ID,
      protocolVersionId:  VERSION_ID,
    })
    // The failed insert happened, but resolution still succeeded.
    expect(inserts(calls, 'protocol_template_versions')).toHaveLength(1)
  })

  it('returns null (no writes) when the protocol does not exist for the clinic', async () => {
    const { client, calls } = makeClient({
      protocol_templates: [ok(null)],
    })

    const linkage = await resolveProtocolLinkage(args(client))

    expect(linkage).toBeNull()
    expect(inserts(calls)).toHaveLength(0)
  })

  it('returns null instead of throwing when a lookup errors', async () => {
    const { client } = makeClient({
      protocol_templates:         [ok(TEMPLATE_ROW)],
      protocol_template_versions: [
        { data: null, error: { message: 'connection reset' } },
      ],
    })

    await expect(resolveProtocolLinkage(args(client))).resolves.toBeNull()
  })

  it('returns null instead of throwing when the client itself throws', async () => {
    const client = {
      from() {
        throw new Error('boom')
      },
    } as unknown as SupabaseClient<Database>

    await expect(resolveProtocolLinkage(args(client))).resolves.toBeNull()
  })

  it('returns null when the instance insert fails for a non-unique reason', async () => {
    const { client } = makeClient({
      protocol_templates:         [ok(TEMPLATE_ROW)],
      protocol_template_versions: [ok({ version_id: VERSION_ID })],
      protocol_instances: [
        ok(null),
        ok(null),
        { data: null, error: { code: '23503', message: 'foreign key violation' } },
      ],
    })

    await expect(resolveProtocolLinkage(args(client))).resolves.toBeNull()
  })
})

// ── Stable serialization / hashing ───────────────────────────

describe('stableSerialize / computeIntentHash', () => {
  it('is insensitive to object key order, recursively', () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 3 }], c: null } }
    const b = { a: { c: null, d: [1, { x: 3, y: 2 }] }, b: 1 }
    expect(stableSerialize(a)).toBe(stableSerialize(b))
    expect(computeIntentHash(a)).toBe(computeIntentHash(b))
  })

  it('is sensitive to actual content changes', () => {
    expect(computeIntentHash({ a: 1 })).not.toBe(computeIntentHash({ a: 2 }))
  })

  it('produces a sha256 hex digest of the stable serialization', () => {
    const snapshot = { protocol: TEMPLATE_ROW, items: ITEM_ROWS }
    const expected = createHash('sha256')
      .update(stableSerialize(snapshot))
      .digest('hex')
    expect(computeIntentHash(snapshot)).toBe(expected)
    expect(computeIntentHash(snapshot)).toMatch(/^[0-9a-f]{64}$/)
  })
})
