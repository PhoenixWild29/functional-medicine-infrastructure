-- ============================================================
-- CompoundIQ: production test-data cleanup (Issue Log 95), 2026-10-24
-- ============================================================
--
-- RUN BY SAM ONLY, on prod, AFTER Lauren has reviewed the test data.
-- Run as postgres (Supabase SQL editor or psql). One transaction.
--
-- BEFORE ANYTHING: run 2026-10-25-test-data-candidates.sql (read only). It
-- lists rows that look like test data and whether this script matches
-- them; add the exact name or email of any confirmed test row it misses.
--
-- DRY RUN FIRST: change the last line of this file from COMMIT to
-- ROLLBACK and run it. Nothing is kept, and the results show:
--   1. the preview (rows that would be removed, per table, plus the rows
--      kept on purpose), and
--   2. the verification (every count after the deletes; expected 0).
-- The Supabase SQL editor shows only the LAST result, which is the
-- combined report (preview and verification side by side). Then run it
-- again with COMMIT. It is idempotent: a second run matches nothing,
-- removes nothing and reports zeros.
--
-- WHAT IS MATCHED (exact values only; no LIKE on names):
--   Clinics       name = 'QA Test Clinic', 'Beta Test Practice',
--                 'Beta Test Practice 2' (exact, case-sensitive).
--   Pharmacy      name = 'QA Test Pharmacy' (exact).
--   Sunrise test  patients at Sunrise (a1000000-0000-0000-0000-000000000001)
--   patients      whose (first_name, last_name) is exactly one of:
--                 Intake Test, QAImport Alpha, QAImport Bravo,
--                 QAImport Charlie, QAKeragon Echo (either order).
--   QA Keragon    Sunrise's Keragon EHR connection (one per clinic and
--   connection    provider; no demo seed creates one) and its Vault secret.
--   Logins        every auth user whose app_metadata clinic_id is a matched
--                 clinic, every provider / accepted-invite user of a
--                 matched clinic, the QA Test Pharmacy admin (app_metadata
--                 pharmacy_id, application admin, accepted invite), and
--                 these exact emails:
--                   beta-test-provider@sunrise-clinic.com
--                   beta-test-provider2@sunrise-clinic.com
--                   beta-test-ma@sunrise-clinic.com  (login + its Sunrise
--                     invite only; Sunrise itself stays)
--   Proposals     every treatment proposal (patient protocol choice, #268)
--                 of a matched clinic, patient or provider, with its options,
--                 choice items and events. Its option orders are DRAFTs of
--                 the same matched patient, so they are matched orders.
--   E2E logins    emails at the reserved test domains the E2E suite uses:
--                 @compoundiq.test, @example.test,
--                 @patient-import.e2e.test, and e2e-*@example.com. A login
--                 only: one that belongs to a clinic or pharmacy that is not
--                 matched makes the script refuse.
--
-- REFUSES (RAISE EXCEPTION, nothing changes) when:
--   - a matched clinic is Sunrise or any seeded demo clinic
--     (a1000000-0000-0000-0000-*), or a matched pharmacy is a demo
--     pharmacy (a4000000-0000-0000-0000-*);
--   - a matched login is an ops_admin (other than an E2E test login), uses
--     a Sunrise/POC demo email that is not one of the three above, or
--     belongs to a clinic or pharmacy that is not matched (the Beta Test
--     MA may belong to Sunrise);
--   - an order to be removed is neither at a matched clinic nor for a
--     matched patient, or an order that stays is a refill of one that goes;
--   - a matched proposal is for a patient that stays, an order that stays
--     belongs to a matched proposal's option, or an order or choice item
--     that goes belongs to a proposal that stays;
--   - a protocol phase of a patient that stays uses a removed protocol or
--     was advanced by a removed provider (its history would be lost);
--   - an EPCS audit row or an active legal hold points at a matched row
--     (those are never deleted here);
--   - a match count is larger than its expected maximum (cleanup_expect).
--
-- DELIBERATELY KEPT:
--   - phi_access_log: append-only compliance log (who viewed which patient
--     or order, never PHI). Rows about the test patients and orders stay;
--     their ids simply no longer resolve. The preview counts them.
--   - epcs_audit_log and legal_holds: never touched (the script refuses
--     instead, above).
--   - Sunrise's own clinic_onboarding_events (e.g. the Beta Test MA's
--     invite and member events) and agreement acceptances: Sunrise's audit
--     history stays. Only the matched clinics' events go, because they
--     reference the clinic row (FK) that is removed.
--   - ops_alert_queue, reconciliation_runs, retention_runs, auth audit log
--     entries: history with no FK to the removed rows.
--   - inbound_fax_queue rows: kept, only their match to a removed order or
--     pharmacy is cleared.
--   - patient_field_changes on Sunrise demo patients made by the QA
--     Keragon sync: kept; their sync_event_id becomes NULL (FK SET NULL).
--   - Rows that stay and name a removed row through an ON DELETE SET NULL
--     key lose only that link, and the report counts them: protocol items
--     naming the QA Test Pharmacy, protocol versions published by a removed
--     provider, and proposal options taken from a removed protocol.
--
-- NOT DONE BY THIS SCRIPT (Supabase blocks deleting storage.objects in
-- SQL): files in Storage. The preview lists them (bucket + path) as
-- "storage (remove via the Storage API)"; delete them in the dashboard
-- or with the Storage API after COMMIT.
--
-- Append-only tables (agreement_acceptances, clinic_onboarding_events,
-- pharmacy_agreement_acceptances, pharmacy_onboarding_events,
-- ledger_entries, payable_events, proposal_choice_items,
-- treatment_proposal_events) and the signed-order guard on orders
-- refuse deletes by trigger. Inside this transaction each guard is
-- disabled only around the matched deletes and re-enabled before COMMIT
-- (ALTER TABLE takes an exclusive lock until the end of the transaction,
-- so no other session writes to those tables meanwhile; a ROLLBACK undoes
-- the disable too).
--
-- Proposals of test data are DELETED, not cancelled. The app never deletes
-- a proposal (service_role has no DELETE on treatment_proposals, and choice
-- items and events are append-only), so that a real patient's choice and
-- its history cannot be rewritten. Test proposals are different: each one
-- has NOT NULL foreign keys to its patient, clinic and provider, so it
-- cannot outlive the test patient, and cancelling it would keep the test
-- patient's data. They are removed whole, as postgres (the table owner,
-- not subject to the service_role grants), exactly like the removed
-- clinics' other append-only rows: only rows of matched proposals, each
-- guard disabled by name for the deletes. Nothing that stays loses
-- history: the refusals above stop the run if any row that stays points at
-- a matched proposal, and phi_access_log keeps its rows about the
-- proposals' create and sign steps (it has no foreign keys).

BEGIN;

-- ── 0. Expected maxima (raise one only after reviewing the preview) ──
CREATE TEMP TABLE cleanup_expect (item text PRIMARY KEY, max_rows int NOT NULL) ON COMMIT DROP;
INSERT INTO cleanup_expect VALUES
  ('clinics', 3),            -- QA Test Clinic, Beta Test Practice, Beta Test Practice 2
  ('pharmacies', 1),         -- QA Test Pharmacy
  ('sunrise test patients', 5),
  ('patients', 60),
  ('providers', 15),
  ('orders', 150),
  ('logins', 40),
  ('e2e logins', 60),
  ('ehr connections', 4),
  ('proposals', 20),
  ('vault secrets', 8);

