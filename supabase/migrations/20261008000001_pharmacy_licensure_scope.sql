-- ============================================================
-- Compliance C5 — pharmacy licensure scope
-- ============================================================
--
-- An order may route to, and be signed for, a pharmacy only when it holds
-- an unexpired license in the patient's shipping state; a sterile product
-- (dosage_forms.is_sterile: injectables, pellets) also needs that license
-- to cover sterile compounding, or the pharmacy to be a 503B outsourcing
-- facility (lib/compliance/pharmacy-licensure.ts).
--
-- pharmacy_state_licenses already holds the state, license number, expiry
-- and active flag. It did not record what KIND of license it is or
-- whether it covers sterile compounding, and pharmacies did not record
-- 503A vs 503B. This adds those three columns, nothing else.
--
-- All three are NULLable and start NULL ("not recorded"): nothing is
-- guessed for existing rows. The application fails CLOSED on a NULL
-- sterile scope for a sterile product, so ops must record sterile scope
-- (the /ops/licensure matrix lists every unrecorded one) before sterile
-- orders route again. Non-sterile products are unaffected.
--
-- Additive only: no data is changed, no existing constraint moves.

BEGIN;

ALTER TABLE pharmacy_state_licenses
  ADD COLUMN IF NOT EXISTS license_type TEXT
    CHECK (license_type IN ('resident_pharmacy', 'nonresident_pharmacy', 'outsourcing_facility')),
  ADD COLUMN IF NOT EXISTS sterile_compounding BOOLEAN;

COMMENT ON COLUMN pharmacy_state_licenses.license_type IS
  'C5: what this state issued: resident_pharmacy (the pharmacy''s home state), nonresident_pharmacy (licensed to ship into the state), or outsourcing_facility (a 503B facility''s state license or registration). NULL = not recorded.';
COMMENT ON COLUMN pharmacy_state_licenses.sterile_compounding IS
  'C5: whether this license (or a permit/endorsement attached to it) covers sterile compounding in this state. NULL = not recorded; the app treats NULL as NOT covering a sterile product.';

ALTER TABLE pharmacies
  ADD COLUMN IF NOT EXISTS facility_type TEXT
    CHECK (facility_type IN ('503A', '503B'));

COMMENT ON COLUMN pharmacies.facility_type IS
  'C5: FDCA status. 503A = traditional compounding pharmacy (patient-specific prescriptions); 503B = FDA-registered outsourcing facility (covers sterile compounding, still needs a license in the patient''s state). NULL = not recorded.';

-- The ops matrix and the expiring-soon flag read licenses by expiry.
CREATE INDEX IF NOT EXISTS idx_pharmacy_state_licenses_expiry
  ON pharmacy_state_licenses (expiration_date)
  WHERE is_active AND deleted_at IS NULL;

COMMIT;
