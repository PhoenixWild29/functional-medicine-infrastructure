// ============================================================
// POC Demo-Data Refresh — time-sensitive seed data (PR #5)
// ============================================================
//
// Fills two Ops-tour surfaces that render empty in a fresh POC
// environment and telegraph "non-functional" during investor demos:
//
//   1. /ops/fax            — Inbound Fax Triage queue
//   2. /ops/adapters       — Pharmacy Adapter Health cards
//
// Unlike durable seed objects (users, clinics, catalog) which
// `scripts/seed-poc.ts` inserts once and leaves alone, the data
// in this module is TIME-SENSITIVE:
//
//   - Adapter Health cards classify "green" only when the most
//     recent success was within 15 minutes (see
//     `computeAdapterStatus` in src/lib/ops/adapter-health.ts).
//     A daily seed goes stale within hours.
//
//   - Fax triage rows render `received_at` as relative time
//     ("2h ago"). A week-old seed reads "7 days ago" on the
//     UNMATCHED row — exactly the opposite of the value prop.
//
// So this module is callable from THREE triggers:
//
//   - `scripts/seed-poc.ts`                 — initial seed
//   - `/api/admin/refresh-demo-data` (POST) — ops-admin button
//     on /ops/demo-tools ("Refresh Demo Data")
//   - `/api/cron/poc-credential-sync` (GET) — daily safety net
//     (via `syncPocCredentials()` in sync-credentials.ts)
//
// Each invocation is idempotent: delete-then-insert with strict
// guards so it cannot touch non-seeded rows.
//
// ── Guardrails (cowork review PR #5) ─────────────────────────
//
//   1. POC_MODE === 'true' required — refuses to run in prod env
//   2. submission_id / documo_fax_id must start with 'poc-seed-'
//   3. pharmacy_id must be one of the 5 seed UUIDs
//   4. Pre-delete row count capped at SEED_ROW_CAP (500) — if
//      the delete would affect more than 500 rows something is
//      badly wrong and the safer action is to abort
//   5. Pre-/post-delete counts + inserted count logged in the
//      DemoDataRefreshReport so an operator reading the cron
//      output can spot drift immediately
//
// ── Demo scaffolding (cowork Q6 — option 1) ──────────────────
// The seeded order lives on a dedicated "Ops Demo Data" clinic
// (not the demo-visible Sunrise clinic), so it never surfaces
// in the operator's /dashboard order list. The demo clinic also
// holds a demo patient + provider to satisfy the NOT NULL FKs on
// the orders table. This keeps the operator-facing clinic pristine.

import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// CONSTANTS — deterministic UUIDs + enum values
// ============================================================

// "Ops Demo Data" clinic — holds seeded order + patient + provider.
// Separated from the Sunrise POC clinic so seeded rows don't
// appear in the clinic-dashboard order list during demos.
export const DEMO_CLINIC_ID   = 'a1000000-0000-0000-0000-000000000002'
export const DEMO_PATIENT_ID  = 'a3000000-0000-0000-0000-000000000002'
export const DEMO_PROVIDER_ID = 'a2000000-0000-0000-0000-000000000002'
export const DEMO_ORDER_ID    = 'a6000000-0000-0000-0000-00000000000d'

// Catalog item used as the demo-order FK target. Any existing
// Strive catalog item works — catalog is pharmacy-scoped, not
// clinic-scoped, so re-using a Sunrise-seeded item is safe.
// Matches IDs.catalog.semaglutide in scripts/seed-poc.ts.
export const DEMO_CATALOG_ITEM_ID = 'a5000000-0000-0000-0000-000000000001'

// 5 POC pharmacies. Strive is the existing TIER_4_FAX pharmacy
// seeded by scripts/seed-poc.ts. The other 4 are new (seeded
// alongside Strive) and give the Adapter Health grid cross-tier
// coverage for investor demos (cowork PR #5 Q3 — push to 5 so
// within-tier comparison between the two T1 pharmacies is a
// visible demo beat).
export interface SeedPharmacy {
  id:    string
  name:  string
  slug:  string
  tier:  'TIER_1_API' | 'TIER_2_PORTAL' | 'TIER_3_HYBRID' | 'TIER_4_FAX'
  // Target adapter health status after refresh — determines
  // success-rate + recency shape. All five pharmacies target
  // either 'green' or 'yellow' — no red at rest, per cowork Q4.
  target: 'green' | 'yellow'
}

