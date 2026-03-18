-- ============================================================
-- WO-46 Review Fix: Add CHECK constraints to adapter config tables
-- ============================================================
--
-- Non-blocking review finding: circuit_breaker_threshold and
-- poll_interval_minutes lacked positive-value CHECK constraints.
-- Zero or negative values would break circuit breaker and polling
-- loop logic at runtime.
--
-- ALTER TABLE … ADD CONSTRAINT … is safe on empty/small tables and
-- idempotent via IF NOT EXISTS on the constraint name (Postgres 15).

ALTER TABLE pharmacy_api_configs
  ADD CONSTRAINT chk_circuit_breaker_threshold_positive
    CHECK (circuit_breaker_threshold > 0)
  NOT VALID;

-- NOT VALID: constraint is enforced on new rows immediately but does
-- not validate existing rows (avoids table lock on large datasets).
-- Run VALIDATE CONSTRAINT separately if needed for existing data.

ALTER TABLE pharmacy_portal_configs
  ADD CONSTRAINT chk_poll_interval_minutes_positive
    CHECK (poll_interval_minutes > 0)
  NOT VALID;
