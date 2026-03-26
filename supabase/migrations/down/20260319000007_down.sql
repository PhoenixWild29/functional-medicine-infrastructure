-- DOWN: 20260319000007_wo29_order_assembly.sql
-- Removes provider_signature_hash_snapshot from orders and signature_hash from providers.

ALTER TABLE orders DROP COLUMN IF EXISTS provider_signature_hash_snapshot;
ALTER TABLE providers DROP COLUMN IF EXISTS signature_hash;