-- ── 1. Match ─────────────────────────────────────────────────────
CREATE TEMP TABLE m_clinic   (clinic_id uuid PRIMARY KEY, why text) ON COMMIT DROP;
CREATE TEMP TABLE m_pharmacy (pharmacy_id uuid PRIMARY KEY, why text) ON COMMIT DROP;
CREATE TEMP TABLE m_patient  (patient_id uuid PRIMARY KEY, why text) ON COMMIT DROP;
CREATE TEMP TABLE m_provider (provider_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_user     (user_id uuid PRIMARY KEY, email text, why text) ON COMMIT DROP;
CREATE TEMP TABLE m_order    (order_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_group    (group_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_submission (submission_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_payable  (payable_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_connection (connection_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_batch    (batch_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_pharm_app (application_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_pharm_invite (invite_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_vault    (secret_id uuid PRIMARY KEY, why text) ON COMMIT DROP;
CREATE TEMP TABLE m_dispute  (dispute_id text PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_catalog  (item_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_ext_email (email text PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_proposal (proposal_id uuid PRIMARY KEY) ON COMMIT DROP;
CREATE TEMP TABLE m_option   (option_id uuid PRIMARY KEY) ON COMMIT DROP;

-- The three exact Beta logins.
INSERT INTO m_ext_email VALUES
  ('beta-test-provider@sunrise-clinic.com'),
  ('beta-test-provider2@sunrise-clinic.com'),
  ('beta-test-ma@sunrise-clinic.com');

-- Clinics, by exact name.
INSERT INTO m_clinic
SELECT clinic_id, name FROM clinics
WHERE name IN ('QA Test Clinic', 'Beta Test Practice', 'Beta Test Practice 2');

-- Pharmacy, by exact name.
INSERT INTO m_pharmacy
SELECT pharmacy_id, name FROM pharmacies WHERE name = 'QA Test Pharmacy';

-- Patients: every patient of a matched clinic, and the named Sunrise test patients.
INSERT INTO m_patient
SELECT patient_id, 'patient of a matched clinic' FROM patients
WHERE clinic_id IN (SELECT clinic_id FROM m_clinic);
INSERT INTO m_patient
SELECT patient_id, 'Sunrise test patient ' || first_name || ' ' || last_name FROM patients
WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001'
  AND ((first_name, last_name) IN (('Intake', 'Test'), ('QAImport', 'Alpha'), ('QAImport', 'Bravo'), ('QAImport', 'Charlie'), ('QAKeragon', 'Echo'))
    OR (last_name, first_name) IN (('Intake', 'Test'), ('QAImport', 'Alpha'), ('QAImport', 'Bravo'), ('QAImport', 'Charlie'), ('QAKeragon', 'Echo')))
ON CONFLICT DO NOTHING;

INSERT INTO m_provider SELECT provider_id FROM providers WHERE clinic_id IN (SELECT clinic_id FROM m_clinic);

-- Proposals (patient protocol choice): of a matched clinic, patient or provider, and their options.
INSERT INTO m_proposal
SELECT proposal_id FROM treatment_proposals
WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)
   OR patient_id IN (SELECT patient_id FROM m_patient)
   OR provider_id IN (SELECT provider_id FROM m_provider);
INSERT INTO m_option
SELECT option_id FROM treatment_proposal_options WHERE proposal_id IN (SELECT proposal_id FROM m_proposal);

-- Orders: at a matched clinic, for a matched patient, or to the matched pharmacy.
INSERT INTO m_order
SELECT order_id FROM orders
WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)
   OR patient_id IN (SELECT patient_id FROM m_patient)
   OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);

INSERT INTO m_group
SELECT group_id FROM payment_groups
WHERE clinic_id IN (SELECT clinic_id FROM m_clinic) OR patient_id IN (SELECT patient_id FROM m_patient)
UNION
SELECT payment_group_id FROM orders WHERE order_id IN (SELECT order_id FROM m_order) AND payment_group_id IS NOT NULL;

INSERT INTO m_submission
SELECT submission_id FROM adapter_submissions
WHERE order_id IN (SELECT order_id FROM m_order) OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);

INSERT INTO m_payable
SELECT payable_id FROM pharmacy_payables
WHERE order_id IN (SELECT order_id FROM m_order)
   OR payment_group_id IN (SELECT group_id FROM m_group)
   OR clinic_id IN (SELECT clinic_id FROM m_clinic)
   OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);

INSERT INTO m_dispute SELECT dispute_id FROM disputes WHERE order_id IN (SELECT order_id FROM m_order);

-- EHR connections: the matched clinics' and Sunrise's Keragon connection (the QA one).
INSERT INTO m_connection
SELECT connection_id FROM ehr_connections
WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)
   OR (clinic_id = 'a1000000-0000-0000-0000-000000000001' AND provider = 'keragon');

-- Whether Sunrise's (QA) Keragon connection is matched: its patient links go with it.
CREATE TEMP TABLE m_flag (sunrise_keragon boolean NOT NULL) ON COMMIT DROP;
INSERT INTO m_flag SELECT EXISTS (
  SELECT 1 FROM ehr_connections WHERE connection_id IN (SELECT connection_id FROM m_connection) AND clinic_id = 'a1000000-0000-0000-0000-000000000001');

-- Import batches: the matched clinics', and a Sunrise batch whose every
-- imported patient is a matched test patient (the QAImport CSV).
INSERT INTO m_batch
SELECT batch_id FROM patient_import_batches WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)
UNION
SELECT b.batch_id FROM patient_import_batches b
WHERE EXISTS (SELECT 1 FROM patients p WHERE p.import_batch_id = b.batch_id AND p.patient_id IN (SELECT patient_id FROM m_patient))
  AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.import_batch_id = b.batch_id AND p.patient_id NOT IN (SELECT patient_id FROM m_patient));

-- The pharmacy's application, invites and catalog.
INSERT INTO m_pharm_app
SELECT application_id FROM pharmacy_onboarding_applications WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);
INSERT INTO m_pharm_invite
SELECT invite_id FROM pharmacy_invites
WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)
   OR pharmacy_name = 'QA Test Pharmacy'
   OR invite_id IN (SELECT invite_id FROM pharmacy_onboarding_applications WHERE application_id IN (SELECT application_id FROM m_pharm_app) AND invite_id IS NOT NULL);
INSERT INTO m_catalog SELECT item_id FROM catalog WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);

-- Logins.
INSERT INTO m_user
SELECT id, lower(email), 'member of a matched clinic' FROM auth.users
WHERE raw_app_meta_data->>'clinic_id' IN (SELECT clinic_id::text FROM m_clinic)
ON CONFLICT DO NOTHING;
INSERT INTO m_user
SELECT u.id, lower(u.email), 'provider or accepted invite of a matched clinic' FROM auth.users u
WHERE u.id IN (SELECT user_id FROM providers WHERE provider_id IN (SELECT provider_id FROM m_provider) AND user_id IS NOT NULL)
   OR u.id IN (SELECT accepted_user_id FROM onboarding_invites WHERE clinic_id IN (SELECT clinic_id FROM m_clinic) AND accepted_user_id IS NOT NULL)
ON CONFLICT DO NOTHING;
INSERT INTO m_user
SELECT u.id, lower(u.email), 'QA Test Pharmacy admin' FROM auth.users u
WHERE u.raw_app_meta_data->>'pharmacy_id' IN (SELECT pharmacy_id::text FROM m_pharmacy)
   OR u.id IN (SELECT admin_user_id FROM pharmacy_onboarding_applications WHERE application_id IN (SELECT application_id FROM m_pharm_app))
   OR u.id IN (SELECT accepted_user_id FROM pharmacy_invites WHERE invite_id IN (SELECT invite_id FROM m_pharm_invite) AND accepted_user_id IS NOT NULL)
ON CONFLICT DO NOTHING;
INSERT INTO m_user
SELECT id, lower(email), 'exact Beta email' FROM auth.users WHERE lower(email) IN (SELECT email FROM m_ext_email)
ON CONFLICT DO NOTHING;
INSERT INTO m_user
SELECT id, lower(email), 'E2E test domain' FROM auth.users
WHERE split_part(lower(email), '@', 2) IN ('compoundiq.test', 'example.test', 'patient-import.e2e.test')
   OR (split_part(lower(email), '@', 2) = 'example.com' AND lower(email) LIKE 'e2e-%')
ON CONFLICT DO NOTHING;

-- Vault secrets: the EHR connections' and the pharmacy's adapter / portal credentials.
INSERT INTO m_vault
SELECT secret_vault_id, 'EHR connection secret' FROM ehr_connections
WHERE connection_id IN (SELECT connection_id FROM m_connection) AND secret_vault_id IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO m_vault
SELECT vault_secret_id, 'pharmacy API credential' FROM pharmacy_api_configs
WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)
ON CONFLICT DO NOTHING;
INSERT INTO m_vault
SELECT s, 'pharmacy portal credential' FROM pharmacy_portal_configs c, LATERAL unnest(ARRAY[c.username_vault_id, c.password_vault_id]) s
WHERE c.pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) AND s IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 2. Refuse anything unexpected ───────────────────────────────
DO $$
DECLARE
  bad text;
  n   int;
  lim int;
