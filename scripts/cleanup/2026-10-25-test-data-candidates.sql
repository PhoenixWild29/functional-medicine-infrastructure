-- ============================================================
-- CompoundIQ: test-data candidates on prod (read only), 2026-10-25
-- ============================================================
--
-- Run BEFORE 2026-10-24-test-data-cleanup.sql, as postgres, in the
-- Supabase SQL editor. It changes nothing (a READ ONLY transaction that
-- rolls back).
--
-- The cleanup script matches exact names and emails only. Test data
-- created on prod after it was written (another Beta login, a new QA
-- patient or clinic) is not matched until its exact value is added there.
-- This query lists the rows that LOOK like test data by the stable
-- prefixes used so far (QA..., Beta Test..., beta-test-...@), and says
-- whether the cleanup already matches each one. For every row with
-- matched_by_cleanup = false that Lauren confirms is test data, add its
-- exact name or email to the match section of the cleanup script (and
-- raise cleanup_expect if needed). Never add the prefix itself.

BEGIN TRANSACTION READ ONLY;

WITH exact_clinics(name) AS (VALUES ('QA Test Clinic'), ('Beta Test Practice'), ('Beta Test Practice 2')),
     exact_emails(email) AS (VALUES ('beta-test-provider@sunrise-clinic.com'), ('beta-test-provider2@sunrise-clinic.com'), ('beta-test-ma@sunrise-clinic.com')),
     exact_patients(first_name, last_name) AS (VALUES ('Intake', 'Test'), ('QAImport', 'Alpha'), ('QAImport', 'Bravo'), ('QAImport', 'Charlie'), ('QAKeragon', 'Echo'))
SELECT 'clinic' AS kind, c.clinic_id::text AS id, c.name AS value, NULL::text AS clinic,
       c.name IN (SELECT name FROM exact_clinics) AS matched_by_cleanup
FROM clinics c
WHERE c.name ILIKE 'QA %' OR c.name ILIKE 'QA-%' OR c.name ILIKE 'Beta Test%'
UNION ALL
SELECT 'pharmacy', p.pharmacy_id::text, p.name, NULL, p.name = 'QA Test Pharmacy'
FROM pharmacies p
WHERE p.name ILIKE 'QA %' OR p.name ILIKE 'QA-%' OR p.name ILIKE 'Beta Test%'
UNION ALL
SELECT 'login', u.id::text, lower(u.email), u.raw_app_meta_data->>'clinic_id',
       coalesce(lower(u.email) IN (SELECT email FROM exact_emails)
         OR u.raw_app_meta_data->>'clinic_id' IN (SELECT clinic_id::text FROM clinics WHERE name IN (SELECT name FROM exact_clinics))
         OR u.raw_app_meta_data->>'pharmacy_id' IN (SELECT pharmacy_id::text FROM pharmacies WHERE name = 'QA Test Pharmacy'), false)
FROM auth.users u
WHERE u.email ILIKE 'beta-test%' OR u.email ILIKE 'qa%'
UNION ALL
SELECT 'patient', pt.patient_id::text, pt.first_name || ' ' || pt.last_name, pt.clinic_id::text,
       (pt.clinic_id = 'a1000000-0000-0000-0000-000000000001'
        AND ((pt.first_name, pt.last_name) IN (SELECT first_name, last_name FROM exact_patients)
          OR (pt.last_name, pt.first_name) IN (SELECT first_name, last_name FROM exact_patients)))
       OR pt.clinic_id IN (SELECT clinic_id FROM clinics WHERE name IN (SELECT name FROM exact_clinics))
FROM patients pt
WHERE pt.first_name ILIKE 'QA%' OR pt.last_name ILIKE 'QA%'
   OR (pt.first_name = 'Intake' AND pt.last_name = 'Test') OR (pt.first_name = 'Test' AND pt.last_name = 'Intake')
   OR pt.first_name ILIKE 'Beta Test%' OR pt.last_name ILIKE 'Beta Test%'
UNION ALL
SELECT 'provider', pr.provider_id::text, pr.first_name || ' ' || pr.last_name, pr.clinic_id::text,
       pr.clinic_id IN (SELECT clinic_id FROM clinics WHERE name IN (SELECT name FROM exact_clinics))
FROM providers pr
WHERE pr.first_name ILIKE 'QA%' OR pr.last_name ILIKE 'QA%' OR pr.first_name ILIKE 'Beta Test%'
ORDER BY matched_by_cleanup, kind, value;

ROLLBACK;
