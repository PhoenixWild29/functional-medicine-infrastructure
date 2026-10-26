// ============================================================
// The signed-order freeze: which order columns never change after signing
// ============================================================
//
// HIPAA B5. Once orders.locked_at is set (batch-sign), the database
// trigger prevent_snapshot_mutation (latest:
// supabase/migrations/20261024000010_signed_order_freeze.sql) refuses any
// change to these columns. This module is the list the migration is held
// to: src/lib/orders/__tests__/signed-order-freeze.test.ts parses the
// migration and fails if the two differ.
//
// The clinical columns are exactly the ones the signature binding covers
// (SIGNED_CONTENT_COLUMNS, lib/orders/signature-binding), so the freeze and
// the content hash cannot drift apart.
//
// What stays updatable after signing: status (through casTransition),
// tracking_number and carrier, the payment and transfer ids,
// payment_group_id, documo_fax_id and fax_attempt_count, ops_assignee,
// adapter_submission_id, submission_tier, estimated_completion_at, notes,
// protocol_instance_id / protocol_version_id (linked after a patient's
// choice), proposal tagging, reroute_count, is_active / deleted_at (a
// signed order cannot be deleted: orders_no_delete_signed) and updated_at.

import { SIGNED_CONTENT_COLUMNS } from './signature-binding'

/** The signature record itself. */
const SIGNATURE_RECORD_COLUMNS = ['provider_signature_hash_snapshot', 'locked_at'] as const

/** Prices and where it ships, as signed and paid for. */
const COMMERCIAL_SNAPSHOT_COLUMNS = [
  'wholesale_price_snapshot',
  'retail_price_snapshot',
  'shipping_fee',
  'shipping_state_snapshot',
  'shipping_address_line1_snapshot',
  'shipping_address_line2_snapshot',
  'shipping_city_snapshot',
  'shipping_zip_snapshot',
  'shipping_address_snapshot_at',
] as const

/** Who prescribed what: the identity the snapshots were taken from. */
const IDENTITY_COLUMNS = ['provider_id', 'formulation_id', 'catalog_item_id'] as const

/** Frozen outright once locked_at is set. */
export const FROZEN_ORDER_COLUMNS: readonly string[] = [
  ...SIGNED_CONTENT_COLUMNS,
  ...SIGNATURE_RECORD_COLUMNS,
  ...COMMERCIAL_SNAPSHOT_COLUMNS,
  ...IDENTITY_COLUMNS,
]

/**
 * Frozen too, except in the one transition that legitimately changes it:
 * the ops reroute (api/ops/orders/[orderId]/action, 'reroute'), one CAS
 * update from SUBMISSION_FAILED / FAX_FAILED / PHARMACY_REJECTED to
 * REROUTE_PENDING that adds 1 to reroute_count. The signed pharmacy stays
 * in pharmacy_snapshot (frozen, and bound by the signature).
 */
export const REROUTE_MUTABLE_COLUMNS: readonly string[] = ['pharmacy_id']
export const REROUTE_FROM_STATUSES: readonly string[] = ['SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED']

/** The trigger's message, so a refusal is recognisable in logs and tests. */
export const SIGNED_ORDER_FROZEN_MESSAGE = 'Cannot modify signed clinical or snapshot fields after order is locked'