BEGIN
  SELECT string_agg(clinic_id::text, ', ') INTO bad FROM m_clinic
  WHERE clinic_id::text LIKE 'a1000000-0000-0000-0000-%';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: a matched clinic is Sunrise or a demo clinic (%)', bad; END IF;

  SELECT string_agg(pharmacy_id::text, ', ') INTO bad FROM m_pharmacy
  WHERE pharmacy_id::text LIKE 'a4000000-0000-0000-0000-%';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: a matched pharmacy is a demo pharmacy (%)', bad; END IF;

  SELECT string_agg(m.email, ', ') INTO bad FROM m_user m JOIN auth.users u ON u.id = m.user_id
  WHERE u.raw_app_meta_data->>'app_role' = 'ops_admin' AND m.why <> 'E2E test domain';
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: a matched login is an ops admin (%)', bad; END IF;

  SELECT string_agg(email, ', ') INTO bad FROM m_user
  WHERE (email LIKE '%@sunrise-clinic.com' OR email LIKE '%@compoundiq-poc.com')
    AND email NOT IN (SELECT email FROM m_ext_email);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: a matched login is a demo login (%)', bad; END IF;

  SELECT string_agg(m.email || ' -> clinic ' || (u.raw_app_meta_data->>'clinic_id'), ', ') INTO bad
  FROM m_user m JOIN auth.users u ON u.id = m.user_id
  WHERE u.raw_app_meta_data ? 'clinic_id'
    AND u.raw_app_meta_data->>'clinic_id' NOT IN (SELECT clinic_id::text FROM m_clinic)
    AND NOT (m.email = 'beta-test-ma@sunrise-clinic.com'
             AND u.raw_app_meta_data->>'clinic_id' = 'a1000000-0000-0000-0000-000000000001');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: a matched login belongs to a clinic that is not matched (%)', bad; END IF;

  SELECT string_agg(m.email || ' -> pharmacy ' || (u.raw_app_meta_data->>'pharmacy_id'), ', ') INTO bad
  FROM m_user m JOIN auth.users u ON u.id = m.user_id
  WHERE u.raw_app_meta_data ? 'pharmacy_id'
    AND u.raw_app_meta_data->>'pharmacy_id' NOT IN (SELECT pharmacy_id::text FROM m_pharmacy);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: a matched login belongs to a pharmacy that is not matched (%)', bad; END IF;

  SELECT string_agg(o.order_id::text, ', ') INTO bad FROM orders o
  WHERE o.order_id IN (SELECT order_id FROM m_order)
    AND o.clinic_id NOT IN (SELECT clinic_id FROM m_clinic)
    AND o.patient_id NOT IN (SELECT patient_id FROM m_patient);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: an order to the test pharmacy is for a real patient (%)', bad; END IF;

  SELECT string_agg(order_id::text, ', ') INTO bad FROM orders
  WHERE order_id NOT IN (SELECT order_id FROM m_order)
    AND (refill_of_order_id IN (SELECT order_id FROM m_order) OR payment_group_id IN (SELECT group_id FROM m_group));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: an order that stays depends on one that goes (%)', bad; END IF;

  SELECT string_agg(proposal_id::text, ', ') INTO bad FROM treatment_proposals
  WHERE proposal_id IN (SELECT proposal_id FROM m_proposal)
    AND patient_id NOT IN (SELECT patient_id FROM m_patient);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: a matched proposal is for a patient that stays (%)', bad; END IF;

  SELECT string_agg(order_id::text, ', ') INTO bad FROM orders
  WHERE order_id NOT IN (SELECT order_id FROM m_order)
    AND proposal_option_id IN (SELECT option_id FROM m_option);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: an order that stays belongs to a matched proposal (%)', bad; END IF;

  SELECT string_agg(order_id::text, ', ') INTO bad FROM orders
  WHERE order_id IN (SELECT order_id FROM m_order)
    AND proposal_option_id IS NOT NULL
    AND proposal_option_id NOT IN (SELECT option_id FROM m_option);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: an order that goes belongs to a proposal that stays (%)', bad; END IF;

  SELECT string_agg(DISTINCT proposal_id::text, ', ') INTO bad FROM proposal_choice_items
  WHERE proposal_id NOT IN (SELECT proposal_id FROM m_proposal)
    AND (order_id IN (SELECT order_id FROM m_order) OR option_id IN (SELECT option_id FROM m_option));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: a proposal that stays chose an order or option that goes (%)', bad; END IF;

  SELECT count(*) INTO n FROM patient_protocol_phases ph
  WHERE ph.patient_id NOT IN (SELECT patient_id FROM m_patient)
    AND (ph.protocol_id IN (SELECT protocol_id FROM protocol_templates WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)) OR ph.advanced_by IN (SELECT provider_id FROM m_provider)
      OR EXISTS (SELECT 1 FROM phase_advancement_history h WHERE h.tracking_id = ph.tracking_id AND h.advanced_by IN (SELECT provider_id FROM m_provider)));
  IF n > 0 THEN RAISE EXCEPTION 'refused: % protocol phase(s) of patients that stay use a removed protocol or provider', n; END IF;

  SELECT count(*) INTO n FROM epcs_audit_log
  WHERE patient_id IN (SELECT patient_id FROM m_patient) OR provider_id IN (SELECT provider_id FROM m_provider) OR order_id IN (SELECT order_id FROM m_order);
  IF n > 0 THEN RAISE EXCEPTION 'refused: % EPCS audit row(s) point at matched rows; EPCS audit is never deleted here', n; END IF;

  SELECT count(*) INTO n FROM legal_holds
  WHERE released_at IS NULL
    AND ((scope = 'clinic' AND target_id IN (SELECT clinic_id FROM m_clinic))
      OR (scope = 'patient' AND target_id IN (SELECT patient_id FROM m_patient)));
  IF n > 0 THEN RAISE EXCEPTION 'refused: % active legal hold(s) cover matched rows', n; END IF;

  -- Each named Sunrise test patient matches at most once.
  SELECT string_agg(why, ', ') INTO bad FROM (
    SELECT why FROM m_patient WHERE why LIKE 'Sunrise test patient %' GROUP BY why HAVING count(*) > 1) d;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'refused: more than one match for %', bad; END IF;

  FOR bad, n IN
    SELECT 'clinics', count(*) FROM m_clinic
    UNION ALL SELECT 'pharmacies', count(*) FROM m_pharmacy
    UNION ALL SELECT 'sunrise test patients', count(*) FROM m_patient WHERE why LIKE 'Sunrise test patient %'
    UNION ALL SELECT 'patients', count(*) FROM m_patient
    UNION ALL SELECT 'providers', count(*) FROM m_provider
    UNION ALL SELECT 'orders', count(*) FROM m_order
    UNION ALL SELECT 'logins', count(*) FROM m_user WHERE why <> 'E2E test domain'
    UNION ALL SELECT 'e2e logins', count(*) FROM m_user WHERE why = 'E2E test domain'
    UNION ALL SELECT 'ehr connections', count(*) FROM m_connection
    UNION ALL SELECT 'proposals', count(*) FROM m_proposal
    UNION ALL SELECT 'vault secrets', count(*) FROM m_vault
  LOOP
    SELECT max_rows INTO lim FROM cleanup_expect WHERE item = bad;
    IF n > lim THEN RAISE EXCEPTION 'refused: % matched % (expected at most %)', n, bad, lim; END IF;
  END LOOP;
