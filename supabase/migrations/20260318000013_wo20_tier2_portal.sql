-- ============================================================
-- WO-20: Tier 2 Portal Automation — DB additions
-- ============================================================
--
-- Creates the adapter-screenshots Supabase Storage bucket (REQ-PTA-005).
-- Adds a selectors column to pharmacy_portal_configs for fine-grained
-- Playwright CSS selector overrides beyond login_selector/order_form_selector.
--
-- 72-hour screenshot retention is enforced by the screenshot-cleanup cron
-- (/api/cron/screenshot-cleanup, every hour) since Supabase Storage
-- does not natively support per-object TTL without enterprise plans.

-- ── adapter-screenshots storage bucket (REQ-PTA-005) ─────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'adapter-screenshots',
  'adapter-screenshots',
  false,                    -- non-public: ops_admin + service_role only
  10485760,                 -- 10 MB limit per screenshot
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS: block all authenticated reads — service_role bypasses RLS
CREATE POLICY "adapter-screenshots: deny authenticated access"
  ON storage.objects
  AS RESTRICTIVE
  TO authenticated
  USING (bucket_id = 'adapter-screenshots' AND false)
  WITH CHECK (false);

-- ── pharmacy_portal_configs: add selectors column ─────────────
-- Stores a unified JSONB map of named selectors for the portal, used
-- by submit_flow and status_check_flow steps to avoid hardcoding.
ALTER TABLE pharmacy_portal_configs
  ADD COLUMN IF NOT EXISTS selectors JSONB;
