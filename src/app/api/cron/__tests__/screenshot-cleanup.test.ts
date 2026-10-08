/**
 * @jest-environment node
 *
 * Screenshot cleanup (72-hour policy for portal screenshots, which show
 * patient details).
 *
 *   - Supabase Storage list() returns folders with id null (storage-js
 *     FileObject: "null for folders"). The cron skipped every entry with
 *     no id, so it skipped every portal/{orderId} folder and never deleted
 *     a screenshot. Folders are the entries with id null; files have one.
 *   - It read one page of folders (1000) and one page of files per folder
 *     (100). It now pages through both.
 *   - Deleting is a retention action: with RETENTION_ENABLED off (the
 *     default) it reports what it would delete and removes nothing.
 *   - With it on, files older than 72 hours are removed in batches.
 */

import type { NextRequest } from 'next/server'

type Entry = { name: string; id: string | null; created_at: string | null; updated_at: string | null }

const HOUR = 60 * 60 * 1000
const old = new Date(Date.now() - 100 * HOUR).toISOString()
const fresh = new Date(Date.now() - 1 * HOUR).toISOString()
const folder = (name: string): Entry => ({ name, id: null, created_at: null, updated_at: null })
const file = (name: string, at: string): Entry => ({ name, id: `id-${name}`, created_at: at, updated_at: at })

let tree: Record<string, Entry[]> = {}
const listCalls: Array<{ prefix: string; limit: number; offset: number }> = []
const removed: string[][] = []
let listError: { message: string } | null = null

jest.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        list: async (prefix: string, opts: { limit: number; offset: number }) => {
          listCalls.push({ prefix, ...opts })
          if (listError) return { data: null, error: listError }
          const all = tree[prefix] ?? []
          return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null }
        },
        remove: async (paths: string[]) => { removed.push(paths); return { data: [], error: null } },
      }),
    },
  }),
}))

import { GET } from '../screenshot-cleanup/route'

const call = () => GET({ headers: { get: (h: string) => (h.toLowerCase() === 'authorization' ? 'Bearer cron-secret' : null) } } as unknown as NextRequest)

const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
afterAll(() => { infoSpy.mockRestore(); errorSpy.mockRestore() })

beforeEach(() => {
  process.env['CRON_SECRET'] = 'cron-secret'
  delete process.env['RETENTION_ENABLED']
  tree = {}
  listCalls.length = 0
  removed.length = 0
  listError = null
})

it('finds screenshots inside order folders (id null) and, switched off, deletes nothing', async () => {
  tree['portal'] = [folder('order-1'), folder('order-2')]
  tree['portal/order-1'] = [file('sub-a-login.png', old), file('sub-a-confirm.png', fresh)]
  tree['portal/order-2'] = [file('sub-b-login.png', old), file('.emptyFolderPlaceholder', old)]

  const res = await call()
  const body = await res.json() as Record<string, unknown>
  expect(res.status).toBe(200)
  expect(body).toMatchObject({ dry_run: true, would_delete: 2, deleted: 0 })
  expect(removed).toEqual([])
})

it('switched on: removes every screenshot older than 72 hours, never the placeholder or fresh ones', async () => {
  process.env['RETENTION_ENABLED'] = 'true'
  tree['portal'] = [folder('order-1'), folder('order-2')]
  tree['portal/order-1'] = [file('sub-a-login.png', old), file('sub-a-confirm.png', fresh)]
  tree['portal/order-2'] = [file('sub-b-login.png', old), file('.emptyFolderPlaceholder', old)]

  const body = await (await call()).json() as Record<string, unknown>
  expect(body).toMatchObject({ dry_run: false, deleted: 2 })
  expect(removed.flat().sort()).toEqual(['portal/order-1/sub-a-login.png', 'portal/order-2/sub-b-login.png'])
})

it('pages through every folder and every file (1205 folders, 2500 files in one)', async () => {
  process.env['RETENTION_ENABLED'] = 'true'
  tree['portal'] = Array.from({ length: 1205 }, (_, i) => folder(`order-${i}`))
  tree['portal/order-1204'] = Array.from({ length: 2500 }, (_, i) => file(`s-${i}.png`, old))

  const body = await (await call()).json() as Record<string, unknown>
  expect(body).toMatchObject({ deleted: 2500 })
  expect(listCalls.filter(c => c.prefix === 'portal').map(c => c.offset)).toEqual([0, 1000])
  expect(listCalls.filter(c => c.prefix === 'portal/order-1204').length).toBeGreaterThanOrEqual(3)
  // Removed in batches the storage API accepts.
  for (const batch of removed) expect(batch.length).toBeLessThanOrEqual(1000)
})

it('the portal folder list cannot be read: 500, nothing removed', async () => {
  tree['portal'] = [folder('order-1')]
  listError = { message: 'storage down' }
  const res = await call()
  expect(res.status).toBe(500)
  expect(removed).toEqual([])
})
