-- ============================================================
-- READ ONLY: DRAFT orders that batch sign will now refuse, 2026-10-25
-- ============================================================
--
-- Since state-machine-enforcement (B-2026-10-25-06), batch sign refuses a
-- draft missing any snapshot that DRAFT -> AWAITING_PAYMENT requires
-- (problem 'missing_snapshot'): wholesale_price_snapshot,
-- retail_price_snapshot, medication_snapshot, shipping_state_snapshot,
-- provider_npi_snapshot, pharmacy_snapshot. Every draft created by
-- POST /api/orders has all six; this finds any that do not (older drafts,
-- or rows written by hand).
--
-- Counts the drafts batch sign would read (active, not deleted), per
-- clinic, with how many lack each field. For Sunrise
-- (a1000000-0000-0000-0000-000000000001) it also lists the order ids.
-- Such a draft cannot be signed: remove it and prescribe it again.
--
-- SELECT only, in a READ ONLY transaction that is rolled back. It changes
-- nothing. Any role that can read orders and clinics can run it.

BEGIN TRANSACTION READ ONLY;

SELECT
  o.clinic_id,
  c.name                                                      AS clinic_name,
  count(*)                                                    AS drafts_missing_a_snapshot,
  count(*) FILTER (WHERE o.wholesale_price_snapshot IS NULL)  AS missing_wholesale_price,
  count(*) FILTER (WHERE o.retail_price_snapshot IS NULL)     AS missing_retail_price,
  count(*) FILTER (WHERE o.medication_snapshot IS NULL)       AS missing_medication,
  count(*) FILTER (WHERE o.shipping_state_snapshot IS NULL)   AS missing_shipping_state,
  count(*) FILTER (WHERE o.provider_npi_snapshot IS NULL)     AS missing_provider_npi,
  count(*) FILTER (WHERE o.pharmacy_snapshot IS NULL)         AS missing_pharmacy,
  CASE WHEN o.clinic_id = 'a1000000-0000-0000-0000-000000000001'
       THEN string_agg(o.order_id::text, ', ' ORDER BY o.created_at)
  END                                                         AS sunrise_order_ids
FROM orders o
LEFT JOIN clinics c ON c.clinic_id = o.clinic_id
WHERE o.status = 'DRAFT'
  AND o.is_active = true
  AND o.deleted_at IS NULL
  AND (o.wholesale_price_snapshot IS NULL
    OR o.retail_price_snapshot IS NULL
    OR o.medication_snapshot IS NULL
    OR o.shipping_state_snapshot IS NULL
    OR o.provider_npi_snapshot IS NULL
    OR o.pharmacy_snapshot IS NULL)
GROUP BY o.clinic_id, c.name
ORDER BY drafts_missing_a_snapshot DESC, c.name;

ROLLBACK;
