-- ============================================================
-- CompoundIQ — Sunrise demo refresh (2026-10-23)
-- ============================================================
--
-- Run against the POC demo project (service role / SQL editor), after
-- scripts/demo-expansion-seed.sql. Touches ONLY Sunrise Functional
-- Medicine's seeded demo rows (clinic a1000000-…-0001). Makes no Stripe
-- or other external calls: it is plain SQL, and nothing here changes an
-- order's status, so no status trigger (ops alert queue) fires.
--
--   1. Order history: status-history rows for DEMO-1001..1011 (orders
--      d1000000-0000-4000-8000-000000000001..11) that walk each order to
--      its CURRENT status, timestamps spread between its locked_at and
--      updated_at, actor "CompoundIQ (automatic)". Shipped and delivered
--      orders without a tracking number get one, with a carrier.
--   2. Failed order: DEMO-1011 (SUBMISSION_FAILED) gets a failed adapter
--      submission with an error code and message. The ops pipeline order
--      drawer shows it on its Submissions tab.
--   3. PA licenses: a PA license for the four Sunrise demo providers
--      (DEMO-PA-<last 4 of the provider id>, the seed's convention),
--      expiring 2027-12-31, verified, so the PA test patient can be
--      signed for. NPI records are not touched.
--   4. Practice dashboard: three demo orders (DEMO-1013..1015, d1…13..15)
--      for existing Sunrise patients, created in the CURRENT month, two
--      SHIPPED and one PAID_PROCESSING, with snapshots, status history,
--      ledger lines and pharmacy payables as the app writes them (no
--      platform fee: PLATFORM_FEE_PCT is 0). notes = 'Demo data'.
--      Each order is one line: the schema has no separate order-lines
--      table. The ledger lines carry no Stripe object id, so the daily
--      Stripe reconciliation skips them instead of flagging them.
--   5. Not in this file: the "Demo payout account" label is a display
--      change in the app (src/app/(clinic-app)/settings/_components/
--      stripe-status-section.tsx); the account id is not changed.
--   6. The check query at the end returns one row per part.
--
-- IDEMPOTENT: deterministic ids with ON CONFLICT DO NOTHING; updates
-- only fill values that are missing. Running it twice changes nothing
-- the second time. Order history is only written for an order that has
-- no status history of its own yet (from the app), so real history is
-- never duplicated or contradicted.
-- ============================================================

BEGIN;

-- ── 4a. Practice dashboard: three demo orders this month ──────
-- Created in the current month (and never in the future): the window is
-- from max(month start, now - 6 days) to now. Prices: catalog wholesale x
-- 1.4 (the clinic's 40% default markup), as the seed does. Shipping is
-- the pharmacy's own standard / cold-chain rate (0 if it has none).
WITH win AS (
  SELECT greatest(date_trunc('month', now()), now() - interval '6 days') AS t0,
         now() - greatest(date_trunc('month', now()), now() - interval '6 days') AS span
),
src AS (
  SELECT * FROM (VALUES
    -- order_id, number, patient, provider, formulation name, form, dose, pharmacy, status, wholesale, retail, shipping type, tracking, carrier, start, end (fractions of the window), sig
    ('d1000000-0000-4000-8000-000000000013'::uuid, 'DEMO-1013', 'a3000000-0000-0000-0000-000000000005'::uuid, 'a2000000-0000-0000-0000-000000000003'::uuid,
     'Tadalafil Troche 10mg', 'Troche', '10mg', 'a4000000-0000-0000-0000-000000000005'::uuid, 'SHIPPED', 24.00, 33.60, 'standard',
     '1Z999AA10123456813', 'UPS', 0.00, 0.70, 'Dissolve one troche under the tongue 30 minutes before activity as needed.'),
    ('d1000000-0000-4000-8000-000000000014'::uuid, 'DEMO-1014', 'a3000000-0000-0000-0000-000000000010'::uuid, 'a2000000-0000-0000-0000-000000000004'::uuid,
     'Biest 80/20 Topical Cream 2.5mg/g', 'Topical Cream', '2.5mg/g', 'a4000000-0000-0000-0000-000000000004'::uuid, 'SHIPPED', 28.00, 39.20, 'standard',
     '9400111899560001234614', 'USPS', 0.15, 0.85, 'Apply 0.5mL topically to inner wrist nightly.'),
    ('d1000000-0000-4000-8000-000000000015'::uuid, 'DEMO-1015', 'a3000000-0000-0000-0000-000000000007'::uuid, 'a2000000-0000-0000-0000-000000000001'::uuid,
     'NAD+ Injectable', 'Injectable Solution', '200mg/mL', 'a4000000-0000-0000-0000-000000000002'::uuid, 'PAID_PROCESSING', 155.00, 217.00, 'cold_chain',
     NULL, NULL, 0.50, 0.95, 'Inject 0.5mL subcutaneously twice weekly.')
  ) AS v(order_id, order_number, patient_id, provider_id, form_name, form, dose, pharmacy_id, status, wholesale, retail, shipping_type,
         tracking_number, carrier, f_start, f_end, sig_text)
)
INSERT INTO orders (order_id, patient_id, provider_id, formulation_id, clinic_id, pharmacy_id,
                    status, quantity, wholesale_price_snapshot, retail_price_snapshot,
                    medication_snapshot, shipping_state_snapshot, provider_npi_snapshot,
                    pharmacy_snapshot, locked_at, submission_tier, sig_text, order_number,
                    tracking_number, carrier, shipping_type, shipping_fee, notes,
                    created_at, updated_at, is_active)
SELECT s.order_id, s.patient_id, s.provider_id, md5('form:' || lower(s.form_name))::uuid,
       'a1000000-0000-0000-0000-000000000001', s.pharmacy_id,
       s.status::order_status_enum, 1, s.wholesale, s.retail,
       jsonb_build_object('medication_name', s.form_name, 'form', s.form, 'dose', s.dose,
                          'wholesale_price', s.wholesale, 'dea_schedule', NULL),
       pt.state, pr.npi_number,
       jsonb_build_object('pharmacy_id', ph.pharmacy_id, 'name', ph.name, 'slug', ph.slug,
                          'integration_tier', ph.integration_tier),
       w.t0 + w.span * s.f_start + interval '30 minutes' * (CASE WHEN w.span > interval '2 hours' THEN 1 ELSE 0 END),
       ph.integration_tier, s.sig_text, s.order_number,
       s.tracking_number, s.carrier, s.shipping_type,
       coalesce(CASE WHEN s.shipping_type = 'cold_chain' THEN ph.shipping_fee_cold_chain ELSE ph.shipping_fee_standard END, 0),
       'Demo data',
       w.t0 + w.span * s.f_start, w.t0 + w.span * s.f_end, true
  FROM src s
  CROSS JOIN win w
  JOIN patients   pt ON pt.patient_id  = s.patient_id  AND pt.clinic_id = 'a1000000-0000-0000-0000-000000000001'
  JOIN providers  pr ON pr.provider_id = s.provider_id AND pr.clinic_id = 'a1000000-0000-0000-0000-000000000001'
  JOIN pharmacies ph ON ph.pharmacy_id = s.pharmacy_id
ON CONFLICT DO NOTHING;

-- ── 1a. Tracking for shipped / delivered demo orders ──────────
-- Only where it is missing, so the seed's tracking (and updated_at) stay.
UPDATE orders o
   SET tracking_number = 'DEMO' || right(replace(o.order_id::text, '-', ''), 14),
       carrier         = coalesce(o.carrier, 'UPS')
 WHERE o.clinic_id = 'a1000000-0000-0000-0000-000000000001'
   AND o.order_id IN (
         'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002',
         'd1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004',
         'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006',
         'd1000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000008',
         'd1000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000010',
         'd1000000-0000-4000-8000-000000000011')
   AND o.status IN ('SHIPPED', 'DELIVERED')
   AND o.tracking_number IS NULL;

UPDATE orders o
   SET carrier = 'UPS'
 WHERE o.clinic_id = 'a1000000-0000-0000-0000-000000000001'
   AND o.order_id IN (
         'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002',
         'd1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004',
         'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006',
         'd1000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000008',
         'd1000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000010',
         'd1000000-0000-4000-8000-000000000011')
   AND o.status IN ('SHIPPED', 'DELIVERED')
   AND o.carrier IS NULL;

-- ── 1b. Status history, walked to each order's current status ──
-- The paths follow src/lib/orders/state-machine.ts: Tier 4 goes by fax
-- (FAX_QUEUED, FAX_DELIVERED); Tiers 1-3 by SUBMISSION_PENDING. DELIVERED
-- follows SHIPPED (set by the carrier tracking update). The first step
-- (DRAFT -> AWAITING_PAYMENT) is at locked_at; the rest are spread evenly
-- up to updated_at. Deterministic history ids keep re-runs no-ops.
WITH paths(kind, path) AS (
  VALUES
    ('fax',     ARRAY['DRAFT', 'AWAITING_PAYMENT', 'PAID_PROCESSING', 'FAX_QUEUED', 'FAX_DELIVERED', 'PHARMACY_ACKNOWLEDGED',
                      'PHARMACY_PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED']),
    ('adapter', ARRAY['DRAFT', 'AWAITING_PAYMENT', 'PAID_PROCESSING', 'SUBMISSION_PENDING', 'PHARMACY_ACKNOWLEDGED',
                      'PHARMACY_PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED']),
    ('failed',  ARRAY['DRAFT', 'AWAITING_PAYMENT', 'PAID_PROCESSING', 'SUBMISSION_PENDING', 'SUBMISSION_FAILED'])
),
demo AS (
  SELECT o.order_id, o.status::text AS status,
         coalesce(o.locked_at, o.created_at + interval '30 minutes') AS t_first,
         greatest(o.updated_at, coalesce(o.locked_at, o.created_at + interval '30 minutes')) AS t_last,
         CASE WHEN o.status = 'SUBMISSION_FAILED' THEN 'failed'
              WHEN o.submission_tier = 'TIER_4_FAX' THEN 'fax'
              ELSE 'adapter' END AS kind
    FROM orders o
   WHERE o.clinic_id = 'a1000000-0000-0000-0000-000000000001'
     AND o.order_id IN (
           'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002',
           'd1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004',
           'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006',
           'd1000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000008',
           'd1000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000010',
           'd1000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000013',
           'd1000000-0000-4000-8000-000000000014', 'd1000000-0000-4000-8000-000000000015')
     -- Never alongside history the app wrote: only orders whose history,
     -- if any, is this script's own.
     AND NOT EXISTS (
           SELECT 1 FROM order_status_history h
            WHERE h.order_id = o.order_id
              AND coalesce(h.metadata ->> 'source', '') <> 'demo-refresh-2026-10-23')
),
steps AS (
  SELECT d.order_id, d.t_first, d.t_last, p.path,
         array_position(p.path, d.status) AS last_idx
    FROM demo d JOIN paths p ON p.kind = d.kind
)
INSERT INTO order_status_history (history_id, order_id, old_status, new_status, changed_by, metadata, created_at)
SELECT md5('demo-refresh-2026-10-23:history:' || s.order_id::text || ':' || k)::uuid,
       s.order_id,
       s.path[k - 1]::order_status_enum,
       s.path[k]::order_status_enum,
       'CompoundIQ (automatic)',
       jsonb_build_object('source', 'demo-refresh-2026-10-23', 'demo', true),
       CASE WHEN s.last_idx <= 2 THEN s.t_first
            ELSE s.t_first + (s.t_last - s.t_first) * ((k - 2)::numeric / (s.last_idx - 2)) END
  FROM steps s
  CROSS JOIN LATERAL generate_series(2, s.last_idx) AS k
 WHERE s.last_idx IS NOT NULL   -- a status outside the demo paths is left alone
ON CONFLICT (history_id) DO NOTHING;

-- ── 2. DEMO-1011: the failed submission's reason ──────────────
INSERT INTO adapter_submissions (submission_id, order_id, pharmacy_id, tier, status, attempt_number,
                                 error_code, error_message, submitted_at, completed_at, created_at, metadata)
SELECT md5('demo-refresh-2026-10-23:submission:' || o.order_id::text)::uuid,
       o.order_id, o.pharmacy_id, 'TIER_1_API', 'FAILED', 3,
       'PHARMACY_API_UNAVAILABLE',
       'Express Digital Rx API returned 503 Service Unavailable on 3 attempts. No fax fallback is configured for this pharmacy.',
       o.updated_at - interval '20 minutes', o.updated_at, o.updated_at - interval '20 minutes',
       jsonb_build_object('source', 'demo-refresh-2026-10-23', 'demo', true)
  FROM orders o
 WHERE o.order_id = 'd1000000-0000-4000-8000-000000000011'
   AND o.clinic_id = 'a1000000-0000-0000-0000-000000000001'
   AND o.status = 'SUBMISSION_FAILED'
   AND o.pharmacy_id IS NOT NULL
ON CONFLICT (submission_id) DO NOTHING;

-- ── 3. PA licenses for the four Sunrise demo providers ────────
-- Same convention as the seed: DEMO-<state>-<last 4 of the provider id>
-- (Chen 0001, Patel 0003, Rodriguez 0004, Fletcher 0005). A demo PA row
-- that exists but is expired or unverified is brought up to date; a PA
-- license that is not a demo one is never touched.
INSERT INTO provider_state_licenses (provider_id, state, license_number, expires_on, verified_at, source)
SELECT p.provider_id, 'PA', 'DEMO-PA-' || right(p.provider_id::text, 4), DATE '2027-12-31', now(), 'demo_seed'
  FROM providers p
 WHERE p.clinic_id = 'a1000000-0000-0000-0000-000000000001'
   AND p.provider_id IN ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000003',
                         'a2000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000005')
ON CONFLICT (provider_id, state) DO UPDATE
   SET expires_on  = EXCLUDED.expires_on,
       verified_at = coalesce(provider_state_licenses.verified_at, EXCLUDED.verified_at)
 WHERE provider_state_licenses.license_number LIKE 'DEMO-PA-%'
   AND (provider_state_licenses.expires_on < EXCLUDED.expires_on OR provider_state_licenses.verified_at IS NULL);

-- ── 4b. Ledger lines and pharmacy payables for the new orders ──
-- As lib/payments/ledger writePaymentLines writes them with no platform
-- fee: charge (platform, retail + shipping unless the clinic absorbs it),
-- clinic_transfer (clinic, charge - wholesale - shipping), pharmacy_payable
-- (pharmacy, wholesale + shipping), and an 'owed' payable. No platform_fee
-- line (PLATFORM_FEE_PCT is 0). stripe_object_id stays NULL: no Stripe
-- object exists for demo data.
WITH o AS (
  SELECT o.order_id, o.clinic_id, o.pharmacy_id, o.created_at,
         round(o.retail_price_snapshot * 100)::bigint    AS retail_c,
         round(o.wholesale_price_snapshot * 100)::bigint AS wholesale_c,
         round(o.shipping_fee * 100)::bigint             AS shipping_c,
         coalesce(c.absorb_shipping, false)              AS absorb
    FROM orders o
    JOIN clinics c ON c.clinic_id = o.clinic_id
   WHERE o.clinic_id = 'a1000000-0000-0000-0000-000000000001'
     AND o.order_id IN ('d1000000-0000-4000-8000-000000000013', 'd1000000-0000-4000-8000-000000000014',
                        'd1000000-0000-4000-8000-000000000015')
     AND o.notes = 'Demo data'
),
lines AS (
  SELECT o.*, x.entry_type, x.party, x.amount_cents
    FROM o
    CROSS JOIN LATERAL (VALUES
      ('charge',           'platform', o.retail_c + CASE WHEN o.absorb THEN 0 ELSE o.shipping_c END),
      ('clinic_transfer',  'clinic',   o.retail_c + CASE WHEN o.absorb THEN 0 ELSE o.shipping_c END - (o.wholesale_c + o.shipping_c)),
      ('pharmacy_payable', 'pharmacy', o.wholesale_c + o.shipping_c)
    ) AS x(entry_type, party, amount_cents)
)
INSERT INTO ledger_entries (order_id, payment_group_id, clinic_id, pharmacy_id, party, entry_type, amount_cents,
                            currency, stripe_object_id, status, source_event_id, line_key, created_at)
SELECT l.order_id, NULL, l.clinic_id, l.pharmacy_id, l.party, l.entry_type, l.amount_cents,
       'usd', NULL, 'succeeded', 'demo-refresh-2026-10-23:' || l.order_id::text,
       l.entry_type || ':' || l.party || ':' || l.order_id::text, l.created_at + interval '45 minutes'
  FROM lines l
ON CONFLICT (source_event_id, line_key) DO NOTHING;

INSERT INTO pharmacy_payables (order_id, payment_group_id, pharmacy_id, clinic_id, wholesale_cents, shipping_cents,
                               amount_cents, currency, status, created_at, updated_at)
SELECT o.order_id, NULL, o.pharmacy_id, o.clinic_id,
       round(o.wholesale_price_snapshot * 100)::bigint, round(o.shipping_fee * 100)::bigint,
       round(o.wholesale_price_snapshot * 100)::bigint + round(o.shipping_fee * 100)::bigint,
       'usd', 'owed', o.created_at + interval '45 minutes', o.created_at + interval '45 minutes'
  FROM orders o
 WHERE o.clinic_id = 'a1000000-0000-0000-0000-000000000001'
   AND o.order_id IN ('d1000000-0000-4000-8000-000000000013', 'd1000000-0000-4000-8000-000000000014',
                      'd1000000-0000-4000-8000-000000000015')
   AND o.notes = 'Demo data'
   AND o.pharmacy_id IS NOT NULL
ON CONFLICT (order_id) DO NOTHING;

COMMIT;

-- ── 6. Checks: one row per part ───────────────────────────────
SELECT * FROM (
  SELECT 1 AS part, 'status history rows, DEMO-1001..1011 (expected 67)' AS check_name,
         (SELECT count(*) FROM order_status_history
           WHERE metadata ->> 'source' = 'demo-refresh-2026-10-23'
             AND order_id IN (
               'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002',
               'd1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004',
               'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006',
               'd1000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000008',
               'd1000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000010',
               'd1000000-0000-4000-8000-000000000011')) AS result
  UNION ALL
  SELECT 1, 'DEMO-1001..1011 orders whose latest history row matches their status (expected 11)',
         (SELECT count(*) FROM orders o
           WHERE o.order_id IN (
               'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002',
               'd1000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004',
               'd1000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000006',
               'd1000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000008',
               'd1000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000010',
               'd1000000-0000-4000-8000-000000000011')
             AND o.status = (SELECT h.new_status FROM order_status_history h WHERE h.order_id = o.order_id
                              ORDER BY h.created_at DESC, h.history_id LIMIT 1))
  UNION ALL
  SELECT 1, 'shipped / delivered Sunrise demo orders missing tracking or carrier (expected 0)',
         (SELECT count(*) FROM orders
           WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001'
             AND order_number LIKE 'DEMO-10%' AND status IN ('SHIPPED', 'DELIVERED')
             AND (tracking_number IS NULL OR carrier IS NULL))
  UNION ALL
  SELECT 2, 'DEMO-1011 failed submissions with a reason (expected 1)',
         (SELECT count(*) FROM adapter_submissions
           WHERE order_id = 'd1000000-0000-4000-8000-000000000011' AND status = 'FAILED' AND error_message IS NOT NULL)
  UNION ALL
  SELECT 3, 'Sunrise demo providers with an active, verified PA license (expected 4)',
         (SELECT count(*) FROM provider_state_licenses
           WHERE state = 'PA' AND license_number LIKE 'DEMO-PA-%' AND expires_on >= current_date AND verified_at IS NOT NULL
             AND provider_id IN ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000003',
                                 'a2000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000005'))
  UNION ALL
  SELECT 4, 'demo orders this month, paid or shipped, labelled Demo data (expected 3)',
         (SELECT count(*) FROM orders
           WHERE clinic_id = 'a1000000-0000-0000-0000-000000000001' AND notes = 'Demo data'
             AND created_at >= date_trunc('month', now()) AND status IN ('PAID_PROCESSING', 'SHIPPED'))
  UNION ALL
  SELECT 4, 'status history rows for DEMO-1013..1015 (expected 16)',
         (SELECT count(*) FROM order_status_history
           WHERE metadata ->> 'source' = 'demo-refresh-2026-10-23'
             AND order_id IN ('d1000000-0000-4000-8000-000000000013', 'd1000000-0000-4000-8000-000000000014',
                              'd1000000-0000-4000-8000-000000000015'))
  UNION ALL
  SELECT 4, 'ledger lines for DEMO-1013..1015 (expected 9)',
         (SELECT count(*) FROM ledger_entries WHERE source_event_id LIKE 'demo-refresh-2026-10-23:%')
  UNION ALL
  SELECT 4, 'demo orders whose ledger lines do not balance to the charge (expected 0)',
         (SELECT count(*) FROM (
            SELECT order_id
              FROM ledger_entries WHERE source_event_id LIKE 'demo-refresh-2026-10-23:%'
             GROUP BY order_id
            HAVING sum(amount_cents) FILTER (WHERE entry_type = 'charge')
                <> sum(amount_cents) FILTER (WHERE entry_type IN ('clinic_transfer', 'pharmacy_payable'))) x)
  UNION ALL
  SELECT 4, 'pharmacy payables for DEMO-1013..1015 (expected 3)',
         (SELECT count(*) FROM pharmacy_payables
           WHERE order_id IN ('d1000000-0000-4000-8000-000000000013', 'd1000000-0000-4000-8000-000000000014',
                              'd1000000-0000-4000-8000-000000000015'))
) c ORDER BY part, check_name;
