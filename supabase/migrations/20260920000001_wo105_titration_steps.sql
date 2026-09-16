-- ============================================================
-- WO-105: titration steps as structured data
-- ============================================================
--
-- Titration shipped (WO-84) as a sig sentence: "Take 0.1mL oral at
-- bedtime. Titrate up by 0.1mL every 3-4 days as tolerated up to 0.5mL".
-- The steps existed only as those words. Gina Rooks, 2026-09-11
-- (docs/practitioner-feedback/2026-09-11-product-run-thru-transcript.md,
-- 00:57:56): "I would see the titration as like at least a different box
-- for like each next step... some pharmacies don't really like you to
-- send things like free text written like this because it's like too
-- vague for them with titrations."
--
-- The steps now live on the order, so the app can sum the quantity
-- (0.4 + 0.8 + 1.6 mL, not 12 doses at the target dose), print the
-- schedule for the pharmacy and the patient, and restore the step table
-- when a draft is reopened or refilled.
--
-- Shape, on orders and on provider_favorites:
--   [{"dose": "10", "unit": "units", "frequency": "QW", "weeks": 4}, ...]
--   dose      numeric as text, as the builder holds it
--   unit      mg | mL | units | mcg | tablet | capsule | click
--   frequency a FREQUENCY_OPTIONS code (QD, QW, BID, ...)
--   weeks     positive integer
-- Steps are ordered: element 0 is week 1. An empty array means the line
-- is not a titration.
--
-- Deliberately NOT here: no titration_schedules table, no pointer to a
-- "first" order, no scheduled/release_at columns. One order carries its
-- own schedule; nothing makes one order special. Sequential monthly
-- orders were struck from WO-105 (see the spec amendment in
-- docs/phase21-practitioner-feedback-workorders.md) and would be a
-- later, additive change.
--
-- Nothing is backfilled. Orders written before this migration keep their
-- sig text and get sig_mode NULL, which reads as 'standard'.

BEGIN;

-- ── orders ──────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sig_mode        TEXT,
  ADD COLUMN IF NOT EXISTS titration_steps JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_sig_mode;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_sig_mode
  CHECK (sig_mode IS NULL OR sig_mode IN ('standard', 'titration', 'cycling'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_titration_steps_array;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_titration_steps_array
  CHECK (jsonb_typeof(titration_steps) = 'array');

-- A titration has steps; nothing else does. This is what keeps a mode
-- change from leaving orphan steps behind on the order.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_titration_steps_mode;
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_titration_steps_mode
  CHECK (
    jsonb_array_length(titration_steps) = 0
    OR sig_mode = 'titration'
  );

COMMENT ON COLUMN orders.sig_mode IS
  'How the sig was built: standard | titration | cycling. NULL on orders written before WO-105 and read as standard. Stored so the builder can be restored on reopen (WO-98) and refill (WO-106) instead of being guessed from sig_text.';

COMMENT ON COLUMN orders.titration_steps IS
  'WO-105: the titration schedule, ordered, element 0 first: [{dose, unit, frequency, weeks}]. Empty array when the line is not a titration. Days supply, dispense quantity and the suggested package are summed across these steps (computeTitrationDispense in src/lib/orders/rx-details.ts) — a titration has no single dose, so the WO-96/WO-101 single-dose derivation does not apply. Steps must all be fillable as the one formulation on this order; a titration that crosses formulations (0.1 mg and 0.5 mg capsules) is two lines.';

-- ── provider_favorites ──────────────────────────────────────
-- A saved titration favorite ("LDN Starter — Titration") kept sig_mode
-- but no steps, so applying it produced a standard sig and silently
-- dropped the schedule. The steps travel with the favorite now.

ALTER TABLE provider_favorites
  ADD COLUMN IF NOT EXISTS titration_steps JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE provider_favorites DROP CONSTRAINT IF EXISTS chk_provider_favorites_titration_steps_array;
ALTER TABLE provider_favorites
  ADD CONSTRAINT chk_provider_favorites_titration_steps_array
  CHECK (jsonb_typeof(titration_steps) = 'array');

COMMENT ON COLUMN provider_favorites.titration_steps IS
  'WO-105: the titration schedule this favorite carries, same shape as orders.titration_steps. Empty for a standard or cycling favorite. A favorite with steps loads the dose step in titration mode with the table filled in; dose_presets (WO-104) stay the common-dose chips for standard lines.';

COMMIT;
