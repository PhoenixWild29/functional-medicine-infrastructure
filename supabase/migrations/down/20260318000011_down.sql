-- DOWN: 20260318000011_wo46_check_constraints.sql
-- Removes CHECK constraints added to pharmacy_api_configs and pharmacy_portal_configs.

ALTER TABLE pharmacy_api_configs
  DROP CONSTRAINT IF EXISTS chk_circuit_breaker_threshold_positive;

ALTER TABLE pharmacy_portal_configs
  DROP CONSTRAINT IF EXISTS chk_poll_interval_minutes_positive;
