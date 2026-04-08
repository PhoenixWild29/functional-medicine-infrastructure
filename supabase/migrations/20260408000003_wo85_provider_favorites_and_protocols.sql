-- ============================================================
-- WO-85: Provider Favorites + Clinic Protocol Templates
-- ============================================================
-- Layer 2 speed features: one-click reorder, multi-medication
-- protocol bundles, adaptive shortlist from prescribing history.

-- ── Provider Favorites ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS provider_favorites (
  favorite_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        UUID NOT NULL REFERENCES providers(provider_id) ON DELETE CASCADE,
  formulation_id     UUID NOT NULL REFERENCES formulations(formulation_id) ON DELETE CASCADE,
  pharmacy_id        UUID REFERENCES pharmacies(pharmacy_id) ON DELETE SET NULL,
  label              TEXT NOT NULL,
  dose_amount        TEXT,
  dose_unit          TEXT,
  frequency_code     TEXT,
  timing_code        TEXT,
  duration_code      TEXT,
  sig_mode           TEXT DEFAULT 'standard' CHECK (sig_mode IN ('standard', 'titration', 'cycling')),
  sig_text           TEXT,
  default_quantity   TEXT,
  default_refills    INTEGER DEFAULT 0,
  use_count          INTEGER DEFAULT 0,
  last_used_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_provider_favorites_provider ON provider_favorites(provider_id);
CREATE INDEX idx_provider_favorites_use_count ON provider_favorites(provider_id, use_count DESC);

ALTER TABLE provider_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read favorites"
  ON provider_favorites FOR SELECT TO authenticated
  USING (
    provider_id IN (
      SELECT provider_id FROM providers
      WHERE clinic_id = (
        SELECT (raw_user_meta_data->>'clinic_id')::uuid
        FROM auth.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Service role full access to favorites"
  ON provider_favorites FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Protocol Templates ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS protocol_templates (
  protocol_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            UUID NOT NULL REFERENCES clinics(clinic_id) ON DELETE CASCADE,
  created_by           UUID REFERENCES providers(provider_id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  description          TEXT,
  therapeutic_category TEXT,
  total_duration_weeks INTEGER,
  is_active            BOOLEAN DEFAULT true,
  use_count            INTEGER DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_protocol_templates_clinic ON protocol_templates(clinic_id);
CREATE INDEX idx_protocol_templates_active ON protocol_templates(clinic_id, is_active) WHERE is_active = true;

ALTER TABLE protocol_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read clinic protocols"
  ON protocol_templates FOR SELECT TO authenticated
  USING (
    clinic_id = (
      SELECT (raw_user_meta_data->>'clinic_id')::uuid
      FROM auth.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to protocols"
  ON protocol_templates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Protocol Items (medications within a protocol) ──────────

CREATE TABLE IF NOT EXISTS protocol_items (
  item_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id          UUID NOT NULL REFERENCES protocol_templates(protocol_id) ON DELETE CASCADE,
  formulation_id       UUID NOT NULL REFERENCES formulations(formulation_id) ON DELETE CASCADE,
  pharmacy_id          UUID REFERENCES pharmacies(pharmacy_id) ON DELETE SET NULL,
  phase_name           TEXT,
  phase_start_week     INTEGER,
  phase_end_week       INTEGER,
  dose_amount          TEXT,
  dose_unit            TEXT,
  frequency_code       TEXT,
  timing_code          TEXT,
  sig_mode             TEXT DEFAULT 'standard' CHECK (sig_mode IN ('standard', 'titration', 'cycling')),
  sig_text             TEXT,
  default_quantity     TEXT,
  default_refills      INTEGER DEFAULT 0,
  is_conditional       BOOLEAN DEFAULT false,
  condition_description TEXT,
  sort_order           INTEGER DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_protocol_items_protocol ON protocol_items(protocol_id, sort_order);

ALTER TABLE protocol_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read protocol items"
  ON protocol_items FOR SELECT TO authenticated
  USING (
    protocol_id IN (
      SELECT protocol_id FROM protocol_templates
      WHERE clinic_id = (
        SELECT (raw_user_meta_data->>'clinic_id')::uuid
        FROM auth.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Service role full access to protocol items"
  ON protocol_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Prescribing History View (for adaptive shortlist) ───────
-- Aggregates from orders table to find provider's most-used formulations.
-- Extracts medication_name from the JSON medication_snapshot.

CREATE OR REPLACE VIEW provider_prescribing_history AS
SELECT
  o.provider_id,
  COALESCE(o.medication_snapshot->>'medication_name', o.medication_snapshot->>'name', 'Unknown') AS medication_name,
  o.catalog_item_id,
  COUNT(*)::INTEGER AS prescription_count,
  MAX(o.created_at) AS last_prescribed_at
FROM orders o
WHERE o.status NOT IN ('CANCELLED')
GROUP BY o.provider_id, o.medication_snapshot->>'medication_name', o.medication_snapshot->>'name', o.catalog_item_id;
