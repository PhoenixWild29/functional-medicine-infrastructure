-- ============================================================
-- CompoundIQ — Demo Data Expansion Seed (2026-08-15)
-- ============================================================
--
-- PURPOSE
--   Expands the POC demo dataset from "1 clinic / 1 provider /
--   1 patient / mostly-empty pipeline" into a living, presentable
--   dataset for investor walkthroughs (demo doc v2.9):
--
--     * 3 additional Sunrise providers — Dr. Marcus Patel,
--       Dr. Elena Rodriguez, Jamie Fletcher NP. Realism + F-3
--       clinic-view toggle + F-5 primary-provider demos. Only
--       Dr. Chen has a Supabase Auth login and can sign; the new
--       providers have no auth user (providers.user_id stays NULL).
--     * A second clinic — Blue Cedar Integrative Health — with
--       Dr. Naomi Osei and patient Ruby Sandoval (NM). Powers the
--       ops multi-tenant view and cross-clinic RLS isolation beat.
--     * 8 new multi-state Sunrise patients (CA NY FL WA CO AZ IL GA)
--       with primary_provider_id split across Chen/Patel/Rodriguez.
--     * 17 pharmacy state licenses so every patient state is covered.
--       CA deliberately has EXACTLY 2 licensed pharmacies (Strive +
--       Quick Rx) for the state-license filter demo beat; TX has all 5.
--     * 12 lifecycle orders (order_number DEMO-1001..DEMO-1012) on
--       V3-catalog formulations, spread across the pipeline:
--       4 DELIVERED, 2 SHIPPED (with tracking), 2 PHARMACY_PROCESSING,
--       2 PAID_PROCESSING, 1 SUBMISSION_FAILED (ops triage beat),
--       1 AWAITING_PAYMENT (Blue Cedar). created_at staggered over
--       ~3 weeks so dashboards read like a working clinic.
--     * 6 provider favorites (2 each for Chen / Patel / Rodriguez).
--     * 1 protocol template — "Menopause Foundation — BHRT"
--       (Biest + Progesterone + DHEA, 12 weeks, by Dr. Rodriguez).
--
-- PREREQUISITES
--   * All migrations through 20260614000004_f5_patients_primary_provider_id
--     applied (needs orders.formulation_id [WO-87], orders.pharmacy_id,
--     provider_favorites / protocol_templates / protocol_items [WO-85],
--     patients.primary_provider_id [F-5]).
--   * Base POC seed already run (scripts/seed-poc.ts): Sunrise clinic
--     a1...01, Dr. Chen a2...01, Alex Demo a3...01, the 5 pharmacies
--     a4...01..05, Strive TX license.
--   * V3 catalog imported (scripts/import-catalog-v3.ts /
--     docs/research/catalog-seed/compoundiq-catalog-seed-v1.csv).
--     Formulation IDs are the importer's deterministic derivation:
--       formulation_id = md5('formulation:' || lower(<formulation name>))::uuid
--     This file computes them inline with the same expression, so it
--     never hardcodes a formulation UUID. If a referenced formulation
--     name is missing from the catalog, the FK fails loudly — that is
--     intentional (run the catalog import first).
--
-- IDEMPOTENCY / SAFETY
--   * Every INSERT is ON CONFLICT DO NOTHING with deterministic UUIDs —
--     safe to re-run; re-runs are no-ops.
--   * Single BEGIN/COMMIT — all-or-nothing.
--   * Pure INSERTs into steady-state rows: no UPDATEs, so no
--     status-transition or SMS triggers fire.
--   * ...-02 IDs in the a1/a2/a3 spaces are TAKEN by the hidden "Ops
--     Demo Data" scaffolding (src/lib/poc/refresh-demo-data.ts).
--     This seed starts at ...-03 to stay clear of them.
--
-- DETERMINISTIC ID MAP
--   clinics    a1000000-0000-0000-0000-000000000003  Blue Cedar Integrative Health
--   providers  a2000000-0000-0000-0000-000000000003  Dr. Marcus Patel      (Sunrise)
--              a2000000-0000-0000-0000-000000000004  Dr. Elena Rodriguez   (Sunrise)
--              a2000000-0000-0000-0000-000000000005  Jamie Fletcher NP     (Sunrise)
--              a2000000-0000-0000-0000-000000000006  Dr. Naomi Osei        (Blue Cedar)
--   patients   a3000000-0000-0000-0000-000000000003..10  8 Sunrise patients
--              a3000000-0000-0000-0000-000000000011  Ruby Sandoval         (Blue Cedar)
--   orders     d1000000-0000-4000-8000-000000000001..12  DEMO-1001..DEMO-1012
--   favorites  e2000000-0000-4000-8000-000000000001..06
--   protocol   e3000000-0000-4000-8000-000000000001
--   items      e3100000-0000-4000-8000-000000000001..03
--
-- HOW TO RUN
--   Paste into the Supabase SQL editor (service role) against the POC
--   project, or: psql "$DATABASE_URL" -f scripts/demo-expansion-seed.sql
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CLINIC — Blue Cedar Integrative Health (second tenant)
-- ============================================================