export const DEMO_PHARMACIES: ReadonlyArray<SeedPharmacy> = [
  { id: 'a4000000-0000-0000-0000-000000000001', name: 'Strive Pharmacy',     slug: 'strive',          tier: 'TIER_4_FAX',    target: 'green'  },
  { id: 'a4000000-0000-0000-0000-000000000002', name: 'Quick Rx Pharmacy',    slug: 'quick-rx',        tier: 'TIER_1_API',    target: 'green'  },
  { id: 'a4000000-0000-0000-0000-000000000003', name: 'Express Digital Rx',   slug: 'express-digital', tier: 'TIER_1_API',    target: 'yellow' },
  { id: 'a4000000-0000-0000-0000-000000000004', name: 'Portal Plus Pharmacy', slug: 'portal-plus',     tier: 'TIER_2_PORTAL', target: 'green'  },
  { id: 'a4000000-0000-0000-0000-000000000005', name: 'Hybrid Labs Pharmacy', slug: 'hybrid-labs',     tier: 'TIER_3_HYBRID', target: 'green'  },
] as const

const DEMO_PHARMACY_ID_SET = new Set(DEMO_PHARMACIES.map(p => p.id))

// Delete-guard sanity cap. If a delete would affect >500 rows
// something has gone very wrong (e.g., the submission_id prefix
// has collided with real prod data). Aborting is the safer move.
export const SEED_ROW_CAP = 500

// ============================================================
// REPORT SHAPE — returned to API route + cron caller
// ============================================================

export interface DemoDataRefreshReport {
  ran_at: string
  ok:     boolean
  // Set when the entire refresh short-circuits (POC_MODE off or
  // global abort). Individual sub-operations also have `error`.
  skipped?: 'not_poc_mode'
  scaffolding: {
    action: 'already_exists' | 'created' | 'error'
    error?: string
  }
  fax_seed: RefreshOpResult
  submission_seed: RefreshOpResult
}

export interface RefreshOpResult {
  pre_delete:  number
  post_delete: number
  inserted:    number
  error?:      string
  // Set when the op aborts before the delete (e.g., row cap
  // exceeded). The `action: 'aborted'` value carries signal even
  // when counts are zero.
  action:      'refreshed' | 'aborted' | 'skipped'
}

// ============================================================
// TOP-LEVEL ENTRY
// ============================================================

export async function refreshDemoData(supabase: SupabaseClient): Promise<DemoDataRefreshReport> {
  const ranAt = new Date().toISOString()

  // Defense-in-depth: never run against a non-POC environment.
  // The button route already does a session check, but the cron
  // path is gated by CRON_SECRET only — if CRON_SECRET ever leaks
  // to a non-POC deployment, this is the backstop.
  if (process.env['POC_MODE'] !== 'true') {
    return {
      ran_at:       ranAt,
      ok:           true,
      skipped:      'not_poc_mode',
      scaffolding:  { action: 'already_exists' },
      fax_seed:     { pre_delete: 0, post_delete: 0, inserted: 0, action: 'skipped' },
      submission_seed: { pre_delete: 0, post_delete: 0, inserted: 0, action: 'skipped' },
    }
  }

  const scaffolding = await ensureDemoScaffolding(supabase)
  const faxSeed     = await refreshFaxSeed(supabase)
  const submissionSeed = await refreshAdapterSubmissionsSeed(supabase)

  const ok = !scaffolding.error
    && !faxSeed.error
    && !submissionSeed.error
    && scaffolding.action !== 'error'

  return {
    ran_at:      ranAt,
    ok,
    scaffolding,
    fax_seed:    faxSeed,
    submission_seed: submissionSeed,
  }
}

