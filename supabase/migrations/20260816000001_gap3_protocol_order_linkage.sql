-- ============================================================
-- GAP-3: Protocol → Order linkage (pilot instrumentation)
-- ============================================================
-- Closes the three validation gates that currently have no data
-- path: protocol reuse, pharmacy clarification rate by protocol
-- version, and 90-day repeat use.
--
-- Problem: orders carry no reference to the protocol that produced
-- them, so after the pilot there is no way to join an order back to
-- clinical intent. This cannot be backfilled — an order written
-- without the link cannot be reattributed later — so it has to land
-- before the first pilot order.
--
-- Scope note: this is instrumentation only. The titration dose-step
-- model (protocol_dose_steps, protocol_step_conditions, dose_responses)
-- is a separate, larger change and is deliberately NOT included here.
-- orders.protocol_step_id is therefore also deferred.
--
-- patient_protocol_phases is left ENTIRELY untouched. Its
-- unique_patient_protocol constraint does block a patient from
-- re-running a protocol, but POST /api/patient-phases upserts with
-- onConflict 'patient_id,protocol_id' and would break at runtime if
-- it were dropped. protocol_instances below supports cycling natively
-- via cycle_number, so the old table can keep its constraint until it
-- is retired in the backfill/dual-write change.

-- ── Protocol template versions ──────────────────────────────
-- protocol_templates stays the editable working surface; a version
-- is an immutable snapshot. Needed so clarification rate can be
-- tracked "by protocol version" rather than in aggregate.

CREATE TABLE IF NOT EXISTS protocol_template_versions (
  version_id       UUID NOT NULL DEFAULT gen_random_uuid(),
  protocol_id      UUID NOT NULL REFERENCES protocol_templates(protocol_id) ON DELETE CASCADE,
  version_number   INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'published', 'retired')),
  published_at     TIMESTAMPTZ,
  published_by     UUID REFERENCES providers(provider_id) ON DELETE SET NULL,
  change_note      TEXT,
  intent_snapshot  JSONB NOT NULL DEFAULT '{}',
  intent_hash      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id),
  CONSTRAINT uq_protocol_version UNIQUE (protocol_id, version_number),
  -- Composite target so protocol_instances can enforce that a version
  -- actually belongs to the protocol it is attached to.
  CONSTRAINT uq_ptv_protocol_version UNIQUE (protocol_id, version_id),
  CONSTRAINT positive_version CHECK (version_number > 0)
);

CREATE INDEX IF NOT EXISTS idx_ptv_protocol
  ON protocol_template_versions(protocol_id, version_number DESC);

-- At most one published version per protocol at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ptv_one_published
  ON protocol_template_versions(protocol_id) WHERE status = 'published';

ALTER TABLE protocol_template_versions ENABLE ROW LEVEL SECURITY;

-- JWT path convention: per 20260329000001 / 20260329000002 / 20260611000004,
-- clinic claims live under user_metadata and are read from the JWT, never by
-- selecting auth.users (authenticated has no SELECT grant on that table).
DROP POLICY IF EXISTS "Authenticated users can read protocol versions" ON protocol_template_versions;
CREATE POLICY "Authenticated users can read protocol versions"
  ON protocol_template_versions FOR SELECT TO authenticated
  USING (
    protocol_id IN (
      SELECT protocol_id FROM protocol_templates
      WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
    )
  );

DROP POLICY IF EXISTS "Service role full access to protocol versions" ON protocol_template_versions;
CREATE POLICY "Service role full access to protocol versions"
  ON protocol_template_versions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Protocol instances ──────────────────────────────────────
-- "Patient X is on protocol Y, cycle N, pinned to version Z."
-- Supersedes patient_protocol_phases; backfill and dual-write before
-- retiring that table. cycle_number is what makes cycling protocols
-- expressible — an explicit sig_mode value that the old table's
-- UNIQUE (patient_id, protocol_id) made impossible.

