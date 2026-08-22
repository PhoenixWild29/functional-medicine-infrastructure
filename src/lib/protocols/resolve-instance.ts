// ============================================================
// GAP-3 writer — resolve protocol → (instance, version) linkage
// ============================================================
//
// When an order is created from a protocol quick-load, the order row
// must carry protocol_instance_id + protocol_version_id so the pilot
// validation gates (v_protocol_reuse, v_protocol_clarification_rate,
// v_protocol_retention_90d — migration 20260816000001) have data to
// read. Without this writer the columns stay NULL forever and the
// linkage can never be backfilled.
//
// Resolution strategy:
//   a. Find the protocol's 'published' template version. If none
//      exists yet, auto-publish one from the current template state.
//      First-use auto-publish is the INTENDED bootstrap: there is no
//      explicit "publish" UI yet, so the first order written from a
//      protocol freezes the current template + items as version 1
//      (intent_snapshot + sha256 intent_hash of a stable
//      serialization).
//   b. Find the patient's 'active' protocol_instance; if none, start
//      a new cycle (cycle_number = 1 + max existing cycle for that
//      patient+protocol, per uq_patient_protocol_cycle).
//   c. Return both IDs for the order INSERT. protocol_version_id is
//      the CURRENT published version — the version the order was
//      compiled from — which is intentionally independent of the
//      instance's pinned version (see migration comments).
//
// FAILURE POSTURE: linkage is instrumentation. This module never
// throws — any failure logs a warning and returns null, and the
// caller creates the order without linkage. Prescribing must never
// be blocked by metrics plumbing.
//
// RLS: callers pass the service-role client (bypasses RLS). Inputs
// must already be clinic-validated by the calling route; this module
// re-checks that the protocol belongs to the given clinic before
// writing anything. The composite FK on orders
// (protocol_instance_id, patient_id) → protocol_instances
// (instance_id, patient_id) requires the instance to belong to the
// order's patient — guaranteed here by construction, since the
// instance is always looked up/created for the same patientId the
// order is inserted with.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database.types'

type ServiceClient = SupabaseClient<Database>

export interface ResolveProtocolLinkageArgs {
  /** Service-role client — see RLS note above. */
  supabase:   ServiceClient
  /** Protocol the session item was quick-loaded from. */
  protocolId: string
  /** Patient the order is being written for (composite-FK bound). */
  patientId:  string
  /** Ordering provider — recorded as published_by on a bootstrap
   *  publish and provider_id on a new instance. */
  providerId: string
  /** Clinic of the order; the protocol must belong to it. */
  clinicId:   string
}

export interface ProtocolLinkage {
  protocolInstanceId: string
  protocolVersionId:  string
}

/** Postgres unique_violation — concurrent-writer races on the partial
 *  unique index idx_ptv_one_published / uq_patient_protocol_cycle. */
const UNIQUE_VIOLATION = '23505'

// ── Stable serialization + hashing ───────────────────────────

/**
 * Deterministic JSON serialization: object keys sorted recursively so
 * the same logical snapshot always hashes identically regardless of
 * property insertion order (e.g. across PostgREST responses).
 */
export function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableSerialize).join(',') + ']'
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return (
    '{' +
    keys
      .filter(k => record[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + stableSerialize(record[k]))
      .join(',') +
    '}'
  )
}

/** sha256 hex digest of the stable serialization of a snapshot. */
export function computeIntentHash(snapshot: unknown): string {
  return createHash('sha256').update(stableSerialize(snapshot)).digest('hex')
}

// ── Published version resolution (step a) ────────────────────

async function resolvePublishedVersion(
  supabase: ServiceClient,
  protocolId: string,
  providerId: string,
  template: Record<string, unknown>,
): Promise<string | null> {
  const { data: published, error: publishedError } = await supabase
    .from('protocol_template_versions')
    .select('version_id')
    .eq('protocol_id', protocolId)
    .eq('status', 'published')
    .maybeSingle()

  if (publishedError) {
    console.warn('[protocols] GAP-3: published-version lookup failed (non-fatal):', publishedError.message)
    return null
  }
  if (published) return published.version_id

  // ── First-use auto-publish bootstrap ──
  // No published version exists yet. Freeze the current template +
  // items as an immutable published snapshot. This is the intended
  // bootstrap path until a real publish workflow exists.
  const { data: items, error: itemsError } = await supabase
    .from('protocol_items')
    .select('*')
    .eq('protocol_id', protocolId)
    .order('sort_order')

  if (itemsError) {
    console.warn('[protocols] GAP-3: protocol_items fetch failed (non-fatal):', itemsError.message)
    return null
  }

  const intentSnapshot = { protocol: template, items: items ?? [] }
  const intentHash = computeIntentHash(intentSnapshot)

  // Drafts may exist below the published slot; respect
  // UNIQUE(protocol_id, version_number) by always going one past the
  // current max rather than assuming 1.
  const { data: maxRow, error: maxError } = await supabase
    .from('protocol_template_versions')
    .select('version_number')
    .eq('protocol_id', protocolId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (maxError) {
    console.warn('[protocols] GAP-3: version-number lookup failed (non-fatal):', maxError.message)
    return null
  }

  const versionNumber = (maxRow?.version_number ?? 0) + 1

  const { data: inserted, error: insertError } = await supabase
    .from('protocol_template_versions')
    .insert({
      protocol_id:     protocolId,
      version_number:  versionNumber,
      status:          'published',
      published_at:    new Date().toISOString(),
      published_by:    providerId || null,
      change_note:     'Auto-published on first order use (GAP-3 bootstrap)',
      intent_snapshot: intentSnapshot as unknown as Json,
      intent_hash:     intentHash,
    })
    .select('version_id')
    .single()

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      // A concurrent order creation won the publish race
      // (idx_ptv_one_published allows at most one published row per
      // protocol). Use the winner's version.
      const { data: raced } = await supabase
        .from('protocol_template_versions')
        .select('version_id')
        .eq('protocol_id', protocolId)
        .eq('status', 'published')
        .maybeSingle()
      if (raced) return raced.version_id
    }
    console.warn('[protocols] GAP-3: bootstrap publish failed (non-fatal):', insertError.message)
    return null
  }

  return inserted?.version_id ?? null
}

