-- Down migration for 20261016000001_payments_ledger.sql
-- Atomic: either the whole rollback lands or none of it does.
--
-- WARNING: drops the payments ledger, the pharmacy payables, their audit
-- log and the reconciliation runs, with every row in them. Export all
-- four first on any database that has recorded payments. Stripe keeps
-- its own record of the money; the backfill can rebuild the ledger lines
-- from the order snapshots, but not the payables' paid references.

BEGIN;

DROP TABLE IF EXISTS reconciliation_runs;
DROP TABLE IF EXISTS payable_events;
DROP TABLE IF EXISTS pharmacy_payables;
DROP TABLE IF EXISTS ledger_entries;
DROP FUNCTION IF EXISTS payments_append_only();

COMMIT;