CREATE TABLE IF NOT EXISTS protocol_instances (
  instance_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
  provider_id        UUID NOT NULL REFERENCES providers(provider_id),
  clinic_id          UUID NOT NULL REFERENCES clinics(clinic_id),
  protocol_id        UUID NOT NULL REFERENCES protocol_templates(protocol_id) ON DELETE CASCADE,
  version_id         UUID NOT NULL REFERENCES protocol_template_versions(version_id),
  cycle_number       INTEGER NOT NULL DEFAULT 1,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at           TIMESTAMPTZ,
  last_activity_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'paused', 'completed', 'discontinued')),
  individualization  JSONB NOT NULL DEFAULT '{}',
  discontinue_reason TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_patient_protocol_cycle UNIQUE (patient_id, protocol_id, cycle_number),
  CONSTRAINT positive_cycle CHECK (cycle_number > 0),
  -- last_activity_at is the sole input to the 90-day retention gate;
  -- a future or pre-start value would make that metric nonsense.
  CONSTRAINT activity_after_start CHECK (last_activity_at >= started_at),
  -- The pinned version must belong to the pinned protocol.
  CONSTRAINT fk_instance_protocol_version
    FOREIGN KEY (protocol_id, version_id)
    REFERENCES protocol_template_versions(protocol_id, version_id)
);

