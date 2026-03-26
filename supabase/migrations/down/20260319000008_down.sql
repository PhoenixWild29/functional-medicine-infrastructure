-- DOWN: 20260319000008_wo30_clinic_admin.sql
-- Drops the soft-delete DENY RLS policies added to orders, patients, providers, clinics.

DROP POLICY IF EXISTS orders_deny_delete    ON orders;
DROP POLICY IF EXISTS patients_deny_delete  ON patients;
DROP POLICY IF EXISTS providers_deny_delete ON providers;
DROP POLICY IF EXISTS clinics_deny_delete   ON clinics;