INSERT INTO clinics (clinic_id, name, stripe_connect_account_id, stripe_connect_status,
                     default_markup_pct, order_intake_blocked, is_active)
VALUES
  ('a1000000-0000-0000-0000-000000000003', 'Blue Cedar Integrative Health',
   'acct_poc_blue_cedar_demo', 'ACTIVE', 40, false, true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. PROVIDERS
-- ============================================================
-- Only Dr. Chen (a2...01, seeded by seed-poc.ts) has an auth login;
-- these rows have user_id NULL and exist for roster realism, the
-- F-3 clinic-view toggle, and F-5 primary-provider assignment.
-- signature_on_file=true where seeded orders imply a prior signature;
-- Fletcher stays false (no seeded orders).

INSERT INTO providers (provider_id, clinic_id, first_name, last_name, npi_number,
                       license_state, license_number, dea_number, signature_on_file, is_active)
VALUES
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001',
   'Marcus', 'Patel',     '1234567891', 'TX', 'TX-MD-002345', 'BP7654321', true,  true),
  ('a2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001',
   'Elena',  'Rodriguez', '1234567892', 'TX', 'TX-MD-003456', NULL,        true,  true),
  ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001',
   'Jamie',  'Fletcher',  '1234567893', 'TX', 'TX-NP-004567', NULL,        false, true),
  ('a2000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000003',
   'Naomi',  'Osei',      '1234567894', 'NM', 'NM-MD-005678', NULL,        true,  true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. PATIENTS — 8 multi-state Sunrise + 1 Blue Cedar
-- ============================================================
-- primary_provider_id (F-5) split: Chen (Jordan/Maya/Liam),
-- Patel (Ethan/Noah), Rodriguez (Sofia/Ava/Grace), Osei (Ruby).

INSERT INTO patients (patient_id, clinic_id, first_name, last_name, date_of_birth, phone,
                      email, address_line1, city, state, zip, sms_opt_in,
                      primary_provider_id, is_active)
VALUES
  ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001',
   'Jordan', 'Rivera',   '1988-03-12', '+14155550110', 'jordan.rivera@compoundiq-poc.com',
   '1200 Mission St',          'San Francisco', 'CA', '94103', true,
   'a2000000-0000-0000-0000-000000000001', true),
  ('a3000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001',
   'Maya',   'Thompson', '1979-11-02', '+12125550111', 'maya.thompson@compoundiq-poc.com',
   '88 Lexington Ave',         'New York',      'NY', '10016', true,
   'a2000000-0000-0000-0000-000000000001', true),
  ('a3000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001',
   'Ethan',  'Brooks',   '1982-07-24', '+13055550112', 'ethan.brooks@compoundiq-poc.com',
   '450 Ocean Dr',             'Miami',         'FL', '33139', true,
   'a2000000-0000-0000-0000-000000000003', true),
  ('a3000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001',
   'Sofia',  'Nguyen',   '1975-05-18', '+12065550113', 'sofia.nguyen@compoundiq-poc.com',
   '1516 Pine St',             'Seattle',       'WA', '98101', true,
   'a2000000-0000-0000-0000-000000000004', true),
  ('a3000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000001',
   'Liam',   'Carter',   '1990-09-30', '+13035550114', 'liam.carter@compoundiq-poc.com',
   '2020 Blake St',            'Denver',        'CO', '80205', true,
   'a2000000-0000-0000-0000-000000000001', true),
  ('a3000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000001',
   'Ava',    'Martinez', '1968-01-27', '+16025550115', 'ava.martinez@compoundiq-poc.com',
   '340 E Palm Ln',            'Phoenix',       'AZ', '85004', true,
   'a2000000-0000-0000-0000-000000000004', true),
  ('a3000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000001',
   'Noah',   'Kim',      '1986-12-09', '+13125550116', 'noah.kim@compoundiq-poc.com',
   '233 W Lake St',            'Chicago',       'IL', '60606', true,
   'a2000000-0000-0000-0000-000000000003', true),
  ('a3000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000001',
   'Grace',  'O''Connor', '1972-04-15', '+14045550117', 'grace.oconnor@compoundiq-poc.com',
   '675 Ponce De Leon Ave',    'Atlanta',       'GA', '30308', true,
   'a2000000-0000-0000-0000-000000000004', true),
  ('a3000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000003',
   'Ruby',   'Sandoval', '1983-08-21', '+15055550118', 'ruby.sandoval@compoundiq-poc.com',
   '1610 Central Ave',         'Albuquerque',   'NM', '87106', true,
   'a2000000-0000-0000-0000-000000000006', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. PHARMACY STATE LICENSES — 17 rows
-- ============================================================
-- Coverage design (demo beats, not random):
--   * CA: EXACTLY 2 pharmacies (Strive + Quick Rx) → the patient-state
--     filter beat with Jordan Rivera shows the list visibly shrink.
--   * TX: all 5 pharmacies (Strive's TX license already exists from
--     seed-poc.ts; the other 4 are added here).
--   * Every other patient state (NY FL WA CO AZ IL GA NM) has at
--     least one licensed pharmacy.
-- Pharmacy IDs (seed-poc.ts / refresh-demo-data.ts):
--   a4...01 Strive (T4 fax) · a4...02 Quick Rx (T1 API)
--   a4...03 Express Digital Rx (T1 API) · a4...04 Portal Plus (T2 Portal)
--   a4...05 Hybrid Labs (T3 Hybrid)

INSERT INTO pharmacy_state_licenses (pharmacy_id, state_code, license_number, expiration_date, is_active)
VALUES
  -- Strive Pharmacy (TX exists already)
  ('a4000000-0000-0000-0000-000000000001', 'CA', 'CA-PHARM-4101', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000001', 'FL', 'FL-PHARM-4102', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000001', 'AZ', 'AZ-PHARM-4103', '2030-12-31', true),
  -- Quick Rx Pharmacy
  ('a4000000-0000-0000-0000-000000000002', 'TX', 'TX-PHARM-4201', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000002', 'CA', 'CA-PHARM-4202', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000002', 'CO', 'CO-PHARM-4203', '2030-12-31', true),
  -- Express Digital Rx
  ('a4000000-0000-0000-0000-000000000003', 'TX', 'TX-PHARM-4301', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000003', 'NY', 'NY-PHARM-4302', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000003', 'IL', 'IL-PHARM-4303', '2030-12-31', true),
  -- Portal Plus Pharmacy
  ('a4000000-0000-0000-0000-000000000004', 'TX', 'TX-PHARM-4401', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000004', 'NY', 'NY-PHARM-4402', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000004', 'WA', 'WA-PHARM-4403', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000004', 'GA', 'GA-PHARM-4404', '2030-12-31', true),
  -- Hybrid Labs Pharmacy
  ('a4000000-0000-0000-0000-000000000005', 'TX', 'TX-PHARM-4501', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000005', 'FL', 'FL-PHARM-4502', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000005', 'CO', 'CO-PHARM-4503', '2030-12-31', true),
  ('a4000000-0000-0000-0000-000000000005', 'NM', 'NM-PHARM-4504', '2030-12-31', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. ORDERS — DEMO-1001..DEMO-1012 (lifecycle pipeline)
-- ============================================================
-- All orders reference V3 formulations (catalog_item_id stays NULL —
-- CHECK orders_catalog_or_formulation_required requires exactly one).
-- Snapshot columns are populated as the DRAFT→AWAITING_PAYMENT lock
-- would have frozen them: wholesale from the catalog CSV, retail at
-- the clinic's 40% default markup, medication/pharmacy snapshots as
-- JSONB, locked_at shortly after created_at. Statuses are steady-state
-- (no automation picks these up); the Schedule-3 Testosterone order
-- routes Tier 4 fax per the controlled-substance constraint.
-- Wholesale prices (compoundiq-catalog-seed-v1.csv):
--   Semaglutide Inj 5 mg/mL $95 · Testosterone Cyp Inj 200mg/mL $48 ·
--   Estradiol Cream 0.1% $24.50 · Tadalafil Troche 10mg $24 ·
--   NAD+ Injectable $155 · LDN Capsule 4.5mg $19 · Progesterone Cap
--   100mg $18.50 · Biest 80/20 Cream 2.5mg/g $28 · BPC-157 Inj 5mg $62 ·
--   DHEA Capsule 10mg $16. Retail = 1.4x (40% default markup).

-- DEMO-1001 — Jordan Rivera (CA) / Dr. Chen / Semaglutide / Strive — DELIVERED
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    tracking_number, carrier, created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000001',
  'a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001',
  md5('formulation:' || lower('Semaglutide Injectable 5 mg/mL'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001',
  'DELIVERED', 1, 95.00, 133.00,
  jsonb_build_object('medication_name', 'Semaglutide Injectable 5 mg/mL', 'form', 'Injectable Solution',
                     'dose', '5 mg/mL', 'wholesale_price', 95.00, 'dea_schedule', NULL),
  'CA', '1234567890',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000001', 'name', 'Strive Pharmacy',
                     'slug', 'strive', 'integration_tier', 'TIER_4_FAX'),
  now() - interval '21 days' + interval '40 minutes', 'TIER_4_FAX',
  'Inject 20 units (0.4mg) subcutaneously once weekly in the morning.',
  'DEMO-1001', '1Z999AA10123456784', 'UPS',
  now() - interval '21 days', now() - interval '16 days', true)
ON CONFLICT DO NOTHING;

-- DEMO-1002 — Ethan Brooks (FL) / Dr. Patel / Testosterone Cyp 200 / Strive — DELIVERED
-- (Schedule 3 → forced Tier 4 fax per the controlled-substance constraint)
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    tracking_number, carrier, created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000002',
  'a3000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000003',
  md5('formulation:' || lower('Testosterone Cypionate Injectable 200mg/mL'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001',
  'DELIVERED', 1, 48.00, 67.20,
  jsonb_build_object('medication_name', 'Testosterone Cypionate Injectable 200mg/mL', 'form', 'Injectable Solution',
                     'dose', '200mg/mL', 'wholesale_price', 48.00, 'dea_schedule', 3),
  'FL', '1234567891',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000001', 'name', 'Strive Pharmacy',
                     'slug', 'strive', 'integration_tier', 'TIER_4_FAX'),
  now() - interval '20 days' + interval '35 minutes', 'TIER_4_FAX',
  'Inject 1mL (200mg) intramuscularly once weekly.',
  'DEMO-1002', '9400111899560001234561', 'USPS',
  now() - interval '20 days', now() - interval '14 days', true)
ON CONFLICT DO NOTHING;

-- DEMO-1003 — Sofia Nguyen (WA) / Dr. Rodriguez / Estradiol 0.1% cream / Portal Plus — DELIVERED
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    tracking_number, carrier, created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000003',
  'a3000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000004',
  md5('formulation:' || lower('Estradiol Topical Cream 0.1%'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000004',
  'DELIVERED', 1, 24.50, 34.30,
  jsonb_build_object('medication_name', 'Estradiol Topical Cream 0.1%', 'form', 'Topical Cream',
                     'dose', '0.1%', 'wholesale_price', 24.50, 'dea_schedule', NULL),
  'WA', '1234567892',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000004', 'name', 'Portal Plus Pharmacy',
                     'slug', 'portal-plus', 'integration_tier', 'TIER_2_PORTAL'),
  now() - interval '18 days' + interval '50 minutes', 'TIER_2_PORTAL',
  'Apply 1 gram topically to inner forearm once daily in the morning.',
  'DEMO-1003', '881234567890', 'FedEx',
  now() - interval '18 days', now() - interval '12 days', true)
ON CONFLICT DO NOTHING;

-- DEMO-1004 — Noah Kim (IL) / Dr. Patel / Tadalafil troche / Express Digital — DELIVERED
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    tracking_number, carrier, created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000004',
  'a3000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000003',
  md5('formulation:' || lower('Tadalafil Troche 10mg'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000003',
  'DELIVERED', 1, 24.00, 33.60,
  jsonb_build_object('medication_name', 'Tadalafil Troche 10mg', 'form', 'Troche',
                     'dose', '10mg', 'wholesale_price', 24.00, 'dea_schedule', NULL),
  'IL', '1234567891',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000003', 'name', 'Express Digital Rx',
                     'slug', 'express-digital', 'integration_tier', 'TIER_1_API'),
  now() - interval '16 days' + interval '25 minutes', 'TIER_1_API',
  'Dissolve one troche under the tongue 30 minutes before activity as needed.',
  'DEMO-1004', '1Z999AA10123456790', 'UPS',
  now() - interval '16 days', now() - interval '11 days', true)
ON CONFLICT DO NOTHING;

-- DEMO-1005 — Liam Carter (CO) / Dr. Chen / NAD+ / Quick Rx — SHIPPED
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    tracking_number, carrier, created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000005',
  'a3000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000001',
  md5('formulation:' || lower('NAD+ Injectable'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002',
  'SHIPPED', 1, 155.00, 217.00,
  jsonb_build_object('medication_name', 'NAD+ Injectable', 'form', 'Injectable Solution',
                     'dose', '100mg/mL', 'wholesale_price', 155.00, 'dea_schedule', NULL),
  'CO', '1234567890',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000002', 'name', 'Quick Rx Pharmacy',
                     'slug', 'quick-rx', 'integration_tier', 'TIER_1_API'),
  now() - interval '9 days' + interval '30 minutes', 'TIER_1_API',
  'Inject 0.5mL subcutaneously twice weekly.',
  'DEMO-1005', '9400111899560001234578', 'USPS',
  now() - interval '9 days', now() - interval '2 days', true)
ON CONFLICT DO NOTHING;

-- DEMO-1006 — Grace O'Connor (GA) / Dr. Rodriguez / LDN 4.5 / Portal Plus — SHIPPED
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    tracking_number, carrier, created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000006',
  'a3000000-0000-0000-0000-000000000010', 'a2000000-0000-0000-0000-000000000004',
  md5('formulation:' || lower('LDN Capsule 4.5mg'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000004',
  'SHIPPED', 1, 19.00, 26.60,
  jsonb_build_object('medication_name', 'LDN Capsule 4.5mg', 'form', 'Capsule',
                     'dose', '4.5mg', 'wholesale_price', 19.00, 'dea_schedule', NULL),
  'GA', '1234567892',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000004', 'name', 'Portal Plus Pharmacy',
                     'slug', 'portal-plus', 'integration_tier', 'TIER_2_PORTAL'),
  now() - interval '8 days' + interval '45 minutes', 'TIER_2_PORTAL',
  'Take one capsule by mouth at bedtime.',
  'DEMO-1006', '1Z999AA10123456806', 'UPS',
  now() - interval '8 days', now() - interval '1 day', true)
ON CONFLICT DO NOTHING;

-- DEMO-1007 — Maya Thompson (NY) / Dr. Chen / Progesterone 100 / Express Digital — PHARMACY_PROCESSING
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000007',
  'a3000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001',
  md5('formulation:' || lower('Progesterone Capsule 100mg'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000003',
  'PHARMACY_PROCESSING', 1, 18.50, 25.90,
  jsonb_build_object('medication_name', 'Progesterone Capsule 100mg', 'form', 'Capsule',
                     'dose', '100mg', 'wholesale_price', 18.50, 'dea_schedule', NULL),
  'NY', '1234567890',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000003', 'name', 'Express Digital Rx',
                     'slug', 'express-digital', 'integration_tier', 'TIER_1_API'),
  now() - interval '6 days' + interval '20 minutes', 'TIER_1_API',
  'Take one capsule by mouth at bedtime.',
  'DEMO-1007',
  now() - interval '6 days', now() - interval '3 days', true)
ON CONFLICT DO NOTHING;

-- DEMO-1008 — Ava Martinez (AZ) / Dr. Rodriguez / Biest 80/20 cream / Strive — PHARMACY_PROCESSING
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000008',
  'a3000000-0000-0000-0000-000000000008', 'a2000000-0000-0000-0000-000000000004',
  md5('formulation:' || lower('Biest 80/20 Topical Cream 2.5mg/g'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001',
  'PHARMACY_PROCESSING', 1, 28.00, 39.20,
  jsonb_build_object('medication_name', 'Biest 80/20 Topical Cream 2.5mg/g', 'form', 'Topical Cream',
                     'dose', '2.5mg/g', 'wholesale_price', 28.00, 'dea_schedule', NULL),
  'AZ', '1234567892',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000001', 'name', 'Strive Pharmacy',
                     'slug', 'strive', 'integration_tier', 'TIER_4_FAX'),
  now() - interval '5 days' + interval '30 minutes', 'TIER_4_FAX',
  'Apply 0.5mL topically to inner wrist nightly.',
  'DEMO-1008',
  now() - interval '5 days', now() - interval '2 days', true)
ON CONFLICT DO NOTHING;

-- DEMO-1009 — Jordan Rivera (CA) / Dr. Chen / BPC-157 / Quick Rx — PAID_PROCESSING
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000009',
  'a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001',
  md5('formulation:' || lower('BPC-157 Injectable 5mg'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000002',
  'PAID_PROCESSING', 1, 62.00, 86.80,
  jsonb_build_object('medication_name', 'BPC-157 Injectable 5mg', 'form', 'Injectable Solution',
                     'dose', '1mg/mL (5mg vial)', 'wholesale_price', 62.00, 'dea_schedule', NULL),
  'CA', '1234567890',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000002', 'name', 'Quick Rx Pharmacy',
                     'slug', 'quick-rx', 'integration_tier', 'TIER_1_API'),
  now() - interval '3 days' + interval '25 minutes', 'TIER_1_API',
  'Inject 0.25mL subcutaneously once daily near injury site.',
  'DEMO-1009',
  now() - interval '3 days', now() - interval '3 days' + interval '2 hours', true)
ON CONFLICT DO NOTHING;

-- DEMO-1010 — Sofia Nguyen (WA) / Dr. Rodriguez / DHEA / Portal Plus — PAID_PROCESSING
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000010',
  'a3000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000004',
  md5('formulation:' || lower('DHEA Capsule 10mg'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000004',
  'PAID_PROCESSING', 1, 16.00, 22.40,
  jsonb_build_object('medication_name', 'DHEA Capsule 10mg', 'form', 'Capsule',
                     'dose', '10mg', 'wholesale_price', 16.00, 'dea_schedule', NULL),
  'WA', '1234567892',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000004', 'name', 'Portal Plus Pharmacy',
                     'slug', 'portal-plus', 'integration_tier', 'TIER_2_PORTAL'),
  now() - interval '2 days' + interval '35 minutes', 'TIER_2_PORTAL',
  'Take one capsule by mouth each morning with food.',
  'DEMO-1010',
  now() - interval '2 days', now() - interval '2 days' + interval '2 hours', true)
ON CONFLICT DO NOTHING;

-- DEMO-1011 — Noah Kim (IL) / Dr. Patel / Semaglutide / Express Digital — SUBMISSION_FAILED
-- The ops triage beat: one failed submission at the "yellow" T1 pharmacy.
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000011',
  'a3000000-0000-0000-0000-000000000009', 'a2000000-0000-0000-0000-000000000003',
  md5('formulation:' || lower('Semaglutide Injectable 5 mg/mL'))::uuid,
  'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000003',
  'SUBMISSION_FAILED', 1, 95.00, 133.00,
  jsonb_build_object('medication_name', 'Semaglutide Injectable 5 mg/mL', 'form', 'Injectable Solution',
                     'dose', '5 mg/mL', 'wholesale_price', 95.00, 'dea_schedule', NULL),
  'IL', '1234567891',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000003', 'name', 'Express Digital Rx',
                     'slug', 'express-digital', 'integration_tier', 'TIER_1_API'),
  now() - interval '4 days' + interval '30 minutes', 'TIER_1_API',
  'Inject 20 units (0.4mg) subcutaneously once weekly in the morning.',
  'DEMO-1011',
  now() - interval '4 days', now() - interval '1 day', true)
ON CONFLICT DO NOTHING;

-- DEMO-1012 — Ruby Sandoval (NM) / Dr. Osei / Progesterone 100 / Hybrid Labs — AWAITING_PAYMENT
-- The Blue Cedar order: proves multi-tenant ops visibility + clinic isolation.
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    created_at, updated_at, is_active)
VALUES (
  'd1000000-0000-4000-8000-000000000012',
  'a3000000-0000-0000-0000-000000000011', 'a2000000-0000-0000-0000-000000000006',
  md5('formulation:' || lower('Progesterone Capsule 100mg'))::uuid,
  'a1000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000005',
  'AWAITING_PAYMENT', 1, 18.50, 25.90,
  jsonb_build_object('medication_name', 'Progesterone Capsule 100mg', 'form', 'Capsule',
                     'dose', '100mg', 'wholesale_price', 18.50, 'dea_schedule', NULL),
  'NM', '1234567894',
  jsonb_build_object('pharmacy_id', 'a4000000-0000-0000-0000-000000000005', 'name', 'Hybrid Labs Pharmacy',
                     'slug', 'hybrid-labs', 'integration_tier', 'TIER_3_HYBRID'),
  now() - interval '12 hours' + interval '15 minutes', 'TIER_3_HYBRID',
  'Take one capsule by mouth at bedtime.',
  'DEMO-1012',
  now() - interval '12 hours', now() - interval '12 hours' + interval '15 minutes', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. PROVIDER FAVORITES — 2 each for Chen / Patel / Rodriguez
-- ============================================================
-- The canonical c1000000-... favorites from earlier seeds are left
-- untouched; these use the e2 space. formulation_id derived inline
-- with the importer's md5 scheme.

INSERT INTO provider_favorites (favorite_id, provider_id, formulation_id, pharmacy_id, label,
                                dose_amount, dose_unit, frequency_code, timing_code,
                                duration_code, sig_mode, sig_text, default_quantity,
                                default_refills, use_count, last_used_at)
VALUES
  -- Dr. Chen
  ('e2000000-0000-4000-8000-000000000001', 'a2000000-0000-0000-0000-000000000001',
   md5('formulation:' || lower('Biest 80/20 Topical Cream 2.5mg/g'))::uuid,
   'a4000000-0000-0000-0000-000000000001', 'Biest 80/20 — Menopause Std',
   '0.5', 'mL', 'QHS', 'at-bedtime', 'ongoing', 'standard',
   'Apply 0.5mL topically to inner wrist nightly.', '30 g', 2, 4, now() - interval '5 days'),
  ('e2000000-0000-4000-8000-000000000002', 'a2000000-0000-0000-0000-000000000001',
   md5('formulation:' || lower('NAD+ Injectable'))::uuid,
   'a4000000-0000-0000-0000-000000000002', 'NAD+ Longevity',
   '0.5', 'mL', 'BIW', 'morning', '90-days', 'standard',
   'Inject 0.5mL subcutaneously twice weekly.', '5 mL vial', 1, 3, now() - interval '9 days'),
  -- Dr. Patel
  ('e2000000-0000-4000-8000-000000000003', 'a2000000-0000-0000-0000-000000000003',
   md5('formulation:' || lower('Testosterone Cypionate Injectable 200mg/mL'))::uuid,
   'a4000000-0000-0000-0000-000000000001', 'TRT Cyp 200 — Weekly',
   '1', 'mL', 'QW', 'morning', 'ongoing', 'standard',
   'Inject 1mL (200mg) intramuscularly once weekly.', '10 mL vial', 0, 6, now() - interval '14 days'),
  ('e2000000-0000-4000-8000-000000000004', 'a2000000-0000-0000-0000-000000000003',
   md5('formulation:' || lower('Tadalafil Troche 10mg'))::uuid,
   'a4000000-0000-0000-0000-000000000003', 'Tadalafil 10 Troche',
   '1', 'troche', 'PRN', 'as-needed', '30-days', 'standard',
   'Dissolve one troche under the tongue 30 minutes before activity as needed.', '30 troches', 1, 2, now() - interval '16 days'),
  -- Dr. Rodriguez
  ('e2000000-0000-4000-8000-000000000005', 'a2000000-0000-0000-0000-000000000004',
   md5('formulation:' || lower('Estradiol Topical Cream 0.1%'))::uuid,
   'a4000000-0000-0000-0000-000000000004', 'Estradiol 0.1% Cream',
   '1', 'g', 'QAM', 'morning', 'ongoing', 'standard',
   'Apply 1 gram topically to inner forearm once daily in the morning.', '30 g', 2, 5, now() - interval '12 days'),
  ('e2000000-0000-4000-8000-000000000006', 'a2000000-0000-0000-0000-000000000004',
   md5('formulation:' || lower('LDN Capsule 4.5mg'))::uuid,
   'a4000000-0000-0000-0000-000000000004', 'LDN 4.5 Maintenance',
   '1', 'capsule', 'QHS', 'at-bedtime', 'ongoing', 'standard',
   'Take one capsule by mouth at bedtime.', '90 caps', 3, 4, now() - interval '8 days')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 7. PROTOCOL — "Menopause Foundation — BHRT" (Dr. Rodriguez)
-- ============================================================

INSERT INTO protocol_templates (protocol_id, clinic_id, created_by, name, description,
                                therapeutic_category, total_duration_weeks, is_active, use_count)
VALUES (
  'e3000000-0000-4000-8000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000004',
  'Menopause Foundation — BHRT',
  'Foundational bioidentical hormone replacement for perimenopausal and menopausal patients: Biest transdermal estrogen, oral micronized progesterone, and low-dose DHEA support. Review labs at week 6; titrate at the 12-week follow-up.',
  'Women''s Health', 12, true, 1)
ON CONFLICT DO NOTHING;

INSERT INTO protocol_items (item_id, protocol_id, formulation_id, pharmacy_id, phase_name,
                            phase_start_week, phase_end_week, dose_amount, dose_unit,
                            frequency_code, timing_code, sig_mode, sig_text,
                            default_quantity, default_refills, is_conditional,
                            condition_description, sort_order)
VALUES
  ('e3100000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001',
   md5('formulation:' || lower('Biest 80/20 Topical Cream 2.5mg/g'))::uuid,
   'a4000000-0000-0000-0000-000000000001', 'Foundation', 1, 12,
   '0.5', 'mL', 'QHS', 'at-bedtime', 'standard',
   'Apply 0.5mL topically to inner wrist nightly.', '30 g', 2, false, NULL, 1),
  ('e3100000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000001',
   md5('formulation:' || lower('Progesterone Capsule 100mg'))::uuid,
   'a4000000-0000-0000-0000-000000000004', 'Foundation', 1, 12,
   '1', 'capsule', 'QHS', 'at-bedtime', 'standard',
   'Take one capsule by mouth at bedtime.', '90 caps', 2, false, NULL, 2),
  ('e3100000-0000-4000-8000-000000000003', 'e3000000-0000-4000-8000-000000000001',
   md5('formulation:' || lower('DHEA Capsule 10mg'))::uuid,
   'a4000000-0000-0000-0000-000000000004', 'Support', 1, 12,
   '1', 'capsule', 'QAM', 'morning', 'standard',
   'Take one capsule by mouth each morning with food.', '90 caps', 2, true,
   'Add when DHEA-S below mid-range on baseline labs.', 3)
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================
-- VERIFICATION (run separately after COMMIT; read-only)
-- ============================================================
-- Expected: clinics 1 · providers 4 · patients 9 · licenses 17 ·
-- orders 12 (statuses: 4 DELIVERED, 2 SHIPPED, 2 PHARMACY_PROCESSING,
-- 2 PAID_PROCESSING, 1 SUBMISSION_FAILED, 1 AWAITING_PAYMENT) ·
-- favorites 6 · protocols 1 · protocol items 3.
--
-- SELECT 'clinics'          AS entity, count(*) FROM clinics
--   WHERE clinic_id = 'a1000000-0000-0000-0000-000000000003'
-- UNION ALL
-- SELECT 'providers', count(*) FROM providers
--   WHERE provider_id::text LIKE 'a2000000-%'
--     AND provider_id::text >= 'a2000000-0000-0000-0000-000000000003'
-- UNION ALL
-- SELECT 'patients', count(*) FROM patients
--   WHERE patient_id::text LIKE 'a3000000-%'
--     AND patient_id::text >= 'a3000000-0000-0000-0000-000000000003'
-- UNION ALL
-- SELECT 'pharmacy_state_licenses (all)', count(*) FROM pharmacy_state_licenses
-- UNION ALL
-- SELECT 'demo orders', count(*) FROM orders WHERE order_number LIKE 'DEMO-10%'
-- UNION ALL
-- SELECT 'favorites', count(*) FROM provider_favorites
--   WHERE favorite_id::text LIKE 'e2000000-%'
-- UNION ALL
-- SELECT 'protocols', count(*) FROM protocol_templates
--   WHERE protocol_id = 'e3000000-0000-4000-8000-000000000001'
-- UNION ALL
-- SELECT 'protocol items', count(*) FROM protocol_items
--   WHERE protocol_id = 'e3000000-0000-4000-8000-000000000001';
--
-- SELECT status, count(*) FROM orders
--   WHERE order_number LIKE 'DEMO-10%' GROUP BY status ORDER BY status;
--
-- CA must show exactly 2 licensed pharmacies (Strive + Quick Rx):
-- SELECT p.name FROM pharmacy_state_licenses l
--   JOIN pharmacies p USING (pharmacy_id)
--   WHERE l.state_code = 'CA' AND l.is_active AND l.deleted_at IS NULL;
