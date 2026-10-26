-- ============================================================
-- Signed-order freeze: every signed clinical column (HIPAA B5)
-- ============================================================
--
-- prevent_snapshot_mutation (BEFORE UPDATE on orders, last redefined in
-- 20261012000001) froze 16 snapshot columns once locked_at is set, but
-- not sig_text, quantity, refills, dispense, days supply and the other
-- clinical columns the provider signed. This replaces the function so a
-- signed order's whole signed content is frozen:
--
--   - the clinical columns the signature binding covers
--     (SIGNED_CONTENT_COLUMNS, src/lib/orders/signature-binding.ts):
--     patient, the patient and prescriber as signed (patient_snapshot,
--     prescriber_snapshot: name, date of birth, allergy status; name,
--     NPI, DEA, license state), provider NPI, pharmacy snapshot,
--     medication snapshot, sig and titration / cycling, quantity,
--     dispense, days supply, refills, package, syringes, substitution,
--     shipping type, the ship-to address, clinical difference, diagnosis
--     and special instructions;
--   - the signature record: provider_signature_hash_snapshot, locked_at;
--   - prices and where it ships: the price snapshots, shipping_fee and
--     the shipping address snapshot;
--   - who prescribed what: provider_id, formulation_id, catalog_item_id.
--
-- The list is FROZEN_ORDER_COLUMNS in src/lib/orders/signed-order-freeze.ts;
-- src/lib/orders/__tests__/signed-order-freeze.test.ts fails if this
-- array and that list differ.
--
-- One exception, read from the code: the ops reroute
-- (api/ops/orders/[orderId]/action, 'reroute') moves an order from
-- SUBMISSION_FAILED, FAX_FAILED or PHARMACY_REJECTED to REROUTE_PENDING,
-- adds 1 to reroute_count and may change pharmacy_id, in one CAS update.
-- pharmacy_id may change only in exactly that update. The pharmacy the
-- provider signed for stays in pharmacy_snapshot (frozen, and bound by
-- the signature). No other code path writes a frozen column on a signed
-- order (the static scan in the same test).
--
-- Status, tracking, payment and transfer ids, the payment group, fax ids
-- and attempt counts, ops assignee, protocol and proposal links,
-- reroute_count, notes and timestamps stay updatable.
--
-- The message names the column (a column name, never a value: no PHI).
-- Columns are compared through to_jsonb so one array is the whole list.
-- patient_snapshot and prescriber_snapshot are added by 20261024000011,
-- which applies after this one: until then to_jsonb has no such key on
-- either row (NULL = NULL), so naming them here is safe in either order.
-- Only the function is replaced; the trigger (20260317000004) stays.
--
-- PREPARED: merges after 20261024000008 (perf-indexes) and
-- 20261024000009 (clinical-difference-saved); 20261024000011
-- (order-transmission-integrity) adds the two snapshot columns.

BEGIN;

CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER AS $$
DECLARE
  frozen CONSTANT text[] := ARRAY[
    -- the signed clinical content (SIGNED_CONTENT_COLUMNS), with the ship-to address
    'patient_id', 'patient_snapshot', 'prescriber_snapshot', 'provider_npi_snapshot',
    'pharmacy_snapshot', 'medication_snapshot',
    'sig_mode', 'sig_text', 'titration_steps', 'cycle_on_days', 'cycle_off_days',
    'quantity', 'dispense_quantity', 'dispense_unit', 'days_supply', 'refills',
    'package_id', 'package_label', 'package_count', 'syringe_option', 'substitution_allowed',
    'shipping_type',
    'shipping_address_line1_snapshot', 'shipping_address_line2_snapshot', 'shipping_city_snapshot',
    'shipping_state_snapshot', 'shipping_zip_snapshot',
    'clinical_difference', 'diagnosis_code', 'diagnosis_text', 'special_instructions',
    -- the signature record
    'provider_signature_hash_snapshot', 'locked_at',
    -- prices, and when the address was taken
    'wholesale_price_snapshot', 'retail_price_snapshot', 'shipping_fee', 'shipping_address_snapshot_at',
    -- who prescribed what
    'provider_id', 'formulation_id', 'catalog_item_id'
  ];
  old_row jsonb;
  new_row jsonb;
  col     text;
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    FOREACH col IN ARRAY frozen LOOP
      IF new_row -> col IS DISTINCT FROM old_row -> col THEN
        RAISE EXCEPTION 'Cannot modify signed clinical or snapshot fields after order is locked: %', col
          USING HINT = 'A signed order is frozen (HIPAA B5). Cancel it and prescribe again instead.';
      END IF;
    END LOOP;

    -- pharmacy_id: only the ops reroute, in its own CAS update.
    IF NEW.pharmacy_id IS DISTINCT FROM OLD.pharmacy_id AND NOT (
      OLD.status::text IN ('SUBMISSION_FAILED', 'FAX_FAILED', 'PHARMACY_REJECTED')
      AND NEW.status::text = 'REROUTE_PENDING'
      AND NEW.reroute_count = OLD.reroute_count + 1
    ) THEN
      RAISE EXCEPTION 'Cannot modify signed clinical or snapshot fields after order is locked: %', 'pharmacy_id'
        USING HINT = 'The pharmacy of a signed order changes only through the ops reroute.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
