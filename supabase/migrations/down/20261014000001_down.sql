-- Down migration for 20261014000001_pharmacy_onboarding.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- WARNING: drops the invites, applications, the BAA / terms acceptance
-- record and the onboarding event log, with every row in them. Export
-- pharmacy_agreement_acceptances and pharmacy_onboarding_events first on
-- any database where a pharmacy has signed. Pharmacies created through
-- the portal stay (inactive unless approved); their onboarding columns
-- go. The license-documents bucket is removed only when empty.
-- Re-granting SELECT on the three owner-rights views restores the prior
-- (over-broad) access; leave that line out unless a reader needs it.

BEGIN;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'pharmacy_admin_scope' LOOP
    EXECUTE format('DROP POLICY IF EXISTS pharmacy_admin_scope ON public.%I', t.tablename);
  END LOOP;
END $$;

GRANT SELECT ON webhook_dead_letter_queue TO authenticated;
GRANT SELECT ON pharmacy_webhook_dead_letter_queue TO authenticated;
GRANT SELECT ON provider_prescribing_history TO authenticated;

ALTER TABLE sla_notifications_log DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharmacies_pharmacy_admin_own ON pharmacies;
DROP POLICY IF EXISTS pharmacy_state_licenses_pharmacy_admin_own ON pharmacy_state_licenses;

DELETE FROM storage.buckets b
 WHERE b.id = 'pharmacy-license-documents'
   AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = b.id);

DROP TRIGGER IF EXISTS pharmacy_onboarding_events_no_truncate ON pharmacy_onboarding_events;
DROP TRIGGER IF EXISTS pharmacy_onboarding_events_no_update_delete ON pharmacy_onboarding_events;
DROP TABLE IF EXISTS pharmacy_onboarding_events;
DROP TRIGGER IF EXISTS pharmacy_agreement_acceptances_no_truncate ON pharmacy_agreement_acceptances;
DROP TRIGGER IF EXISTS pharmacy_agreement_acceptances_no_update_delete ON pharmacy_agreement_acceptances;
DROP TABLE IF EXISTS pharmacy_agreement_acceptances;
DROP FUNCTION IF EXISTS pharmacy_onboarding_append_only();
DROP TABLE IF EXISTS pharmacy_onboarding_applications;
DROP TABLE IF EXISTS pharmacy_invites;

ALTER TABLE pharmacy_state_licenses DROP CONSTRAINT IF EXISTS chk_psl_unverified_inactive;
ALTER TABLE pharmacy_state_licenses DROP CONSTRAINT IF EXISTS chk_psl_verification_note;
ALTER TABLE pharmacy_state_licenses DROP CONSTRAINT IF EXISTS chk_psl_verification_status;
ALTER TABLE pharmacy_state_licenses DROP COLUMN IF EXISTS verification_note;
ALTER TABLE pharmacy_state_licenses DROP COLUMN IF EXISTS document_path;
ALTER TABLE pharmacy_state_licenses DROP COLUMN IF EXISTS verified_by;
ALTER TABLE pharmacy_state_licenses DROP COLUMN IF EXISTS verified_at;
ALTER TABLE pharmacy_state_licenses DROP COLUMN IF EXISTS verification_status;

ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_onboarding_inactive;
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_onboarding_status;
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_ship_to_states;
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_dea;
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_npi;
ALTER TABLE pharmacies DROP CONSTRAINT IF EXISTS chk_pharmacies_ncpdp;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS onboarding_status;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS order_cutoff_local;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS ship_to_states;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS ships_cold_chain;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS ship_carriers;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS dea_number;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS npi;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS ncpdp_id;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS dba_name;
ALTER TABLE pharmacies DROP COLUMN IF EXISTS legal_name;

COMMIT;