// ============================================================
// SCAFFOLDING — demo clinic + patient + provider + order
// ============================================================
//
// Idempotent: insert only if absent. These rows are durable —
// the refresh path only re-inserts fax + submission rows, never
// touches these FK targets.

export async function ensureDemoScaffolding(
  supabase: SupabaseClient,
): Promise<DemoDataRefreshReport['scaffolding']> {
  try {
    // ── Clinic ───────────────────────────────────────────────
    const { data: clinic } = await supabase
      .from('clinics')
      .select('clinic_id')
      .eq('clinic_id', DEMO_CLINIC_ID)
      .maybeSingle()

    if (!clinic) {
      const { error } = await supabase.from('clinics').insert({
        clinic_id:                 DEMO_CLINIC_ID,
        name:                      'Ops Demo Data (hidden)',
        stripe_connect_account_id: 'acct_poc_demo_data_hidden',
        stripe_connect_status:     'ACTIVE',
        is_active:                 false,     // inactive = never surfaces as a usable clinic
        default_markup_pct:        40,
        order_intake_blocked:      true,       // intake blocked as extra guardrail
      })
      if (error) return { action: 'error', error: `clinic insert: ${error.message}` }
    }

    // ── Patient ──────────────────────────────────────────────
    const { data: patient } = await supabase
      .from('patients')
      .select('patient_id')
      .eq('patient_id', DEMO_PATIENT_ID)
      .maybeSingle()

    if (!patient) {
      const { error } = await supabase.from('patients').insert({
        patient_id:    DEMO_PATIENT_ID,
        clinic_id:     DEMO_CLINIC_ID,
        first_name:    'Demo',
        last_name:     'FixtureSubject',
        date_of_birth: '1990-01-01',
        phone:         '+15005550006',  // reserved test number
        email:         'demo-fixture@compoundiq-poc.invalid',
        state:         'TX',
        sms_opt_in:    false,
        is_active:     false,
      })
      if (error) return { action: 'error', error: `patient insert: ${error.message}` }
    }

    // ── Provider ─────────────────────────────────────────────
    const { data: provider } = await supabase
      .from('providers')
      .select('provider_id')
      .eq('provider_id', DEMO_PROVIDER_ID)
      .maybeSingle()

    if (!provider) {
      const { error } = await supabase.from('providers').insert({
        provider_id:       DEMO_PROVIDER_ID,
        clinic_id:         DEMO_CLINIC_ID,
        first_name:        'Demo',
        last_name:         'Fixture',
        npi_number:        '0000000002',
        license_state:     'TX',
        license_number:    'TX-MD-FIXTURE',
        signature_on_file: false,
        is_active:         false,
      })
      if (error) return { action: 'error', error: `provider insert: ${error.message}` }
    }

    // ── Order ────────────────────────────────────────────────
    // FK target for every seeded fax MATCHED row + adapter
    // submission. Status PHARMACY_ACKNOWLEDGED = "in flight, not
    // at a terminal state" — won't be picked up by any
    // post-payment cron automation.
    const { data: order } = await supabase
      .from('orders')
      .select('order_id')
      .eq('order_id', DEMO_ORDER_ID)
      .maybeSingle()

    if (!order) {
      const { error } = await supabase.from('orders').insert({
        order_id:        DEMO_ORDER_ID,
        patient_id:      DEMO_PATIENT_ID,
        provider_id:     DEMO_PROVIDER_ID,
        catalog_item_id: DEMO_CATALOG_ITEM_ID,
        clinic_id:       DEMO_CLINIC_ID,
        status:          'PHARMACY_ACKNOWLEDGED',
        quantity:        1,
        is_active:       false,
      })
      if (error) return { action: 'error', error: `order insert: ${error.message}` }
    }

    const anyCreated = !clinic || !patient || !provider || !order
    return { action: anyCreated ? 'created' : 'already_exists' }
  } catch (err) {
    return { action: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

// ============================================================
// FAX SEED — 4 rows (one per active fax_queue_status_enum value)
// ============================================================
//
// Seeds: RECEIVED, MATCHED, UNMATCHED, PROCESSING.
// Skips ERROR (red in demo = bad optics, per cowork Q4) and
// PROCESSED/ARCHIVED (those filter tabs exist in the UI but not
// in the DB enum — pre-existing mismatch, out of PR #5 scope).

interface SeedFaxRow {
  documo_fax_id:       string
  from_number:         string
  page_count:          number
  storage_path:        string
  status:              'RECEIVED' | 'MATCHED' | 'UNMATCHED' | 'PROCESSING'
  matched_pharmacy_id: string | null
  matched_order_id:    string | null
  // received_at offset from now (in minutes) — small values so
  // rows read "minutes ago" not "days ago" after the refresh.
  received_offset_min: number
}

const SEED_FAX_ROWS: ReadonlyArray<SeedFaxRow> = [
  {
    documo_fax_id:       'poc-seed-fax-001',
    from_number:         '+15125550101',
    page_count:          2,
    storage_path:        'poc-seed/fax-001.pdf',
    status:              'RECEIVED',
    matched_pharmacy_id: null,
    matched_order_id:    null,
    received_offset_min: 3,
  },
  {
    documo_fax_id:       'poc-seed-fax-002',
    from_number:         '+15125550102',
    page_count:          3,
    storage_path:        'poc-seed/fax-002.pdf',
    status:              'MATCHED',
    matched_pharmacy_id: 'a4000000-0000-0000-0000-000000000001',  // Strive
    matched_order_id:    DEMO_ORDER_ID,
    received_offset_min: 18,
  },
  {
    documo_fax_id:       'poc-seed-fax-003',
    from_number:         '+15125550103',
    page_count:          4,
    storage_path:        'poc-seed/fax-003.pdf',
    status:              'UNMATCHED',
    matched_pharmacy_id: null,
    matched_order_id:    null,
    received_offset_min: 42,
  },
  {
    documo_fax_id:       'poc-seed-fax-004',
    from_number:         '+15125550104',
    page_count:          2,
    storage_path:        'poc-seed/fax-004.pdf',
    status:              'PROCESSING',
    matched_pharmacy_id: 'a4000000-0000-0000-0000-000000000001',  // Strive
    matched_order_id:    DEMO_ORDER_ID,
    received_offset_min: 75,
  },
] as const

export async function refreshFaxSeed(supabase: SupabaseClient): Promise<RefreshOpResult> {
  try {
    // ── Pre-delete count ─────────────────────────────────────
    const { count: preCount, error: countError } = await supabase
      .from('inbound_fax_queue')
      .select('fax_id', { count: 'exact', head: true })
      .like('documo_fax_id', 'poc-seed-%')

    if (countError) {
      return { pre_delete: 0, post_delete: 0, inserted: 0, action: 'aborted', error: `count: ${countError.message}` }
    }

    const preDelete = preCount ?? 0

    // ── Row-count sanity cap ─────────────────────────────────
    if (preDelete > SEED_ROW_CAP) {
      return {
        pre_delete:  preDelete,
        post_delete: preDelete,
        inserted:    0,
        action:      'aborted',
        error:       `row cap exceeded: ${preDelete} > ${SEED_ROW_CAP}`,
      }
    }

    // ── Delete (guarded by LIKE 'poc-seed-%') ────────────────
    if (preDelete > 0) {
      const { error: deleteError } = await supabase
        .from('inbound_fax_queue')
        .delete()
        .like('documo_fax_id', 'poc-seed-%')

      if (deleteError) {
        return { pre_delete: preDelete, post_delete: preDelete, inserted: 0, action: 'aborted', error: `delete: ${deleteError.message}` }
      }
    }

    // ── Insert fresh rows ────────────────────────────────────
    const now = Date.now()
    const rows = SEED_FAX_ROWS.map(r => ({
      documo_fax_id:       r.documo_fax_id,
      from_number:         r.from_number,
      page_count:          r.page_count,
      storage_path:        r.storage_path,
      status:              r.status,
      matched_pharmacy_id: r.matched_pharmacy_id,
      matched_order_id:    r.matched_order_id,
      created_at:          new Date(now - r.received_offset_min * 60_000).toISOString(),
      updated_at:          new Date(now - r.received_offset_min * 60_000).toISOString(),
      is_active:           true,
    }))

    const { error: insertError } = await supabase.from('inbound_fax_queue').insert(rows)
    if (insertError) {
      return { pre_delete: preDelete, post_delete: 0, inserted: 0, action: 'aborted', error: `insert: ${insertError.message}` }
    }

    return { pre_delete: preDelete, post_delete: 0, inserted: rows.length, action: 'refreshed' }
  } catch (err) {
    return { pre_delete: 0, post_delete: 0, inserted: 0, action: 'aborted', error: err instanceof Error ? err.message : String(err) }
  }
}

// ============================================================
// ADAPTER SUBMISSIONS SEED — 200 rows, 4 green + 1 yellow
// ============================================================
//
// Each pharmacy gets 40 rows over a 24h window. Success ratio
// targets the Adapter Health status thresholds:
//
//   green:  40 CONFIRMED / 0 FAILED = 100% success  (≥95%)
//   yellow: 34 CONFIRMED / 6 FAILED = 85%  success  (80-95%)
//
// Recency: every pharmacy gets at least one submission within
// the 15-minute green-freshness window. Yellow pharmacy gets
// its freshest at now - 25 min (pushes into yellow's 15-60 min
// band instead of green). See computeAdapterStatus in
// src/lib/ops/adapter-health.ts for the thresholds.

const SUBMISSIONS_PER_PHARMACY = 40
const YELLOW_FAILED_COUNT      = 6    // 6/40 = 15% failure → 85% success (yellow band)

export async function refreshAdapterSubmissionsSeed(supabase: SupabaseClient): Promise<RefreshOpResult> {
  try {
    // ── Pre-delete count ─────────────────────────────────────
    const { count: preCount, error: countError } = await supabase
      .from('adapter_submissions')
      .select('submission_id', { count: 'exact', head: true })
      .like('submission_id', 'poc-seed-%')
      .in('pharmacy_id', [...DEMO_PHARMACY_ID_SET])

    if (countError) {
      return { pre_delete: 0, post_delete: 0, inserted: 0, action: 'aborted', error: `count: ${countError.message}` }
    }

    const preDelete = preCount ?? 0

    if (preDelete > SEED_ROW_CAP) {
      return {
        pre_delete:  preDelete,
        post_delete: preDelete,
        inserted:    0,
        action:      'aborted',
        error:       `row cap exceeded: ${preDelete} > ${SEED_ROW_CAP}`,
      }
    }

    // ── Delete (guarded by prefix + pharmacy_id allowlist) ───
    if (preDelete > 0) {
      const { error: deleteError } = await supabase
        .from('adapter_submissions')
        .delete()
        .like('submission_id', 'poc-seed-%')
        .in('pharmacy_id', [...DEMO_PHARMACY_ID_SET])

      if (deleteError) {
        return { pre_delete: preDelete, post_delete: preDelete, inserted: 0, action: 'aborted', error: `delete: ${deleteError.message}` }
      }
    }

    // ── Build fresh batch ────────────────────────────────────
    const rows = buildSubmissionBatch()

    // Sanity: never let this helper produce more than the cap in
    // a single batch. Cheap extra belt.
    if (rows.length > SEED_ROW_CAP) {
      return {
        pre_delete:  preDelete,
        post_delete: 0,
        inserted:    0,
        action:      'aborted',
        error:       `batch would exceed row cap: ${rows.length} > ${SEED_ROW_CAP}`,
      }
    }

    const { error: insertError } = await supabase.from('adapter_submissions').insert(rows)
    if (insertError) {
      return { pre_delete: preDelete, post_delete: 0, inserted: 0, action: 'aborted', error: `insert: ${insertError.message}` }
    }

    return { pre_delete: preDelete, post_delete: 0, inserted: rows.length, action: 'refreshed' }
  } catch (err) {
    return { pre_delete: 0, post_delete: 0, inserted: 0, action: 'aborted', error: err instanceof Error ? err.message : String(err) }
  }
}

// Exported for unit tests. Builds the 200-row batch without
// touching the DB so the ratio, recency, and ID scheme can be
// asserted in isolation.
//
// Row layout (idx=0 freshest, idx=39 oldest):
//   - Successes occupy idx 0 .. (40 - failed - 1)
//   - Failures  occupy idx (40 - failed) .. 39
//
// This order matters for the Adapter Health calculation: the
// page.tsx server component orders by created_at ASC, then takes
// `.at(-1)` of the CONFIRMED/SUBMITTED/ACKNOWLEDGED rows as
// "lastSuccess." If a yellow pharmacy's most-recent row is a
// FAILURE (not a success), lastSuccess falls further back in
// time and the card flips to red. Putting failures at the OLDEST
// indices keeps idx=0 (the freshness anchor) a success for every
// pharmacy, which is what the classifier needs.
export function buildSubmissionBatch(now: Date = new Date()): SubmissionInsert[] {
  const yyyymmdd = formatYmd(now)
  const rows: SubmissionInsert[] = []

  for (const pharmacy of DEMO_PHARMACIES) {
    const failed    = pharmacy.target === 'yellow' ? YELLOW_FAILED_COUNT : 0
    const succeeded = SUBMISSIONS_PER_PHARMACY - failed

    // Freshness anchor (idx 0): green pharmacies at now - 2 min
    // to clear the 15-minute window; yellow at now - 25 min to
    // land in the 15-60 min band.
    const freshnessOffsetMs = pharmacy.target === 'green'
      ? 2 * 60_000
      : 25 * 60_000

    for (let idx = 0; idx < SUBMISSIONS_PER_PHARMACY; idx++) {
      // Failures go at the OLDEST end (highest idx) so the freshness
      // anchor is always a success.
      const isFailure = idx >= succeeded

      // idx=0 → freshnessOffsetMs; subsequent indices spread
      // uniformly out to a 23h horizon so everything is inside the
      // 24h rolling window.
      const offsetMs = idx === 0
        ? freshnessOffsetMs
        : Math.round(freshnessOffsetMs + (idx / (SUBMISSIONS_PER_PHARMACY - 1)) * (23 * 3_600_000 - freshnessOffsetMs))

      const createdAt      = new Date(now.getTime() - offsetMs)
      const submittedAt    = new Date(createdAt.getTime() + 1_000)
      const completedAt    = new Date(createdAt.getTime() + 5_000)
      const acknowledgedAt = isFailure ? null : new Date(createdAt.getTime() + 4_500)

      rows.push({
        submission_id:   `poc-seed-${pharmacy.slug}-${String(idx).padStart(3, '0')}-${yyyymmdd}`,
        order_id:        DEMO_ORDER_ID,
        pharmacy_id:     pharmacy.id,
        tier:            pharmacy.tier,
        status:          isFailure ? 'FAILED' : 'CONFIRMED',
        attempt_number:  1,
        created_at:      createdAt.toISOString(),
        submitted_at:    submittedAt.toISOString(),
        completed_at:    completedAt.toISOString(),
        acknowledged_at: acknowledgedAt?.toISOString() ?? null,
        error_code:      isFailure ? 'POC_SEED_FAILURE' : null,
        error_message:   isFailure ? 'Seeded failure row for demo (yellow card)' : null,
      })
    }
  }

  return rows
}

export interface SubmissionInsert {
  submission_id:      string
  order_id:           string
  pharmacy_id:        string
  tier:               SeedPharmacy['tier']
  status:             'CONFIRMED' | 'FAILED'
  attempt_number:     number
  created_at:         string
  submitted_at:       string
  completed_at:       string
  acknowledged_at:    string | null
  error_code:         string | null
  error_message:      string | null
}

function formatYmd(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd   = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}${mm}${dd}`
}
