-- ============================================================
-- WO-107: who may see the clinic practice dashboard
-- ============================================================
--
-- /practice (script volume, billing and margin for one clinic, plus the
-- needs-attention queue) is the clinic admin's. The admin can open it to
-- the clinic's providers with a toggle in Settings -> Clinic Profile.
--
-- A column on clinics, beside the clinic's other settings
-- (absorb_shipping, default_markup_pct), rather than the separate
-- clinic_settings table the first draft of the WO named: there is no such
-- table. Default false: nothing changes for any clinic until its admin
-- turns it on.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS practice_dashboard_visible_to_providers BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN clinics.practice_dashboard_visible_to_providers IS
  'WO-107: false (default) = only the clinic admin sees /practice; true = the clinic''s providers see it too.';