// ── Active instance resolution (step b) ──────────────────────

async function resolveActiveInstance(
  supabase: ServiceClient,
  args: { protocolId: string; patientId: string; providerId: string; clinicId: string; versionId: string },
): Promise<string | null> {
  const { protocolId, patientId, providerId, clinicId, versionId } = args

  const { data: active, error: activeError } = await supabase
    .from('protocol_instances')
    .select('instance_id')
    .eq('patient_id', patientId)
    .eq('protocol_id', protocolId)
    .eq('status', 'active')
    .order('cycle_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (activeError) {
    console.warn('[protocols] GAP-3: active-instance lookup failed (non-fatal):', activeError.message)
    return null
  }
  if (active) return active.instance_id

  // No active instance — start a new cycle. cycle_number must clear
  // uq_patient_protocol_cycle across ALL statuses, not just active
  // ones, so the max is taken over every prior cycle.
  const { data: maxCycle, error: cycleError } = await supabase
    .from('protocol_instances')
    .select('cycle_number')
    .eq('patient_id', patientId)
    .eq('protocol_id', protocolId)
    .order('cycle_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (cycleError) {
    console.warn('[protocols] GAP-3: cycle-number lookup failed (non-fatal):', cycleError.message)
    return null
  }

  const cycleNumber = (maxCycle?.cycle_number ?? 0) + 1

  const { data: inserted, error: insertError } = await supabase
    .from('protocol_instances')
    .insert({
      patient_id:   patientId,
      provider_id:  providerId,
      clinic_id:    clinicId,
      protocol_id:  protocolId,
      version_id:   versionId,
      cycle_number: cycleNumber,
      status:       'active',
    })
    .select('instance_id')
    .single()

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      // Concurrent order creation won the new-cycle race — reuse the
      // instance the winner created.
      const { data: raced } = await supabase
        .from('protocol_instances')
        .select('instance_id')
        .eq('patient_id', patientId)
        .eq('protocol_id', protocolId)
        .eq('status', 'active')
        .order('cycle_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (raced) return raced.instance_id
    }
    console.warn('[protocols] GAP-3: instance insert failed (non-fatal):', insertError.message)
    return null
  }

  return inserted?.instance_id ?? null
}

// ── Entry point ──────────────────────────────────────────────

/**
 * Resolve (or bootstrap) the protocol_instance + published version an
 * order created from `protocolId` should link to.
 *
 * NEVER throws. Returns null on any failure — the caller must then
 * create the order WITHOUT linkage rather than failing the request.
 */
export async function resolveProtocolLinkage(
  args: ResolveProtocolLinkageArgs,
): Promise<ProtocolLinkage | null> {
  const { supabase, protocolId, patientId, providerId, clinicId } = args
  try {
    // The protocol must exist and belong to the caller's clinic — the
    // protocolId arrives from client sessionStorage, so a stale or
    // cross-clinic ID must degrade to "no linkage", never a write.
    const { data: template, error: templateError } = await supabase
      .from('protocol_templates')
      .select('*')
      .eq('protocol_id', protocolId)
      .eq('clinic_id', clinicId)
      .maybeSingle()

    if (templateError || !template) {
      console.warn(
        '[protocols] GAP-3: protocol not found for clinic (non-fatal) | protocol=' + protocolId,
        templateError?.message ?? '',
      )
      return null
    }

    const versionId = await resolvePublishedVersion(supabase, protocolId, providerId, template)
    if (!versionId) return null

    const instanceId = await resolveActiveInstance(supabase, {
      protocolId, patientId, providerId, clinicId, versionId,
    })
    if (!instanceId) return null

    return { protocolInstanceId: instanceId, protocolVersionId: versionId }
  } catch (err) {
    console.warn(
      '[protocols] GAP-3: linkage resolution threw (non-fatal):',
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}
