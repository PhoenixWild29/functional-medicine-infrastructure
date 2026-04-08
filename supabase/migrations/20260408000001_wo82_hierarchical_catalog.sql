-- ============================================================
-- WO-82: Hierarchical Catalog Data Model
-- ============================================================
--
-- Creates the new hierarchical medication catalog alongside
-- the existing flat `catalog` table. No breaking changes.
--
-- Hierarchy: ingredients → salt_forms → formulations → pharmacy_formulations
-- Multi-ingredient combos use formulation_ingredients junction table.
-- Sig templates provide structured prescription directions.

-- ============================================================
-- 1. INGREDIENTS — Active pharmaceutical ingredients (APIs)
-- ============================================================

CREATE TABLE IF NOT EXISTS ingredients (
    ingredient_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    common_name         TEXT NOT NULL,                -- "Testosterone", "Semaglutide", "Naltrexone"
    therapeutic_category TEXT,                        -- "Men's Health", "Weight Loss", "Peptides", "Pain Management"
    dea_schedule        INTEGER,                     -- null=not controlled, 2-5=DEA schedule
    is_hazardous        BOOLEAN NOT NULL DEFAULT false, -- NIOSH hazardous drug list
    description         TEXT,                        -- Brief clinical description
    fda_alert_status    TEXT,                        -- "Category 2" for BPC-157, null for most
    fda_alert_message   TEXT,                        -- Warning text if fda_alert_status is set
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT true
);

-- Index for search autocomplete
CREATE INDEX IF NOT EXISTS idx_ingredients_name
    ON ingredients (common_name) WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_ingredients_category
    ON ingredients (therapeutic_category) WHERE deleted_at IS NULL AND is_active = true;

-- ============================================================
-- 2. SALT_FORMS — Specific synthesized variants of an ingredient
-- ============================================================

CREATE TABLE IF NOT EXISTS salt_forms (
    salt_form_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id       UUID NOT NULL REFERENCES ingredients(ingredient_id),
    salt_name           TEXT NOT NULL,                -- "Testosterone Cypionate", "Naltrexone Hydrochloride"
    abbreviation        TEXT,                        -- "HCL", "Cypionate"
    molecular_weight    NUMERIC(10,4),               -- g/mol
    conversion_factor   NUMERIC(10,6),               -- moiety-to-salt weight ratio
    cas_number          TEXT,                        -- Chemical Abstracts Service number
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (ingredient_id, salt_name)
);

CREATE INDEX IF NOT EXISTS idx_salt_forms_ingredient
    ON salt_forms (ingredient_id) WHERE deleted_at IS NULL AND is_active = true;

-- ============================================================
-- 3. DOSAGE_FORMS — Physical form taxonomy
-- ============================================================

