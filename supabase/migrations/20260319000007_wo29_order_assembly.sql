-- ============================================================
-- Order Assembly & Provider Signature — WO-29
-- ============================================================
--
-- REQ-OAS-002: Snapshot locking — adds provider_signature_hash_snapshot
--   to orders so the signed hash is frozen at DRAFT → AWAITING_PAYMENT.
--
-- REQ-OAS-003: Provider digital signature capture — adds signature_hash
--   to providers so the last-known hash is queryable for compliance audit.
--
-- NB-01: The prevent_snapshot_mutation trigger (from a prior migration) must
--   include `provider_signature_hash_snapshot` in its frozen-column list.
--   Verify the trigger definition and add it if absent. The trigger is not
--   modified here because it resides in a prior migration file — if it does
--   not cover this column a follow-up migration is required.

BEGIN;

-- 1. Provider signature hash storage (REQ-OAS-003)
--    Stores the SHA-256 hash of the provider's signature canvas + timestamp.
--    Updated each time the provider signs a new order.
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS signature_hash TEXT;

COMMENT ON COLUMN providers.signature_hash IS
  'REQ-OAS-003: SHA-256 hash of provider signature canvas data + timestamp. '
  'Updated on each sign event. Used as proof-of-signature in compliance audit.';

-- 2. Provider signature snapshot on orders (REQ-OAS-002)
--    Frozen at DRAFT → AWAITING_PAYMENT by the prevent_snapshot_mutation trigger.
--    Contains the SHA-256 hash that was active at the moment of signing.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS provider_signature_hash_snapshot TEXT;

COMMENT ON COLUMN orders.provider_signature_hash_snapshot IS
  'REQ-OAS-003: SHA-256 hash of the provider signature captured for this order. '
  'Frozen at DRAFT → AWAITING_PAYMENT by the prevent_snapshot_mutation trigger.';

COMMIT;
