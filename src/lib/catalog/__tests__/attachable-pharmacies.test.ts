/**
 * @jest-environment node
 *
 * The catalog importer attaches formulations only to pharmacies that are
 * active and not deleted.
 *
 * scripts/import-catalog-v3.ts, run without --pharmacy-id, used to read
 * every row in `pharmacies` — no is_active or deleted_at filter — and
 * attach every formulation to each of them. On prod that included the
 * three E2E test pharmacies (soft-deleted on 2026-04-23), which is how
 * "Test Pharmacy Tier1/2/4" came to be offered for Semaglutide.
 */

import { listAttachablePharmacies } from '../attachable-pharmacies'
import { fakeDb } from '@/lib/orders/__tests__/fake-db'

const LIVE     = { pharmacy_id: 'ph-live',     name: 'Strive',          is_active: true,  deleted_at: null }
const DELETED  = { pharmacy_id: 'ph-deleted',  name: 'Test Pharmacy',   is_active: true,  deleted_at: '2026-04-23T00:00:00Z' }
const INACTIVE = { pharmacy_id: 'ph-inactive', name: 'Paused Pharmacy', is_active: false, deleted_at: null }

describe('listAttachablePharmacies', () => {
  it('an importer run skips a deleted pharmacy (and an inactive one)', async () => {
    const db = fakeDb({ pharmacies: [LIVE, DELETED, INACTIVE] })
    expect(await listAttachablePharmacies(db.client)).toEqual({ ok: true, pharmacyIds: ['ph-live'] })
  })

  it('--pharmacy-id naming a deleted pharmacy is refused, not attached', async () => {
    const db = fakeDb({ pharmacies: [LIVE, DELETED] })
    const res = await listAttachablePharmacies(db.client, 'ph-deleted')
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('ph-deleted') })
  })

  it('--pharmacy-id naming a live pharmacy attaches to it alone', async () => {
    const db = fakeDb({ pharmacies: [LIVE, DELETED] })
    expect(await listAttachablePharmacies(db.client, 'ph-live')).toEqual({ ok: true, pharmacyIds: ['ph-live'] })
  })

  it('a read that failed is an error, not "no pharmacies"', async () => {
    const db = fakeDb({ pharmacies: [LIVE] })
    db.failOn('pharmacies:select')
    expect(await listAttachablePharmacies(db.client)).toMatchObject({ ok: false })
  })
})