END $$;

-- ── 3. Preview: exactly what goes, and what stays on purpose ──────
CREATE TEMP TABLE cleanup_report (ord int, item text, preview bigint, after bigint, expected_after bigint, note text) ON COMMIT DROP;

INSERT INTO cleanup_report (ord, item, preview, expected_after, note) VALUES
  (1,  'clinics',                          (SELECT count(*) FROM clinics WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, (SELECT string_agg(why, ', ') FROM m_clinic)),
  (2,  'pharmacies',                       (SELECT count(*) FROM pharmacies WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, (SELECT string_agg(why, ', ') FROM m_pharmacy)),
  (3,  'auth.users (logins)',              (SELECT count(*) FROM auth.users WHERE id IN (SELECT user_id FROM m_user)), 0, (SELECT string_agg(email || ' (' || why || ')', ', ' ORDER BY email) FROM m_user)),
  (4,  'auth.identities',                  (SELECT count(*) FROM auth.identities WHERE user_id IN (SELECT user_id FROM m_user)), 0, 'cascade from auth.users'),
  (5,  'auth.sessions',                    (SELECT count(*) FROM auth.sessions WHERE user_id IN (SELECT user_id FROM m_user)), 0, 'cascade from auth.users'),
  (6,  'auth.mfa_factors',                 (SELECT count(*) FROM auth.mfa_factors WHERE user_id IN (SELECT user_id FROM m_user)), 0, 'cascade from auth.users'),
  (7,  'auth.refresh_tokens',              (SELECT count(*) FROM auth.refresh_tokens WHERE user_id IN (SELECT user_id::text FROM m_user)), 0, NULL),
  (8,  'providers',                        (SELECT count(*) FROM providers WHERE provider_id IN (SELECT provider_id FROM m_provider)), 0, NULL),
  (9,  'provider_state_licenses',          (SELECT count(*) FROM provider_state_licenses WHERE provider_id IN (SELECT provider_id FROM m_provider)), 0, 'cascade from providers'),
  (10, 'provider_npi_verifications',       (SELECT count(*) FROM provider_npi_verifications WHERE provider_id IN (SELECT provider_id FROM m_provider)), 0, 'cascade from providers'),
  (11, 'provider_favorites',               (SELECT count(*) FROM provider_favorites WHERE provider_id IN (SELECT provider_id FROM m_provider) OR patient_id IN (SELECT patient_id FROM m_patient)), 0, NULL),
  (12, 'patients',                         (SELECT count(*) FROM patients WHERE patient_id IN (SELECT patient_id FROM m_patient)), 0, (SELECT string_agg(why, ', ') FROM m_patient WHERE why LIKE 'Sunrise%')),
  (13, 'patient_intake_links',             (SELECT count(*) FROM patient_intake_links WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, NULL),
  (14, 'patient_external_ids',             (SELECT count(*) FROM patient_external_ids WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic) OR (clinic_id = 'a1000000-0000-0000-0000-000000000001' AND system = 'keragon' AND (SELECT sunrise_keragon FROM m_flag))), 0, 'Sunrise Keragon links go with the QA Keragon connection'),
  (15, 'patient_field_changes',            (SELECT count(*) FROM patient_field_changes WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, NULL),
  (16, 'patient_import_batches',           (SELECT count(*) FROM patient_import_batches WHERE batch_id IN (SELECT batch_id FROM m_batch)), 0, NULL),
  (17, 'patient_protocol_phases',          (SELECT count(*) FROM patient_protocol_phases WHERE patient_id IN (SELECT patient_id FROM m_patient)), 0, 'cascade from patients'),
  (18, 'protocol_instances',               (SELECT count(*) FROM protocol_instances WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, NULL),
  (19, 'protocol_templates',               (SELECT count(*) FROM protocol_templates WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, 'versions and items cascade'),
  (20, 'orders',                           (SELECT count(*) FROM orders WHERE order_id IN (SELECT order_id FROM m_order)), 0, (SELECT count(*) || ' signed (locked)' FROM orders WHERE order_id IN (SELECT order_id FROM m_order) AND locked_at IS NOT NULL)),
  (21, 'order_status_history',             (SELECT count(*) FROM order_status_history WHERE order_id IN (SELECT order_id FROM m_order)), 0, NULL),
  (22, 'order_sla_deadlines',              (SELECT count(*) FROM order_sla_deadlines WHERE order_id IN (SELECT order_id FROM m_order)), 0, NULL),
  (23, 'sla_notifications_log',            (SELECT count(*) FROM sla_notifications_log WHERE order_id IN (SELECT order_id FROM m_order)), 0, NULL),
  (24, 'order_clarifications',             (SELECT count(*) FROM order_clarifications WHERE order_id IN (SELECT order_id FROM m_order)), 0, NULL),
  (25, 'adapter_submissions',              (SELECT count(*) FROM adapter_submissions WHERE submission_id IN (SELECT submission_id FROM m_submission)), 0, NULL),
  (26, 'adapter_submission_debug_payloads',(SELECT count(*) FROM adapter_submission_debug_payloads WHERE adapter_submission_id IN (SELECT submission_id FROM m_submission)), 0, 'cascade'),
  (27, 'pharmacy_webhook_events',          (SELECT count(*) FROM pharmacy_webhook_events WHERE order_id IN (SELECT order_id FROM m_order) OR submission_id IN (SELECT submission_id FROM m_submission) OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, NULL),
  (28, 'webhook_events',                   (SELECT count(*) FROM webhook_events WHERE order_id IN (SELECT order_id FROM m_order)), 0, NULL),
  (29, 'sms_log',                          (SELECT count(*) FROM sms_log WHERE order_id IN (SELECT order_id FROM m_order) OR patient_id IN (SELECT patient_id FROM m_patient)), 0, NULL),
  (30, 'clinic_notifications',             (SELECT count(*) FROM clinic_notifications WHERE order_id IN (SELECT order_id FROM m_order) OR clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, NULL),
  (31, 'disputes',                         (SELECT count(*) FROM disputes WHERE dispute_id IN (SELECT dispute_id FROM m_dispute)), 0, NULL),
  (32, 'dispute_orders',                   (SELECT count(*) FROM dispute_orders WHERE order_id IN (SELECT order_id FROM m_order) OR dispute_id IN (SELECT dispute_id FROM m_dispute)), 0, NULL),
  (33, 'transfer_failures',                (SELECT count(*) FROM transfer_failures WHERE order_id IN (SELECT order_id FROM m_order) OR clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, NULL),
  (34, 'payment_groups',                   (SELECT count(*) FROM payment_groups WHERE group_id IN (SELECT group_id FROM m_group)), 0, NULL),
  (35, 'ledger_entries',                   (SELECT count(*) FROM ledger_entries WHERE order_id IN (SELECT order_id FROM m_order) OR payment_group_id IN (SELECT group_id FROM m_group) OR clinic_id IN (SELECT clinic_id FROM m_clinic) OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, 'append-only: guard disabled for these rows'),
  (36, 'pharmacy_payables',                (SELECT count(*) FROM pharmacy_payables WHERE payable_id IN (SELECT payable_id FROM m_payable)), 0, NULL),
  (37, 'payable_events',                   (SELECT count(*) FROM payable_events WHERE payable_id IN (SELECT payable_id FROM m_payable)), 0, 'append-only: guard disabled for these rows'),
  (38, 'onboarding_invites',               (SELECT count(*) FROM onboarding_invites WHERE clinic_id IN (SELECT clinic_id FROM m_clinic) OR lower(email) IN (SELECT email FROM m_user)), 0, 'includes the Beta Test MA''s Sunrise invite'),
  (39, 'clinic_onboarding_steps',          (SELECT count(*) FROM clinic_onboarding_steps WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, NULL),
  (40, 'clinic_onboarding_events',         (SELECT count(*) FROM clinic_onboarding_events WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, 'append-only: matched clinics only'),
  (41, 'agreement_acceptances',            (SELECT count(*) FROM agreement_acceptances WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, 'append-only: matched clinics only'),
  (42, 'clinic_signup_links',              (SELECT count(*) FROM clinic_signup_links WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, NULL),
  (43, 'ehr_connections',                  (SELECT count(*) FROM ehr_connections WHERE connection_id IN (SELECT connection_id FROM m_connection)), 0, NULL),
  (44, 'ehr_sync_events',                  (SELECT count(*) FROM ehr_sync_events WHERE connection_id IN (SELECT connection_id FROM m_connection) OR clinic_id IN (SELECT clinic_id FROM m_clinic)), 0, NULL),
  (45, 'vault.secrets',                    (SELECT count(*) FROM vault.secrets WHERE id IN (SELECT secret_id FROM m_vault)), 0, (SELECT string_agg(why, ', ') FROM m_vault)),
  (46, 'pharmacy_onboarding_applications', (SELECT count(*) FROM pharmacy_onboarding_applications WHERE application_id IN (SELECT application_id FROM m_pharm_app)), 0, NULL),
  (47, 'pharmacy_invites',                 (SELECT count(*) FROM pharmacy_invites WHERE invite_id IN (SELECT invite_id FROM m_pharm_invite)), 0, NULL),
  (48, 'pharmacy_agreement_acceptances',   (SELECT count(*) FROM pharmacy_agreement_acceptances WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) OR application_id IN (SELECT application_id FROM m_pharm_app)), 0, 'append-only: guard disabled for these rows'),
  (49, 'pharmacy_onboarding_events',       (SELECT count(*) FROM pharmacy_onboarding_events WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) OR application_id IN (SELECT application_id FROM m_pharm_app) OR invite_id IN (SELECT invite_id FROM m_pharm_invite)), 0, 'append-only: guard disabled for these rows'),
  (50, 'pharmacy_state_licenses',          (SELECT count(*) FROM pharmacy_state_licenses WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, NULL),
  (51, 'pharmacy_api_configs',             (SELECT count(*) FROM pharmacy_api_configs WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, NULL),
  (52, 'pharmacy_portal_configs',          (SELECT count(*) FROM pharmacy_portal_configs WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, NULL),
  (53, 'pharmacy_formulations',            (SELECT count(*) FROM pharmacy_formulations WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, 'packages cascade'),
  (54, 'catalog (+ history, normalized)',  (SELECT count(*) FROM catalog WHERE item_id IN (SELECT item_id FROM m_catalog)) + (SELECT count(*) FROM normalized_catalog WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, NULL),
  (55, 'catalog_upload_history',           (SELECT count(*) FROM catalog_upload_history WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, NULL),
  (56, 'circuit_breaker_state',            (SELECT count(*) FROM circuit_breaker_state WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, 'cascade from pharmacies'),
  (62, 'treatment_proposals',              (SELECT count(*) FROM treatment_proposals WHERE proposal_id IN (SELECT proposal_id FROM m_proposal)), 0, (SELECT string_agg(status || ' ' || n, ', ') FROM (SELECT status, count(*) n FROM treatment_proposals WHERE proposal_id IN (SELECT proposal_id FROM m_proposal) GROUP BY status ORDER BY status) s)),
  (63, 'treatment_proposal_options',       (SELECT count(*) FROM treatment_proposal_options WHERE option_id IN (SELECT option_id FROM m_option)), 0, 'their orders are matched orders (DRAFT lines of the same patient)'),
  (64, 'proposal_choice_items',            (SELECT count(*) FROM proposal_choice_items WHERE proposal_id IN (SELECT proposal_id FROM m_proposal)), 0, 'append-only: guard disabled for these rows'),
  (65, 'treatment_proposal_events',        (SELECT count(*) FROM treatment_proposal_events WHERE proposal_id IN (SELECT proposal_id FROM m_proposal)), 0, 'append-only: guard disabled for these rows'),
  -- Unlinked, not deleted.
  (66, 'protocol_items naming the test pharmacy, of protocols that stay (pharmacy cleared)', (SELECT count(*) FROM protocol_items WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) AND protocol_id NOT IN (SELECT protocol_id FROM protocol_templates WHERE clinic_id IN (SELECT clinic_id FROM m_clinic))), 0, 'item kept; pharmacy set to NULL by its FK'),
  (67, 'protocol_template_versions published by a removed provider, of protocols that stay (publisher cleared)', (SELECT count(*) FROM protocol_template_versions WHERE published_by IN (SELECT provider_id FROM m_provider) AND protocol_id NOT IN (SELECT protocol_id FROM protocol_templates WHERE clinic_id IN (SELECT clinic_id FROM m_clinic))), 0, 'version kept; published_by set to NULL by its FK'),
  (68, 'treatment_proposal_options from a removed protocol, of proposals that stay (protocol cleared)', (SELECT count(*) FROM treatment_proposal_options WHERE protocol_id IN (SELECT protocol_id FROM protocol_templates WHERE clinic_id IN (SELECT clinic_id FROM m_clinic)) AND proposal_id NOT IN (SELECT proposal_id FROM m_proposal)), 0, 'option kept; protocol_id set to NULL by its FK'),
  (60, 'inbound_fax_queue (match cleared)',(SELECT count(*) FROM inbound_fax_queue WHERE matched_order_id IN (SELECT order_id FROM m_order) OR matched_pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy)), 0, 'fax kept; matched order / pharmacy set to NULL'),
  (61, 'patients flagged as duplicate of a test patient (flag cleared)', (SELECT count(*) FROM patients WHERE possible_duplicate_of IN (SELECT patient_id FROM m_patient) AND patient_id NOT IN (SELECT patient_id FROM m_patient)), 0, 'patient kept; possible-duplicate flag cleared'),
  -- Kept on purpose (expected_after = preview: unchanged).
  (70, 'KEPT phi_access_log rows about matched rows', (SELECT count(*) FROM phi_access_log WHERE patient_id IN (SELECT patient_id FROM m_patient) OR order_id IN (SELECT order_id FROM m_order) OR clinic_id IN (SELECT clinic_id FROM m_clinic) OR actor_user_id IN (SELECT user_id FROM m_user)), NULL, 'append-only compliance log, never deleted'),
  (71, 'KEPT Sunrise clinic_onboarding_events about matched logins', (SELECT count(*) FROM clinic_onboarding_events WHERE clinic_id NOT IN (SELECT clinic_id FROM m_clinic) AND (subject_user_id IN (SELECT user_id FROM m_user) OR actor_user_id IN (SELECT user_id FROM m_user))), NULL, 'audit history of clinics that stay'),
  (72, 'KEPT Sunrise clinics row', (SELECT count(*) FROM clinics WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001'), NULL, 'Sunrise stays'),
  (73, 'KEPT demo clinics and pharmacies', (SELECT count(*) FROM clinics WHERE clinic_id::text LIKE 'a1000000-0000-0000-0000-%') + (SELECT count(*) FROM pharmacies WHERE pharmacy_id::text LIKE 'a4000000-0000-0000-0000-%'), NULL, 'demo data stays'),
  (74, 'KEPT Sunrise patients (not test)', (SELECT count(*) FROM patients WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001' AND patient_id NOT IN (SELECT patient_id FROM m_patient)), NULL, 'demo patients stay'),
  (75, 'KEPT Sunrise orders (not test)', (SELECT count(*) FROM orders WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001' AND order_id NOT IN (SELECT order_id FROM m_order)), NULL, 'demo orders stay'),
  (76, 'KEPT proposals (not test), with their choice items and events', (SELECT count(*) FROM treatment_proposals WHERE proposal_id NOT IN (SELECT proposal_id FROM m_proposal)) + (SELECT count(*) FROM proposal_choice_items WHERE proposal_id NOT IN (SELECT proposal_id FROM m_proposal)) + (SELECT count(*) FROM treatment_proposal_events WHERE proposal_id NOT IN (SELECT proposal_id FROM m_proposal)), NULL, 'real proposals and their append-only history stay');

-- Kept rows: the count after must equal the preview.
UPDATE cleanup_report SET expected_after = preview WHERE expected_after IS NULL;

-- Storage files (not deleted here: Supabase blocks deleting storage.objects in SQL).
INSERT INTO cleanup_report (ord, item, preview, expected_after, note)
SELECT 80, 'storage (remove via the Storage API): ' || o.bucket_id || '/' || o.name, 1, 1, 'delete in the dashboard or with the Storage API after COMMIT'
FROM storage.objects o
WHERE (o.bucket_id = 'pharmacy-license-documents' AND split_part(o.name, '/', 1) IN (SELECT pharmacy_id::text FROM m_pharmacy))
   OR (o.bucket_id = 'prescription-pdfs' AND split_part(o.name, '/', 1) = 'fax' AND split_part(o.name, '/', 2) IN (SELECT order_id::text FROM m_order))
   OR (o.bucket_id = 'adapter-screenshots' AND split_part(o.name, '/', 1) = 'portal' AND split_part(o.name, '/', 2) IN (SELECT order_id::text FROM m_order));

-- PREVIEW (result 1).
SELECT ord, item, preview AS rows_matched, note FROM cleanup_report ORDER BY ord, item;

-- ── 4. Delete, children first ───────────────────────────────────
ALTER TABLE orders DISABLE TRIGGER orders_no_delete_signed;
ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_no_update_delete;
ALTER TABLE payable_events DISABLE TRIGGER payable_events_no_update_delete;
ALTER TABLE agreement_acceptances DISABLE TRIGGER trg_agreement_acceptances_append_only;
ALTER TABLE clinic_onboarding_events DISABLE TRIGGER trg_clinic_onboarding_events_append_only;
ALTER TABLE pharmacy_agreement_acceptances DISABLE TRIGGER pharmacy_agreement_acceptances_no_update_delete;
ALTER TABLE pharmacy_onboarding_events DISABLE TRIGGER pharmacy_onboarding_events_no_update_delete;
ALTER TABLE proposal_choice_items DISABLE TRIGGER proposal_choice_items_no_update_delete;
ALTER TABLE treatment_proposal_events DISABLE TRIGGER treatment_proposal_events_no_update_delete;

-- Proposal rows that point at orders and options (append-only; matched proposals only).
DELETE FROM proposal_choice_items WHERE proposal_id IN (SELECT proposal_id FROM m_proposal);
DELETE FROM treatment_proposal_events WHERE proposal_id IN (SELECT proposal_id FROM m_proposal);

-- Order-level rows.
DELETE FROM sla_notifications_log WHERE order_id IN (SELECT order_id FROM m_order);
DELETE FROM order_sla_deadlines WHERE order_id IN (SELECT order_id FROM m_order);
DELETE FROM order_status_history WHERE order_id IN (SELECT order_id FROM m_order);
DELETE FROM order_clarifications WHERE order_id IN (SELECT order_id FROM m_order);
DELETE FROM clinic_notifications WHERE order_id IN (SELECT order_id FROM m_order) OR clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM sms_log WHERE order_id IN (SELECT order_id FROM m_order) OR patient_id IN (SELECT patient_id FROM m_patient);
DELETE FROM webhook_events WHERE order_id IN (SELECT order_id FROM m_order);
DELETE FROM transfer_failures WHERE order_id IN (SELECT order_id FROM m_order) OR clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM dispute_orders WHERE order_id IN (SELECT order_id FROM m_order) OR dispute_id IN (SELECT dispute_id FROM m_dispute);
DELETE FROM disputes WHERE dispute_id IN (SELECT dispute_id FROM m_dispute);
DELETE FROM pharmacy_webhook_events
WHERE order_id IN (SELECT order_id FROM m_order) OR submission_id IN (SELECT submission_id FROM m_submission) OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);
DELETE FROM payable_events WHERE payable_id IN (SELECT payable_id FROM m_payable);
DELETE FROM pharmacy_payables WHERE payable_id IN (SELECT payable_id FROM m_payable);
DELETE FROM ledger_entries
WHERE order_id IN (SELECT order_id FROM m_order) OR payment_group_id IN (SELECT group_id FROM m_group)
   OR clinic_id IN (SELECT clinic_id FROM m_clinic) OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);
UPDATE inbound_fax_queue SET matched_order_id = NULL WHERE matched_order_id IN (SELECT order_id FROM m_order);
UPDATE inbound_fax_queue SET matched_pharmacy_id = NULL WHERE matched_pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);
UPDATE circuit_breaker_state SET tripped_by_submission_id = NULL WHERE tripped_by_submission_id IN (SELECT submission_id FROM m_submission);
-- Orders and their adapter submissions point at each other: one statement.
WITH gone_submissions AS (
  DELETE FROM adapter_submissions WHERE submission_id IN (SELECT submission_id FROM m_submission) RETURNING 1
)
DELETE FROM orders WHERE order_id IN (SELECT order_id FROM m_order);
DELETE FROM payment_groups WHERE group_id IN (SELECT group_id FROM m_group);
-- Proposals and their options point at each other (chosen_option_id): one
-- statement, after the orders that referenced the options.
WITH gone_options AS (
  DELETE FROM treatment_proposal_options WHERE option_id IN (SELECT option_id FROM m_option) RETURNING 1
)
DELETE FROM treatment_proposals WHERE proposal_id IN (SELECT proposal_id FROM m_proposal);

-- Patients.
UPDATE patients
SET possible_duplicate_of = NULL, possible_duplicate_matched_on = NULL, possible_duplicate_flagged_at = NULL
WHERE possible_duplicate_of IN (SELECT patient_id FROM m_patient) AND patient_id NOT IN (SELECT patient_id FROM m_patient);
DELETE FROM ehr_sync_events WHERE connection_id IN (SELECT connection_id FROM m_connection) OR clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM patient_external_ids
WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic)
   OR (clinic_id = 'a1000000-0000-0000-0000-000000000001' AND system = 'keragon'
       AND (SELECT sunrise_keragon FROM m_flag));
DELETE FROM patient_field_changes WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM patient_intake_links WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM provider_favorites WHERE provider_id IN (SELECT provider_id FROM m_provider) OR patient_id IN (SELECT patient_id FROM m_patient);
DELETE FROM protocol_instances WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM patients WHERE patient_id IN (SELECT patient_id FROM m_patient);
DELETE FROM patient_import_batches WHERE batch_id IN (SELECT batch_id FROM m_batch);

-- Clinics.
DELETE FROM protocol_templates WHERE clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM onboarding_invites WHERE clinic_id IN (SELECT clinic_id FROM m_clinic) OR lower(email) IN (SELECT email FROM m_user);
DELETE FROM providers WHERE provider_id IN (SELECT provider_id FROM m_provider);
DELETE FROM clinic_onboarding_steps WHERE clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM clinic_onboarding_events WHERE clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM agreement_acceptances WHERE clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM clinic_signup_links WHERE clinic_id IN (SELECT clinic_id FROM m_clinic);
DELETE FROM ehr_connections WHERE connection_id IN (SELECT connection_id FROM m_connection);
DELETE FROM clinics WHERE clinic_id IN (SELECT clinic_id FROM m_clinic);

-- Pharmacy.
DELETE FROM pharmacy_agreement_acceptances WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) OR application_id IN (SELECT application_id FROM m_pharm_app);
DELETE FROM pharmacy_onboarding_events
WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) OR application_id IN (SELECT application_id FROM m_pharm_app) OR invite_id IN (SELECT invite_id FROM m_pharm_invite);
DELETE FROM pharmacy_onboarding_applications WHERE application_id IN (SELECT application_id FROM m_pharm_app);
DELETE FROM pharmacy_invites WHERE invite_id IN (SELECT invite_id FROM m_pharm_invite);
DELETE FROM pharmacy_state_licenses WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);
DELETE FROM catalog_history WHERE item_id IN (SELECT item_id FROM m_catalog);
-- Catalog and normalized catalog point at each other: one statement.
WITH gone_normalized AS (
  DELETE FROM normalized_catalog WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) RETURNING 1
)
DELETE FROM catalog WHERE item_id IN (SELECT item_id FROM m_catalog);
DELETE FROM catalog_upload_history WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);
DELETE FROM pharmacy_formulations WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);
-- The pharmacy and its adapter / portal configs point at each other: one statement.
WITH gone_api AS (
  DELETE FROM pharmacy_api_configs WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) RETURNING 1
), gone_portal AS (
  DELETE FROM pharmacy_portal_configs WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) RETURNING 1
)
DELETE FROM pharmacies WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy);

-- Vault secrets and logins.
DELETE FROM vault.secrets WHERE id IN (SELECT secret_id FROM m_vault);
DELETE FROM auth.refresh_tokens WHERE user_id IN (SELECT user_id::text FROM m_user);
DELETE FROM auth.users WHERE id IN (SELECT user_id FROM m_user);

ALTER TABLE orders ENABLE TRIGGER orders_no_delete_signed;
ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_no_update_delete;
ALTER TABLE payable_events ENABLE TRIGGER payable_events_no_update_delete;
ALTER TABLE agreement_acceptances ENABLE TRIGGER trg_agreement_acceptances_append_only;
ALTER TABLE clinic_onboarding_events ENABLE TRIGGER trg_clinic_onboarding_events_append_only;
ALTER TABLE pharmacy_agreement_acceptances ENABLE TRIGGER pharmacy_agreement_acceptances_no_update_delete;
ALTER TABLE pharmacy_onboarding_events ENABLE TRIGGER pharmacy_onboarding_events_no_update_delete;
ALTER TABLE proposal_choice_items ENABLE TRIGGER proposal_choice_items_no_update_delete;
ALTER TABLE treatment_proposal_events ENABLE TRIGGER treatment_proposal_events_no_update_delete;

-- ── 5. Verify (result 2, and the last result): every "after" equals "expected_after" ──
UPDATE cleanup_report r SET after = v.n
FROM (VALUES
  (1,  (SELECT count(*) FROM clinics WHERE clinic_id IN (SELECT clinic_id FROM m_clinic) OR name IN ('QA Test Clinic', 'Beta Test Practice', 'Beta Test Practice 2'))),
  (2,  (SELECT count(*) FROM pharmacies WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) OR name = 'QA Test Pharmacy')),
  (3,  (SELECT count(*) FROM auth.users WHERE id IN (SELECT user_id FROM m_user) OR lower(email) IN (SELECT email FROM m_ext_email))),
  (4,  (SELECT count(*) FROM auth.identities WHERE user_id IN (SELECT user_id FROM m_user))),
  (5,  (SELECT count(*) FROM auth.sessions WHERE user_id IN (SELECT user_id FROM m_user))),
  (6,  (SELECT count(*) FROM auth.mfa_factors WHERE user_id IN (SELECT user_id FROM m_user))),
  (7,  (SELECT count(*) FROM auth.refresh_tokens WHERE user_id IN (SELECT user_id::text FROM m_user))),
  (8,  (SELECT count(*) FROM providers WHERE provider_id IN (SELECT provider_id FROM m_provider))),
  (9,  (SELECT count(*) FROM provider_state_licenses WHERE provider_id IN (SELECT provider_id FROM m_provider))),
  (10, (SELECT count(*) FROM provider_npi_verifications WHERE provider_id IN (SELECT provider_id FROM m_provider))),
  (11, (SELECT count(*) FROM provider_favorites WHERE provider_id IN (SELECT provider_id FROM m_provider) OR patient_id IN (SELECT patient_id FROM m_patient))),
  (12, (SELECT count(*) FROM patients WHERE patient_id IN (SELECT patient_id FROM m_patient))),
  (13, (SELECT count(*) FROM patient_intake_links WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (14, (SELECT count(*) FROM patient_external_ids WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic) OR (clinic_id = 'a1000000-0000-0000-0000-000000000001' AND system = 'keragon' AND (SELECT sunrise_keragon FROM m_flag)))),
  (15, (SELECT count(*) FROM patient_field_changes WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (16, (SELECT count(*) FROM patient_import_batches WHERE batch_id IN (SELECT batch_id FROM m_batch))),
  (17, (SELECT count(*) FROM patient_protocol_phases WHERE patient_id IN (SELECT patient_id FROM m_patient))),
  (18, (SELECT count(*) FROM protocol_instances WHERE patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (19, (SELECT count(*) FROM protocol_templates WHERE clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (20, (SELECT count(*) FROM orders WHERE order_id IN (SELECT order_id FROM m_order))),
  (21, (SELECT count(*) FROM order_status_history WHERE order_id IN (SELECT order_id FROM m_order))),
  (22, (SELECT count(*) FROM order_sla_deadlines WHERE order_id IN (SELECT order_id FROM m_order))),
  (23, (SELECT count(*) FROM sla_notifications_log WHERE order_id IN (SELECT order_id FROM m_order))),
  (24, (SELECT count(*) FROM order_clarifications WHERE order_id IN (SELECT order_id FROM m_order))),
  (25, (SELECT count(*) FROM adapter_submissions WHERE submission_id IN (SELECT submission_id FROM m_submission))),
  (26, (SELECT count(*) FROM adapter_submission_debug_payloads WHERE adapter_submission_id IN (SELECT submission_id FROM m_submission))),
  (27, (SELECT count(*) FROM pharmacy_webhook_events WHERE order_id IN (SELECT order_id FROM m_order) OR submission_id IN (SELECT submission_id FROM m_submission) OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (28, (SELECT count(*) FROM webhook_events WHERE order_id IN (SELECT order_id FROM m_order))),
  (29, (SELECT count(*) FROM sms_log WHERE order_id IN (SELECT order_id FROM m_order) OR patient_id IN (SELECT patient_id FROM m_patient))),
  (30, (SELECT count(*) FROM clinic_notifications WHERE order_id IN (SELECT order_id FROM m_order) OR clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (31, (SELECT count(*) FROM disputes WHERE dispute_id IN (SELECT dispute_id FROM m_dispute))),
  (32, (SELECT count(*) FROM dispute_orders WHERE order_id IN (SELECT order_id FROM m_order) OR dispute_id IN (SELECT dispute_id FROM m_dispute))),
  (33, (SELECT count(*) FROM transfer_failures WHERE order_id IN (SELECT order_id FROM m_order) OR clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (34, (SELECT count(*) FROM payment_groups WHERE group_id IN (SELECT group_id FROM m_group))),
  (35, (SELECT count(*) FROM ledger_entries WHERE order_id IN (SELECT order_id FROM m_order) OR payment_group_id IN (SELECT group_id FROM m_group) OR clinic_id IN (SELECT clinic_id FROM m_clinic) OR pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (36, (SELECT count(*) FROM pharmacy_payables WHERE payable_id IN (SELECT payable_id FROM m_payable))),
  (37, (SELECT count(*) FROM payable_events WHERE payable_id IN (SELECT payable_id FROM m_payable))),
  (38, (SELECT count(*) FROM onboarding_invites WHERE clinic_id IN (SELECT clinic_id FROM m_clinic) OR lower(email) IN (SELECT email FROM m_user))),
  (39, (SELECT count(*) FROM clinic_onboarding_steps WHERE clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (40, (SELECT count(*) FROM clinic_onboarding_events WHERE clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (41, (SELECT count(*) FROM agreement_acceptances WHERE clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (42, (SELECT count(*) FROM clinic_signup_links WHERE clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (43, (SELECT count(*) FROM ehr_connections WHERE connection_id IN (SELECT connection_id FROM m_connection) OR (clinic_id = 'a1000000-0000-0000-0000-000000000001' AND provider = 'keragon'))),
  (44, (SELECT count(*) FROM ehr_sync_events WHERE connection_id IN (SELECT connection_id FROM m_connection) OR clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (45, (SELECT count(*) FROM vault.secrets WHERE id IN (SELECT secret_id FROM m_vault))),
  (46, (SELECT count(*) FROM pharmacy_onboarding_applications WHERE application_id IN (SELECT application_id FROM m_pharm_app))),
  (47, (SELECT count(*) FROM pharmacy_invites WHERE invite_id IN (SELECT invite_id FROM m_pharm_invite) OR pharmacy_name = 'QA Test Pharmacy')),
  (48, (SELECT count(*) FROM pharmacy_agreement_acceptances WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) OR application_id IN (SELECT application_id FROM m_pharm_app))),
  (49, (SELECT count(*) FROM pharmacy_onboarding_events WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy) OR application_id IN (SELECT application_id FROM m_pharm_app) OR invite_id IN (SELECT invite_id FROM m_pharm_invite))),
  (50, (SELECT count(*) FROM pharmacy_state_licenses WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (51, (SELECT count(*) FROM pharmacy_api_configs WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (52, (SELECT count(*) FROM pharmacy_portal_configs WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (53, (SELECT count(*) FROM pharmacy_formulations WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (54, (SELECT count(*) FROM catalog WHERE item_id IN (SELECT item_id FROM m_catalog)) + (SELECT count(*) FROM normalized_catalog WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (55, (SELECT count(*) FROM catalog_upload_history WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (56, (SELECT count(*) FROM circuit_breaker_state WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (60, (SELECT count(*) FROM inbound_fax_queue WHERE matched_order_id IN (SELECT order_id FROM m_order) OR matched_pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (61, (SELECT count(*) FROM patients WHERE possible_duplicate_of IN (SELECT patient_id FROM m_patient))),
  (66, (SELECT count(*) FROM protocol_items WHERE pharmacy_id IN (SELECT pharmacy_id FROM m_pharmacy))),
  (67, (SELECT count(*) FROM protocol_template_versions WHERE published_by IN (SELECT provider_id FROM m_provider))),
  (68, (SELECT count(*) FROM treatment_proposal_options o WHERE o.protocol_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM protocol_templates t WHERE t.protocol_id = o.protocol_id))),
  (62, (SELECT count(*) FROM treatment_proposals WHERE proposal_id IN (SELECT proposal_id FROM m_proposal) OR patient_id IN (SELECT patient_id FROM m_patient) OR clinic_id IN (SELECT clinic_id FROM m_clinic))),
  (63, (SELECT count(*) FROM treatment_proposal_options WHERE option_id IN (SELECT option_id FROM m_option) OR proposal_id IN (SELECT proposal_id FROM m_proposal))),
  (64, (SELECT count(*) FROM proposal_choice_items WHERE proposal_id IN (SELECT proposal_id FROM m_proposal) OR order_id IN (SELECT order_id FROM m_order))),
  (65, (SELECT count(*) FROM treatment_proposal_events WHERE proposal_id IN (SELECT proposal_id FROM m_proposal))),
  (70, (SELECT count(*) FROM phi_access_log WHERE patient_id IN (SELECT patient_id FROM m_patient) OR order_id IN (SELECT order_id FROM m_order) OR clinic_id IN (SELECT clinic_id FROM m_clinic) OR actor_user_id IN (SELECT user_id FROM m_user))),
  (71, (SELECT count(*) FROM clinic_onboarding_events WHERE clinic_id NOT IN (SELECT clinic_id FROM m_clinic) AND (subject_user_id IN (SELECT user_id FROM m_user) OR actor_user_id IN (SELECT user_id FROM m_user)))),
  (72, (SELECT count(*) FROM clinics WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001')),
  (73, (SELECT count(*) FROM clinics WHERE clinic_id::text LIKE 'a1000000-0000-0000-0000-%') + (SELECT count(*) FROM pharmacies WHERE pharmacy_id::text LIKE 'a4000000-0000-0000-0000-%')),
  (74, (SELECT count(*) FROM patients WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001' AND patient_id NOT IN (SELECT patient_id FROM m_patient))),
  (75, (SELECT count(*) FROM orders WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001' AND order_id NOT IN (SELECT order_id FROM m_order))),
  (76, (SELECT count(*) FROM treatment_proposals WHERE proposal_id NOT IN (SELECT proposal_id FROM m_proposal)) + (SELECT count(*) FROM proposal_choice_items WHERE proposal_id NOT IN (SELECT proposal_id FROM m_proposal)) + (SELECT count(*) FROM treatment_proposal_events WHERE proposal_id NOT IN (SELECT proposal_id FROM m_proposal)))
) AS v(ord, n)
WHERE r.ord = v.ord;
-- Storage rows are not deleted here: still present (1) until removed via the Storage API.
UPDATE cleanup_report SET after = 1 WHERE ord = 80;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(item || ' = ' || after || ' (expected ' || expected_after || ')', '; ') INTO bad
  FROM cleanup_report WHERE after IS DISTINCT FROM expected_after;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'verification failed, nothing kept: %', bad; END IF;
END $$;

-- REPORT (the last result): preview and verification side by side.
SELECT ord, item, preview AS rows_matched, after AS rows_after, expected_after, note
FROM cleanup_report ORDER BY ord, item;

COMMIT;
