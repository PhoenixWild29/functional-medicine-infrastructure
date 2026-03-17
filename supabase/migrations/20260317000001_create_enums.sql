-- Migration: Create all 10 enum types (7 V1.0 + 3 V2.0)
-- WO-1: Database Schema V2.0 - Enum Types & Core Tables

-- V1.0 Enums

CREATE TYPE order_status_enum AS ENUM (
  'DRAFT',
  'AWAITING_PAYMENT',
  'PAYMENT_EXPIRED',
  'PAID_PROCESSING',
  'SUBMISSION_PENDING',
  'SUBMISSION_FAILED',
  'FAX_QUEUED',
  'FAX_DELIVERED',
  'FAX_FAILED',
  'PHARMACY_ACKNOWLEDGED',
  'PHARMACY_COMPOUNDING',
  'PHARMACY_PROCESSING',
  'PHARMACY_REJECTED',
  'REROUTE_PENDING',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'ERROR_PAYMENT_FAILED',
  'ERROR_COMPLIANCE_HOLD',
  'REFUND_PENDING',
  'REFUNDED',
  'DISPUTED'
);

CREATE TYPE stripe_connect_status_enum AS ENUM (
  'PENDING',
  'ONBOARDING',
  'RESTRICTED',
  'ACTIVE',
  'DEACTIVATED'
);

CREATE TYPE app_role_enum AS ENUM (
  'clinic_admin',
  'provider',
  'medical_assistant',
  'ops_admin'
);

CREATE TYPE webhook_source_enum AS ENUM (
  'STRIPE',
  'DOCUMO',
  'PHARMACY'
);

CREATE TYPE sla_type_enum AS ENUM (
  'FAX_DELIVERY',
  'PHARMACY_ACKNOWLEDGE',
  'SHIPPING',
  'PAYMENT',
  'SUBMISSION',
  'PHARMACY_CONFIRMATION',
  'STATUS_UPDATE',
  'REROUTE_RESOLUTION'
);

CREATE TYPE fax_queue_status_enum AS ENUM (
  'RECEIVED',
  'MATCHED',
  'UNMATCHED',
  'PROCESSING',
  'ERROR'
);

CREATE TYPE regulatory_status_enum AS ENUM (
  'ACTIVE',
  'RECALLED',
  'DISCONTINUED',
  'SHORTAGE'
);

-- V2.0 Enums

CREATE TYPE integration_tier_enum AS ENUM (
  'TIER_1_API',
  'TIER_2_PORTAL',
  'TIER_3_HYBRID',
  'TIER_4_FAX'
);

CREATE TYPE adapter_submission_status_enum AS ENUM (
  'PENDING',
  'SUBMITTED',
  'CONFIRMED',
  'FAILED',
  'TIMEOUT',
  'PORTAL_ERROR',
  'MANUAL_REVIEW'
);

CREATE TYPE catalog_source_enum AS ENUM (
  'PHARMACY_API',
  'PORTAL_SCRAPE',
  'MANUAL_ENTRY',
  'BULK_IMPORT'
);
