-- ============================================================
-- Signing snapshots: who the prescription is for and from (HIPAA B7)
-- ============================================================
--
-- B's review of order-transmission-integrity (T2, 2026-10-26): the
-- pharmacy received the patient's name and date of birth and the
-- prescriber's name, DEA and license state read live at send time, so
-- they were not covered by the signature and could change after signing.
-- Signing (src/lib/orders/batch-sign.ts) now snapshots them onto each
-- order, while it is still DRAFT, and binds them with the rest of the
-- content (src/lib/orders/signature-binding.ts, v3). The adapters send
-- the snapshots, not the live rows.
--
--   patient_snapshot     { first_name, last_name, date_of_birth,
--                          allergy_status } (allergy_status: what the
--                          prescriber saw; a later change refuses the
--                          send with allergies_changed)
--   prescriber_snapshot  { provider_id, first_name, last_name, npi_number,
--                          dea_number, license_state }
--
-- Both are PHI, on the same row and under the same RLS as the rest of the
-- order. Only the service role writes them (signing). The signed-order
-- freeze (20261024000010, prevent_snapshot_mutation) freezes them once
-- locked_at is set: its column list is the binding's.
--
-- No backfill: an order signed before this change has neither, and is
-- sent as before only when its signing history row proves it (legacy).
--
-- PREPARED: merges after 20261024000010 (signed-order-freeze).

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS patient_snapshot    JSONB,
  ADD COLUMN IF NOT EXISTS prescriber_snapshot JSONB;

COMMENT ON COLUMN orders.patient_snapshot IS
  'HIPAA B7: the patient as signed (name, date of birth, allergy status). Written at signing, bound by provider_signature_hash_snapshot, sent instead of the live patient row.';
COMMENT ON COLUMN orders.prescriber_snapshot IS
  'HIPAA B7: the prescriber as signed (name, NPI, DEA, license state). Written at signing, bound by provider_signature_hash_snapshot, sent instead of the live provider row.';

COMMIT;
