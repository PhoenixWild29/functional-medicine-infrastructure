-- ============================================================
-- Demo payouts for approved portal clinics (2026-10-23)
-- ============================================================
--
-- Ordering opens on approval. From this change, ops approval gives a clinic
-- with no Stripe Connect account a demo payout placeholder like Sunrise's
-- (DEMO_PAYOUTS_ON_APPROVAL). This script does the same once for portal
-- clinics approved before it: approved, not deleted, signed up on their own
-- or invited through a clinic-admin invite, with no Connect account.
--
--   - Each clinic gets its own id, 'poc_placeholder_<clinic_id>':
--     stripe_connect_account_id is UNIQUE and Sunrise holds the bare
--     'poc_placeholder'. Checkout treats both forms as the platform's own
--     account (no Connect routing).
--   - Never overwrites a real Connect account id (only NULL or empty).
--   - Idempotent: a second run updates 0 rows.
--   - Touches nothing else. Run in the Supabase SQL editor.
--
-- Expected: the UPDATE reports the number of such clinics (0 on a re-run);
-- the check query at the end returns 0 rows.

BEGIN;

UPDATE clinics c
   SET stripe_connect_account_id = 'poc_placeholder_' || c.clinic_id,
       stripe_connect_status = 'ACTIVE',
       updated_at = now()
 WHERE c.onboarding_status = 'approved'
   AND c.deleted_at IS NULL
   AND (c.stripe_connect_account_id IS NULL OR c.stripe_connect_account_id = '')
   AND (c.signup_source = 'self_serve' OR EXISTS (SELECT 1 FROM onboarding_invites i WHERE i.clinic_id = c.clinic_id AND i.kind = 'clinic_admin'));

COMMIT;

-- Check: approved portal clinics left with no payout account, or with a
-- demo placeholder but not ACTIVE. Expect 0 rows. (A clinic with a real
-- Connect account still finishing Stripe setup is not this script's to
-- change.)
SELECT c.clinic_id, c.name, c.stripe_connect_account_id, c.stripe_connect_status
  FROM clinics c
 WHERE c.onboarding_status = 'approved'
   AND c.deleted_at IS NULL
   AND (c.signup_source = 'self_serve' OR EXISTS (SELECT 1 FROM onboarding_invites i WHERE i.clinic_id = c.clinic_id AND i.kind = 'clinic_admin'))
   AND (c.stripe_connect_account_id IS NULL OR c.stripe_connect_account_id = ''
        OR ((c.stripe_connect_account_id = 'poc_placeholder' OR c.stripe_connect_account_id LIKE 'poc\_placeholder\_%') AND c.stripe_connect_status <> 'ACTIVE'));
