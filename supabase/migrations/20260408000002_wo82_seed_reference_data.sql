-- ============================================================
-- WO-82: Seed Reference Data — Dosage Forms + Routes
-- ============================================================
-- These are lookup/reference tables that don't change per pharmacy.

-- ── Dosage Forms ──────────────────────────────────────────────

INSERT INTO dosage_forms (dosage_form_id, name, is_sterile, default_route, requires_injection_supplies, calculation_method, sort_order) VALUES
    (gen_random_uuid(), 'Injectable Solution', true, 'Subcutaneous', true, 'volume-based', 1),
    (gen_random_uuid(), 'Capsule', false, 'Oral', false, 'unit-count', 2),
    (gen_random_uuid(), 'Oral Solution', false, 'Oral', false, 'volume-based', 3),
    (gen_random_uuid(), 'Rapid Dissolve Tablet (RDT)', false, 'Sublingual', false, 'unit-count', 4),
    (gen_random_uuid(), 'Topical Cream', false, 'Topical', false, 'weight-based', 5),
    (gen_random_uuid(), 'Topical Gel', false, 'Topical', false, 'weight-based', 6),
    (gen_random_uuid(), 'Sublingual Tablet', false, 'Sublingual', false, 'unit-count', 7),
    (gen_random_uuid(), 'Nasal Spray', false, 'Intranasal', false, 'volume-based', 8),
    (gen_random_uuid(), 'Troche', false, 'Sublingual', false, 'unit-count', 9),
    (gen_random_uuid(), 'Suppository', false, 'Rectal', false, 'unit-count', 10),
    (gen_random_uuid(), 'Subcutaneous Pellet', true, 'Subcutaneous', false, 'unit-count', 11)
ON CONFLICT (name) DO NOTHING;

-- ── Routes of Administration ─────────────────────────────────

INSERT INTO routes_of_administration (route_id, name, abbreviation, sig_prefix, sort_order) VALUES
    (gen_random_uuid(), 'Subcutaneous', 'SubQ', 'Inject', 1),
    (gen_random_uuid(), 'Intramuscular', 'IM', 'Inject', 2),
    (gen_random_uuid(), 'Oral', 'PO', 'Take', 3),
    (gen_random_uuid(), 'Sublingual', 'SL', 'Dissolve', 4),
    (gen_random_uuid(), 'Topical', 'TOP', 'Apply', 5),
    (gen_random_uuid(), 'Intranasal', 'IN', 'Spray', 6),
    (gen_random_uuid(), 'Intravaginal', 'IVag', 'Insert', 7),
    (gen_random_uuid(), 'Rectal', 'PR', 'Insert', 8),
    (gen_random_uuid(), 'Intravenous', 'IV', 'Infuse', 9)
ON CONFLICT (name) DO NOTHING;
