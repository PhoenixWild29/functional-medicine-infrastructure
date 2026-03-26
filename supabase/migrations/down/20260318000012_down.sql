-- DOWN: 20260318000012_wo21_tier3_spec.sql
-- Removes webhook_events and webhook_secret_encrypted columns from pharmacy_api_configs
-- and drops idx_pharmacies_integration_tier.
-- NOTE: TIER_3_SPEC enum value cannot be removed from integration_tier_enum.

DROP INDEX IF EXISTS idx_pharmacies_integration_tier;
ALTER TABLE pharmacy_api_configs
  DROP COLUMN IF EXISTS webhook_events,
  DROP COLUMN IF EXISTS webhook_secret_encrypted;