CREATE TABLE IF NOT EXISTS dosage_forms (
    dosage_form_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL UNIQUE,         -- "Injectable Solution", "Capsule", "RDT", "Topical Cream"
    is_sterile          BOOLEAN NOT NULL DEFAULT false,
    default_route       TEXT,                        -- Default route for this form
    requires_injection_supplies BOOLEAN NOT NULL DEFAULT false,
    calculation_method  TEXT,                        -- "volume-based", "weight-based", "unit-count"
    sort_order          INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- 4. ROUTES_OF_ADMINISTRATION — How the medication is administered
-- ============================================================

CREATE TABLE IF NOT EXISTS routes_of_administration (
    route_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL UNIQUE,         -- "Subcutaneous", "Intramuscular", "Oral", "Sublingual"
    abbreviation        TEXT NOT NULL,               -- "SubQ", "IM", "PO", "SL", "TOP"
    sig_prefix          TEXT NOT NULL,               -- "Inject", "Take", "Apply", "Dissolve"
    sort_order          INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- 5. FORMULATIONS — Master Formulation Record (central table)
-- ============================================================

CREATE TABLE IF NOT EXISTS formulations (
    formulation_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,               -- Display name: "Semaglutide 5mg/mL Injectable"
    salt_form_id        UUID REFERENCES salt_forms(salt_form_id),   -- Primary salt form (null for combos)
    dosage_form_id      UUID NOT NULL REFERENCES dosage_forms(dosage_form_id),
    route_id            UUID NOT NULL REFERENCES routes_of_administration(route_id),
    concentration       TEXT,                        -- "200mg/mL", "1mg/mL", "150mg"
    concentration_value NUMERIC(10,4),               -- Numeric value for calculations: 200, 1, 150
    concentration_unit  TEXT,                        -- "mg/mL", "mg", "mg/g", "%"
    excipient_base      TEXT,                        -- "Grapeseed Oil", "MCT Oil", "Glycerin USP"
    is_combination      BOOLEAN NOT NULL DEFAULT false,  -- True for multi-ingredient compounds
    total_ingredients   INTEGER NOT NULL DEFAULT 1,
    description         TEXT,                        -- Additional formulation notes
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_formulations_salt_form
    ON formulations (salt_form_id) WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_formulations_dosage_form
    ON formulations (dosage_form_id) WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_formulations_route
    ON formulations (route_id) WHERE deleted_at IS NULL AND is_active = true;

-- ============================================================
-- 6. FORMULATION_INGREDIENTS — Junction table for multi-ingredient combos
-- ============================================================

CREATE TABLE IF NOT EXISTS formulation_ingredients (
    formulation_ingredient_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formulation_id      UUID NOT NULL REFERENCES formulations(formulation_id),
    ingredient_id       UUID NOT NULL REFERENCES ingredients(ingredient_id),
    salt_form_id        UUID REFERENCES salt_forms(salt_form_id),
    concentration_per_unit TEXT NOT NULL,             -- "100mg", "10mg", "50mg"
    concentration_value NUMERIC(10,4),               -- Numeric: 100, 10, 50
    concentration_unit  TEXT,                        -- "mg", "mcg"
    role                TEXT NOT NULL DEFAULT 'primary', -- "primary", "adjuvant", "preservative", "vehicle"
    sort_order          INTEGER NOT NULL DEFAULT 0,
    UNIQUE (formulation_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_formulation_ingredients_formulation
    ON formulation_ingredients (formulation_id);

-- ============================================================
-- 7. PHARMACY_FORMULATIONS — Which pharmacy offers what at what price
-- ============================================================

CREATE TABLE IF NOT EXISTS pharmacy_formulations (
    pharmacy_formulation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id         UUID NOT NULL REFERENCES pharmacies(pharmacy_id),
    formulation_id      UUID NOT NULL REFERENCES formulations(formulation_id),
    wholesale_price     NUMERIC(10,2) NOT NULL,      -- HC-01: pharmacy's wholesale price
    available_quantities JSONB,                      -- ["5mL vial", "10mL vial", "30 capsules"]
    available_supply_durations JSONB,                -- ["30-day", "60-day", "90-day"]
    is_available        BOOLEAN NOT NULL DEFAULT true,
    estimated_turnaround_days INTEGER,
    last_synced_at      TIMESTAMPTZ,
    sku_code            TEXT,                        -- Pharmacy's internal SKU
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (pharmacy_id, formulation_id)
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_formulations_pharmacy
    ON pharmacy_formulations (pharmacy_id) WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_pharmacy_formulations_formulation
    ON pharmacy_formulations (formulation_id) WHERE deleted_at IS NULL AND is_active = true;

-- ============================================================
-- 8. SIG_TEMPLATES — Structured prescription directions
-- ============================================================

CREATE TABLE IF NOT EXISTS sig_templates (
    sig_template_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formulation_id      UUID REFERENCES formulations(formulation_id), -- Optional, can be generic
    label               TEXT,                        -- "Standard daily dose", "LDN titration"
    dose_amount         TEXT,                        -- "0.1mL", "1 tablet", "25 units"
    dose_value          NUMERIC(10,4),               -- Numeric: 0.1, 1, 25
    dose_unit           TEXT,                        -- "mL", "tablet", "units", "capsule"
    route_text          TEXT,                        -- "by mouth", "subcutaneously", "topically"
    frequency_code      TEXT,                        -- "QD", "BID", "QW", "QOD", "QID"
    frequency_display   TEXT,                        -- "once daily", "twice daily", "M-F weekends off"
    timing              TEXT,                        -- "at bedtime", "with breakfast"
    duration            TEXT,                        -- "for 14 days", "ongoing"
    is_titration        BOOLEAN NOT NULL DEFAULT false,
    titration_start_dose TEXT,                       -- "0.1mL"
    titration_increment TEXT,                        -- "0.1mL"
    titration_interval  TEXT,                        -- "every 3-4 days"
    titration_target    TEXT,                        -- "0.5mL"
    is_cycling          BOOLEAN NOT NULL DEFAULT false,
    cycling_on_days     INTEGER,                     -- 5 (for 5 days on)
    cycling_off_days    INTEGER,                     -- 2 (for 2 days off)
    cycling_duration    TEXT,                        -- "6 weeks"
    cycling_rest        TEXT,                        -- "2-4 weeks off"
    generated_sig_text  TEXT,                        -- Auto-generated from structured fields
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sig_templates_formulation
    ON sig_templates (formulation_id);

-- ============================================================
-- 9. RLS POLICIES — Enable on all new tables
-- ============================================================

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE salt_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE dosage_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes_of_administration ENABLE ROW LEVEL SECURITY;
ALTER TABLE formulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE formulation_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_formulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sig_templates ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (these are reference data, not clinic-scoped)
CREATE POLICY "ingredients_read" ON ingredients FOR SELECT TO authenticated USING (true);
CREATE POLICY "salt_forms_read" ON salt_forms FOR SELECT TO authenticated USING (true);
CREATE POLICY "dosage_forms_read" ON dosage_forms FOR SELECT TO authenticated USING (true);
CREATE POLICY "routes_read" ON routes_of_administration FOR SELECT TO authenticated USING (true);
CREATE POLICY "formulations_read" ON formulations FOR SELECT TO authenticated USING (true);
CREATE POLICY "formulation_ingredients_read" ON formulation_ingredients FOR SELECT TO authenticated USING (true);
CREATE POLICY "pharmacy_formulations_read" ON pharmacy_formulations FOR SELECT TO authenticated USING (true);
CREATE POLICY "sig_templates_read" ON sig_templates FOR SELECT TO authenticated USING (true);

-- Service role has full access (for seed scripts, ops, admin)
CREATE POLICY "ingredients_service" ON ingredients FOR ALL TO service_role USING (true);
CREATE POLICY "salt_forms_service" ON salt_forms FOR ALL TO service_role USING (true);
CREATE POLICY "dosage_forms_service" ON dosage_forms FOR ALL TO service_role USING (true);
CREATE POLICY "routes_service" ON routes_of_administration FOR ALL TO service_role USING (true);
CREATE POLICY "formulations_service" ON formulations FOR ALL TO service_role USING (true);
CREATE POLICY "formulation_ingredients_service" ON formulation_ingredients FOR ALL TO service_role USING (true);
CREATE POLICY "pharmacy_formulations_service" ON pharmacy_formulations FOR ALL TO service_role USING (true);
CREATE POLICY "sig_templates_service" ON sig_templates FOR ALL TO service_role USING (true);

-- ============================================================
-- 10. COMMENTS — Document the schema
-- ============================================================

COMMENT ON TABLE ingredients IS 'Active pharmaceutical ingredients (APIs) — the foundational molecules. Tier 1 of the hierarchical catalog.';
COMMENT ON TABLE salt_forms IS 'Specific synthesized variants of an ingredient (e.g., Testosterone Cypionate vs Testosterone Propionate). Tier 2.';
COMMENT ON TABLE dosage_forms IS 'Physical form taxonomy (Injectable Solution, Capsule, RDT, Topical Cream). Reference table.';
COMMENT ON TABLE routes_of_administration IS 'How the medication is administered (SubQ, IM, Oral, Sublingual). Reference table.';
COMMENT ON TABLE formulations IS 'Master Formulation Record — the specific compound recipe. Central table of the hierarchy. Tier 3.';
COMMENT ON TABLE formulation_ingredients IS 'Junction table for multi-ingredient combinations (e.g., NAD+/MOTS-c/5-Amino-1MQ). Tier 3a.';
COMMENT ON TABLE pharmacy_formulations IS 'Which pharmacy offers which formulation at what price. Tier 4.';
COMMENT ON TABLE sig_templates IS 'Structured prescription directions with titration and cycling support. Tier 5.';
