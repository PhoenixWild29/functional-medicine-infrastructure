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
-- 503A vs 503B. This adds those three columns.
--
-- All three are NULLable and start NULL ("not recorded"): nothing is
-- guessed for existing rows, except the seeded demo pharmacies (see the
-- demo backfill at the end). The application fails CLOSED on a NULL
-- sterile scope for a sterile product, so for any other pharmacy ops must
-- record sterile scope (the /ops/licensure matrix lists every unrecorded
-- one) before its sterile orders route. Non-sterile products are
-- unaffected.
--
-- Additive, except the demo backfill at the end (seeded demo pharmacies
-- only, guarded by id). No existing constraint moves.

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

-- ── DEMO BACKFILL: seeded demo pharmacies ONLY ──────────────────────
--
-- Every pharmacy in this system today is a seeded demo pharmacy, and the
-- rule above fails closed on a NULL sterile scope, which would block the
-- demo's injectables (Semaglutide, BPC-157, ...) the moment this deploys.
-- So, for these five demo pharmacies and nothing else, this records what
-- the demo assumes: every existing active license covers sterile
-- compounding, and the pharmacy is a 503A compounding pharmacy.
--
--   a4000000-0000-0000-0000-000000000001  Strive Pharmacy
--   a4000000-0000-0000-0000-000000000002  Quick Rx Pharmacy
--   a4000000-0000-0000-0000-000000000003  Express Digital Rx
--   a4000000-0000-0000-0000-000000000004  Portal Plus Pharmacy
--   a4000000-0000-0000-0000-000000000005  Hybrid Labs Pharmacy
--
-- (scripts/seed-poc.ts, scripts/demo-expansion-seed.sql and
-- DEMO_LICENSURE_PHARMACIES in src/lib/compliance/pharmacy-licensure.ts.)
--
-- Guarded by WHERE pharmacy_id IN (...): on a database without these
-- pharmacies (a real deployment, the E2E project) both statements touch
-- nothing. A value already recorded is never overwritten. Any other
-- pharmacy keeps NULL, and NULL still blocks sterile products.

UPDATE pharmacy_state_licenses
   SET sterile_compounding = true
 WHERE pharmacy_id IN (
         'a4000000-0000-0000-0000-000000000001',
         'a4000000-0000-0000-0000-000000000002',
         'a4000000-0000-0000-0000-000000000003',
         'a4000000-0000-0000-0000-000000000004',
         'a4000000-0000-0000-0000-000000000005'
       )
   AND is_active
   AND deleted_at IS NULL
   AND sterile_compounding IS NULL;

UPDATE pharmacies
   SET facility_type = '503A'
 WHERE pharmacy_id IN (
         'a4000000-0000-0000-0000-000000000001',
         'a4000000-0000-0000-0000-000000000002',
         'a4000000-0000-0000-0000-000000000003',
         'a4000000-0000-0000-0000-000000000004',
         'a4000000-0000-0000-0000-000000000005'
       )
   AND facility_type IS NULL;

COMMIT;
