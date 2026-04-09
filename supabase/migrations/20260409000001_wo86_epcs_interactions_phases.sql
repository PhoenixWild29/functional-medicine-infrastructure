-- ============================================================
-- WO-86: EPCS 2FA + Drug Interactions + Phase Management
-- ============================================================
-- Layer 3 compliance features: EPCS audit trail, drug interaction
-- data, patient protocol phase tracking.

-- ── EPCS Audit Log ──────────────────────────────────────────
-- Immutable record of every EPCS event per DEA 21 CFR 1311.
-- 2-year retention in sortable, searchable format.

CREATE TABLE IF NOT EXISTS epcs_audit_log (
  audit_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID REFERENCES orders(order_id) ON DELETE SET NULL,
  provider_id      UUID NOT NULL REFERENCES providers(provider_id),
  patient_id       UUID REFERENCES patients(patient_id),
  event_type       TEXT NOT NULL CHECK (event_type IN (
    'PRESCRIPTION_CREATED',
    'PRESCRIPTION_ALTERED',
    'PRE_SIGN_REVIEW',
    'TOTP_CHALLENGE_SENT',
    'TOTP_VERIFIED',
    'TOTP_FAILED',
    'SIGNATURE_CAPTURED',
    'ORDER_SIGNED',
    'ORDER_TRANSMITTED',
    'ORDER_VOIDED'
  )),
  dea_schedule     INTEGER NOT NULL,
  medication_name  TEXT NOT NULL,
  details          JSONB DEFAULT '{}',
  ip_address       TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_epcs_audit_provider ON epcs_audit_log(provider_id, created_at DESC);
CREATE INDEX idx_epcs_audit_order ON epcs_audit_log(order_id);
CREATE INDEX idx_epcs_audit_event ON epcs_audit_log(event_type, created_at DESC);

ALTER TABLE epcs_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "epcs_audit_read" ON epcs_audit_log FOR SELECT TO authenticated
  USING (
    provider_id IN (
      SELECT provider_id FROM providers
      WHERE clinic_id = (
        SELECT (raw_user_meta_data->>'clinic_id')::uuid
        FROM auth.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "epcs_audit_service" ON epcs_audit_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── TOTP secret on providers ────────────────────────────────
-- Encrypted TOTP seed for authenticator app (Google Auth, Authy).
-- Only providers with DEA registrations need this.

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ;

-- ── Drug Interactions ───────────────────────────────────────
-- Known interaction pairs between ingredients.

CREATE TABLE IF NOT EXISTS drug_interactions (
  interaction_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_a_id  UUID NOT NULL REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
  ingredient_b_id  UUID NOT NULL REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
  severity         TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  description      TEXT NOT NULL,
  clinical_note    TEXT,
  source           TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_interaction_pair UNIQUE (ingredient_a_id, ingredient_b_id),
  CONSTRAINT no_self_interaction CHECK (ingredient_a_id != ingredient_b_id)
);

CREATE INDEX idx_drug_interactions_a ON drug_interactions(ingredient_a_id);
CREATE INDEX idx_drug_interactions_b ON drug_interactions(ingredient_b_id);

ALTER TABLE drug_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drug_interactions_read" ON drug_interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "drug_interactions_service" ON drug_interactions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Patient Protocol Phases ─────────────────────────────────
-- Tracks which phase each patient is in for each protocol.

CREATE TABLE IF NOT EXISTS patient_protocol_phases (
  tracking_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id       UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  protocol_id      UUID NOT NULL REFERENCES protocol_templates(protocol_id) ON DELETE CASCADE,
  current_phase    TEXT NOT NULL,
  phase_started_at TIMESTAMPTZ DEFAULT now(),
  advanced_by      UUID REFERENCES providers(provider_id),
  advancement_note TEXT,
  status           TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'discontinued')),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT unique_patient_protocol UNIQUE (patient_id, protocol_id)
);

CREATE INDEX idx_patient_protocol_patient ON patient_protocol_phases(patient_id);
CREATE INDEX idx_patient_protocol_status ON patient_protocol_phases(status) WHERE status = 'active';

ALTER TABLE patient_protocol_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patient_protocol_read" ON patient_protocol_phases FOR SELECT TO authenticated
  USING (
    patient_id IN (
      SELECT patient_id FROM patients
      WHERE clinic_id = (
        SELECT (raw_user_meta_data->>'clinic_id')::uuid
        FROM auth.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "patient_protocol_service" ON patient_protocol_phases FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Phase Advancement History ───────────────────────────────
-- Immutable log of every phase change for audit trail.

CREATE TABLE IF NOT EXISTS phase_advancement_history (
  history_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id      UUID NOT NULL REFERENCES patient_protocol_phases(tracking_id) ON DELETE CASCADE,
  from_phase       TEXT NOT NULL,
  to_phase         TEXT NOT NULL,
  advanced_by      UUID REFERENCES providers(provider_id),
  reason           TEXT,
  lab_results      JSONB,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_phase_history_tracking ON phase_advancement_history(tracking_id, created_at DESC);

ALTER TABLE phase_advancement_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "phase_history_read" ON phase_advancement_history FOR SELECT TO authenticated
  USING (
    tracking_id IN (
      SELECT tracking_id FROM patient_protocol_phases
      WHERE patient_id IN (
        SELECT patient_id FROM patients
        WHERE clinic_id = (
          SELECT (raw_user_meta_data->>'clinic_id')::uuid
          FROM auth.users WHERE id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "phase_history_service" ON phase_advancement_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);