CREATE INDEX IF NOT EXISTS idx_instances_patient ON protocol_instances(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_instances_clinic_active ON protocol_instances(clinic_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_instances_version ON protocol_instances(version_id);

ALTER TABLE protocol_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read clinic protocol instances" ON protocol_instances;
CREATE POLICY "Authenticated users can read clinic protocol instances"
  ON protocol_instances FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS "Service role full access to protocol instances" ON protocol_instances;
CREATE POLICY "Service role full access to protocol instances"
  ON protocol_instances FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- updated_at maintenance, matching the set_updated_at() convention
-- established in 20260317000004 and still in use at 20260609000001.
DROP TRIGGER IF EXISTS set_updated_at_protocol_instances ON protocol_instances;
CREATE TRIGGER set_updated_at_protocol_instances
  BEFORE UPDATE ON protocol_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Order → protocol linkage ────────────────────────────────
-- Both nullable. Ad-hoc single prescriptions stay first class and
-- most orders will not belong to a protocol, especially early.
--
-- protocol_version_id is recorded independently of the instance's
-- current version ON PURPOSE: it is the version the order was
-- compiled from. If an instance is later migrated to a newer version,
-- historical orders must keep pointing at what was actually sent.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS protocol_instance_id UUID REFERENCES protocol_instances(instance_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS protocol_version_id  UUID REFERENCES protocol_template_versions(version_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_protocol_instance ON orders(protocol_instance_id)
  WHERE protocol_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_protocol_version ON orders(protocol_version_id)
  WHERE protocol_version_id IS NOT NULL;

-- ── Order clarifications ────────────────────────────────────
-- Pharmacy sends an order back for rewrite or clarification. Recorded
-- as discrete events so the rate can be computed per protocol version
-- and watched for decline as the protocol model improves.

CREATE TABLE IF NOT EXISTS order_clarifications (
  clarification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         UUID NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  source           TEXT NOT NULL DEFAULT 'pharmacy'
                   CHECK (source IN ('pharmacy', 'ops', 'system')),
  reason_code      TEXT NOT NULL CHECK (reason_code IN (
    'DOSE_UNCLEAR',
    'SIG_UNCLEAR',
    'FORMULATION_UNAVAILABLE',
    'QUANTITY_INVALID',
    'PATIENT_INFO_MISSING',
    'PRESCRIBER_INFO_MISSING',
    'STATE_LICENSURE',
    'CONTROLLED_SUBSTANCE',
    'PRICING_DISPUTE',
    'DUPLICATE_THERAPY',
    'OTHER'
  )),
  detail           TEXT,
  raised_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at      TIMESTAMPTZ,
  resolved_by      UUID REFERENCES providers(provider_id) ON DELETE SET NULL,
  required_rewrite BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clarifications_order ON order_clarifications(order_id);
CREATE INDEX IF NOT EXISTS idx_clarifications_open ON order_clarifications(raised_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clarifications_reason ON order_clarifications(reason_code, raised_at DESC);

ALTER TABLE order_clarifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read clinic order clarifications" ON order_clarifications;
CREATE POLICY "Authenticated users can read clinic order clarifications"
  ON order_clarifications FOR SELECT TO authenticated
  USING (
    order_id IN (
      SELECT order_id FROM orders
      WHERE clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID
    )
  );

DROP POLICY IF EXISTS "Service role full access to order clarifications" ON order_clarifications;
CREATE POLICY "Service role full access to order clarifications"
  ON order_clarifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── Gate views ─────────────────────────────────────────────
-- security_invoker so the querying user's RLS applies rather than the
-- view owner's. NOTE: under orders_role_aware_select (20260611000004)
-- a provider session sees only its own orders, so these clinic-labelled
-- figures are only clinic-wide when read as ops_admin or service_role.
-- Months are bucketed in UTC so the same data buckets identically
-- regardless of the reader's session timezone.

-- GATE: "at least 50% of repeat eligible orders reuse a protocol"
-- Eligible = orders for patients who have at least one protocol
-- instance. Counting every ad-hoc order in the denominator would make
-- the gate unreachable by construction.
CREATE OR REPLACE VIEW v_protocol_reuse
WITH (security_invoker = true) AS
SELECT
  o.clinic_id,
  date_trunc('month', o.created_at AT TIME ZONE 'UTC')                     AS month_utc,
  COUNT(*)::INTEGER                                                        AS orders_eligible,
  COUNT(*) FILTER (WHERE o.protocol_instance_id IS NOT NULL)::INTEGER      AS orders_from_protocol,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE o.protocol_instance_id IS NOT NULL)
    / NULLIF(COUNT(*), 0)
  , 1)                                                                     AS reuse_pct
FROM orders o
WHERE o.status <> 'CANCELLED'
  AND o.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM protocol_instances pi WHERE pi.patient_id = o.patient_id)
GROUP BY o.clinic_id, date_trunc('month', o.created_at AT TIME ZONE 'UTC');

-- GATE: "pharmacy clarification rate declining by protocol version"
-- Published versions only; drafts have no orders and add noise.
CREATE OR REPLACE VIEW v_protocol_clarification_rate
WITH (security_invoker = true) AS
SELECT
  pt.clinic_id,
  ptv.protocol_id,
  pt.name                                                                  AS protocol_name,
  ptv.version_number,
  COUNT(DISTINCT o.order_id)::INTEGER                                      AS orders_total,
  COUNT(DISTINCT oc.order_id)::INTEGER                                     AS orders_with_clarification,
  ROUND(
    100.0 * COUNT(DISTINCT oc.order_id) / NULLIF(COUNT(DISTINCT o.order_id), 0)
  , 1)                                                                     AS clarification_pct
FROM protocol_template_versions ptv
JOIN protocol_templates pt   ON pt.protocol_id = ptv.protocol_id
LEFT JOIN orders o           ON o.protocol_version_id = ptv.version_id
                            AND o.status <> 'CANCELLED'
                            AND o.deleted_at IS NULL
LEFT JOIN order_clarifications oc ON oc.order_id = o.order_id
WHERE ptv.status <> 'draft'
GROUP BY pt.clinic_id, ptv.protocol_id, pt.name, ptv.version_number;

-- GATE: "repeat use at 90 days without concierge prompting"
-- ONE cohort throughout: instances old enough to have reached the
-- 90-day mark. Mixing cohorts across numerator and denominator can
-- print a retention rate above 100%.
CREATE OR REPLACE VIEW v_protocol_retention_90d
WITH (security_invoker = true) AS
SELECT
  pi.clinic_id,
  COUNT(*)::INTEGER                                                        AS instances_eligible,
  COUNT(*) FILTER (
    WHERE pi.last_activity_at >= pi.started_at + INTERVAL '90 days'
  )::INTEGER                                                               AS instances_active_at_90d,
  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE pi.last_activity_at >= pi.started_at + INTERVAL '90 days'
    ) / NULLIF(COUNT(*), 0)
  , 1)                                                                     AS retention_90d_pct
FROM protocol_instances pi
WHERE pi.started_at <= now() - INTERVAL '90 days'
GROUP BY pi.clinic_id;

COMMENT ON TABLE protocol_instances IS
  'A patient''s run of a protocol at a pinned version. cycle_number allows repeat runs (cycling protocols).';
COMMENT ON COLUMN orders.protocol_instance_id IS
  'Nullable. Set when the order was generated from a protocol; null for ad-hoc prescriptions. Cannot be backfilled.';
COMMENT ON COLUMN orders.protocol_version_id IS
  'The protocol version this order was compiled from. Intentionally independent of the instance''s current version so history survives a version migration.';
COMMENT ON TABLE order_clarifications IS
  'Pharmacy/ops send-backs. Joined via orders.protocol_version_id to compute clarification rate per protocol version.';
