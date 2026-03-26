-- ============================================================
-- WO-36: Inbound Fax Triage Queue
-- ============================================================
-- Extends fax_queue_status_enum to add PROCESSED and ARCHIVED
-- states required by the triage disposition workflow.
--
-- State flow: RECEIVED → MATCHED/UNMATCHED → PROCESSED → ARCHIVED

-- NB-09: defensive additions for PROCESSING and ERROR in case not present in prior migration
ALTER TYPE fax_queue_status_enum ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE fax_queue_status_enum ADD VALUE IF NOT EXISTS 'ERROR';
ALTER TYPE fax_queue_status_enum ADD VALUE IF NOT EXISTS 'PROCESSED';
ALTER TYPE fax_queue_status_enum ADD VALUE IF NOT EXISTS 'ARCHIVED';
