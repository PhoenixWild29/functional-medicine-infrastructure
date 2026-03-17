// AUTO-GENERATED — do not edit manually.
// Regenerate with: npm run db:types
// Source: supabase gen types typescript --project-id <ref>

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ============================================================
// ENUMS
// ============================================================

export type OrderStatusEnum =
  | 'DRAFT'
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_EXPIRED'
  | 'PAID_PROCESSING'
  | 'SUBMISSION_PENDING'
  | 'SUBMISSION_FAILED'
  | 'FAX_QUEUED'
  | 'FAX_DELIVERED'
  | 'FAX_FAILED'
  | 'PHARMACY_ACKNOWLEDGED'
  | 'PHARMACY_COMPOUNDING'
  | 'PHARMACY_PROCESSING'
  | 'PHARMACY_REJECTED'
  | 'REROUTE_PENDING'
  | 'READY_TO_SHIP'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'ERROR_PAYMENT_FAILED'
  | 'ERROR_COMPLIANCE_HOLD'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'DISPUTED'

export type StripeConnectStatusEnum =
  | 'PENDING'
  | 'ONBOARDING'
  | 'RESTRICTED'
  | 'ACTIVE'
  | 'DEACTIVATED'

export type AppRoleEnum =
  | 'clinic_admin'
  | 'provider'
  | 'medical_assistant'
  | 'ops_admin'

export type WebhookSourceEnum = 'STRIPE' | 'DOCUMO' | 'PHARMACY'

export type SlaTypeEnum =
  | 'FAX_DELIVERY'
  | 'PHARMACY_ACKNOWLEDGE'
  | 'SHIPPING'
  | 'PAYMENT'
  | 'SUBMISSION'
  | 'PHARMACY_CONFIRMATION'
  | 'STATUS_UPDATE'
  | 'REROUTE_RESOLUTION'

export type FaxQueueStatusEnum =
  | 'RECEIVED'
  | 'MATCHED'
  | 'UNMATCHED'
  | 'PROCESSING'
  | 'ERROR'

export type RegulatoryStatusEnum =
  | 'ACTIVE'
  | 'RECALLED'
  | 'DISCONTINUED'
  | 'SHORTAGE'

export type IntegrationTierEnum =
  | 'TIER_1_API'
  | 'TIER_2_PORTAL'
  | 'TIER_3_HYBRID'
  | 'TIER_4_FAX'

export type AdapterSubmissionStatusEnum =
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'PORTAL_ERROR'
  | 'MANUAL_REVIEW'

export type CatalogSourceEnum =
  | 'PHARMACY_API'
  | 'PORTAL_SCRAPE'
  | 'MANUAL_ENTRY'
  | 'BULK_IMPORT'

// ============================================================
// DATABASE SCHEMA
// ============================================================

export interface Database {
  public: {
    Tables: {
      clinics: {
        Row: {
          clinic_id: string
          name: string
          stripe_connect_account_id: string | null
          stripe_connect_status: StripeConnectStatusEnum
          logo_url: string | null
          default_markup_pct: number | null
          order_intake_blocked: boolean
          created_at: string
          updated_at: string
          deleted_at: string | null
          is_active: boolean
        }
        Insert: {
          clinic_id?: string
          name: string
          stripe_connect_account_id?: string | null
          stripe_connect_status?: StripeConnectStatusEnum
          logo_url?: string | null
          default_markup_pct?: number | null
          order_intake_blocked?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
        Update: {
          clinic_id?: string
          name?: string
          stripe_connect_account_id?: string | null
          stripe_connect_status?: StripeConnectStatusEnum
          logo_url?: string | null
          default_markup_pct?: number | null
          order_intake_blocked?: boolean
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
      }
      providers: {
        Row: {
          provider_id: string
          clinic_id: string
          first_name: string
          last_name: string
          npi_number: string
          license_state: string
          license_number: string
          dea_number: string | null
          signature_on_file: boolean
          created_at: string
          updated_at: string
          deleted_at: string | null
          is_active: boolean
        }
        Insert: {
          provider_id?: string
          clinic_id: string
          first_name: string
          last_name: string
          npi_number: string
          license_state: string
          license_number: string
          dea_number?: string | null
          signature_on_file?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
        Update: {
          provider_id?: string
          clinic_id?: string
          first_name?: string
          last_name?: string
          npi_number?: string
          license_state?: string
          license_number?: string
          dea_number?: string | null
          signature_on_file?: boolean
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
      }
      patients: {
        Row: {
          patient_id: string
          clinic_id: string
          first_name: string
          last_name: string
          date_of_birth: string
          phone: string
          email: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip: string | null
          sms_opt_in: boolean
          created_at: string
          updated_at: string
          deleted_at: string | null
          is_active: boolean
        }
        Insert: {
          patient_id?: string
          clinic_id: string
          first_name: string
          last_name: string
          date_of_birth: string
          phone: string
          email?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          sms_opt_in?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
        Update: {
          patient_id?: string
          clinic_id?: string
          first_name?: string
          last_name?: string
          date_of_birth?: string
          phone?: string
          email?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          sms_opt_in?: boolean
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
      }
      pharmacies: {
        Row: {
          pharmacy_id: string
          name: string
          slug: string
          phone: string | null
          fax_number: string | null
          email: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip: string | null
          website_url: string | null
          average_turnaround_days: number | null
          integration_tier: IntegrationTierEnum
          api_config_id: string | null
          portal_config_id: string | null
          supports_webhook: boolean
          adapter_status: string | null
          supports_real_time_status: boolean
          created_at: string
          updated_at: string
          deleted_at: string | null
          is_active: boolean
        }
        Insert: {
          pharmacy_id?: string
          name: string
          slug: string
          phone?: string | null
          fax_number?: string | null
          email?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          website_url?: string | null
          average_turnaround_days?: number | null
          integration_tier?: IntegrationTierEnum
          api_config_id?: string | null
          portal_config_id?: string | null
          supports_webhook?: boolean
          adapter_status?: string | null
          supports_real_time_status?: boolean
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
        Update: {
          pharmacy_id?: string
          name?: string
          slug?: string
          phone?: string | null
          fax_number?: string | null
          email?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          website_url?: string | null
          average_turnaround_days?: number | null
          integration_tier?: IntegrationTierEnum
          api_config_id?: string | null
          portal_config_id?: string | null
          supports_webhook?: boolean
          adapter_status?: string | null
          supports_real_time_status?: boolean
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
      }
      pharmacy_state_licenses: {
        Row: {
          pharmacy_id: string
          state_code: string
          license_number: string
          expiration_date: string
          is_active: boolean
          deleted_at: string | null
        }
        Insert: {
          pharmacy_id: string
          state_code: string
          license_number: string
          expiration_date: string
          is_active?: boolean
          deleted_at?: string | null
        }
        Update: {
          license_number?: string
          expiration_date?: string
          is_active?: boolean
          deleted_at?: string | null
        }
      }
      catalog: {
        Row: {
          item_id: string
          pharmacy_id: string
          medication_name: string
          form: string
          dose: string
          wholesale_price: number
          retail_price: number | null
          regulatory_status: RegulatoryStatusEnum
          requires_prior_auth: boolean
          normalized_id: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
          is_active: boolean
        }
        Insert: {
          item_id?: string
          pharmacy_id: string
          medication_name: string
          form: string
          dose: string
          wholesale_price: number
          retail_price?: number | null
          regulatory_status?: RegulatoryStatusEnum
          requires_prior_auth?: boolean
          normalized_id?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
        Update: {
          pharmacy_id?: string
          medication_name?: string
          form?: string
          dose?: string
          wholesale_price?: number
          retail_price?: number | null
          regulatory_status?: RegulatoryStatusEnum
          requires_prior_auth?: boolean
          normalized_id?: string | null
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
      }
      catalog_history: {
        Row: {
          history_id: string
          item_id: string
          field_changed: string
          old_value: string | null
          new_value: string | null
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          history_id?: string
          item_id: string
          field_changed: string
          old_value?: string | null
          new_value?: string | null
          changed_by?: string | null
          changed_at?: string
        }
        Update: Record<string, never> // append-only
      }
      orders: {
        Row: {
          order_id: string
          patient_id: string
          provider_id: string
          catalog_item_id: string
          clinic_id: string
          status: OrderStatusEnum
          quantity: number
          wholesale_price_snapshot: number | null
          retail_price_snapshot: number | null
          medication_snapshot: Json | null
          shipping_state_snapshot: string | null
          provider_npi_snapshot: string | null
          pharmacy_snapshot: Json | null
          locked_at: string | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          tracking_number: string | null
          carrier: string | null
          submission_tier: IntegrationTierEnum | null
          adapter_submission_id: string | null
          estimated_completion_at: string | null
          reroute_count: number
          sig_text: string | null
          order_number: string | null
          notes: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
          is_active: boolean
        }
        Insert: {
          order_id?: string
          patient_id: string
          provider_id: string
          catalog_item_id: string
          clinic_id: string
          status?: OrderStatusEnum
          quantity: number
          wholesale_price_snapshot?: number | null
          retail_price_snapshot?: number | null
          medication_snapshot?: Json | null
          shipping_state_snapshot?: string | null
          provider_npi_snapshot?: string | null
          pharmacy_snapshot?: Json | null
          locked_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          tracking_number?: string | null
          carrier?: string | null
          submission_tier?: IntegrationTierEnum | null
          adapter_submission_id?: string | null
          estimated_completion_at?: string | null
          reroute_count?: number
          sig_text?: string | null
          order_number?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
        Update: {
          order_id?: string
          patient_id?: string
          provider_id?: string
          catalog_item_id?: string
          clinic_id?: string
          status?: OrderStatusEnum
          quantity?: number
          wholesale_price_snapshot?: number | null
          retail_price_snapshot?: number | null
          medication_snapshot?: Json | null
          shipping_state_snapshot?: string | null
          provider_npi_snapshot?: string | null
          pharmacy_snapshot?: Json | null
          locked_at?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          tracking_number?: string | null
          carrier?: string | null
          submission_tier?: IntegrationTierEnum | null
          adapter_submission_id?: string | null
          estimated_completion_at?: string | null
          reroute_count?: number
          sig_text?: string | null
          order_number?: string | null
          notes?: string | null
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
      }
      order_status_history: {
        Row: {
          history_id: string
          order_id: string
          old_status: OrderStatusEnum
          new_status: OrderStatusEnum
          changed_by: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          history_id?: string
          order_id: string
          old_status: OrderStatusEnum
          new_status: OrderStatusEnum
          changed_by?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: Record<string, never> // append-only
      }
      webhook_events: {
        Row: {
          event_id: string
          source: WebhookSourceEnum
          event_type: string
          payload: Json
          order_id: string | null
          processed_at: string | null
          error: string | null
          created_at: string
        }
        Insert: {
          event_id?: string
          source: WebhookSourceEnum
          event_type: string
          payload: Json
          order_id?: string | null
          processed_at?: string | null
          error?: string | null
          created_at?: string
        }
        Update: Record<string, never> // append-only
      }
      order_sla_deadlines: {
        Row: {
          order_id: string
          sla_type: SlaTypeEnum
          deadline_at: string
          escalated: boolean
          escalated_at: string | null
          resolved_at: string | null
          acknowledged_by: string | null
          escalation_tier: number
          acknowledged_at: string | null
          resolution_notes: string | null
          created_at: string
          deleted_at: string | null
          is_active: boolean
        }
        Insert: {
          order_id: string
          sla_type: SlaTypeEnum
          deadline_at: string
          escalated?: boolean
          escalated_at?: string | null
          resolved_at?: string | null
          acknowledged_by?: string | null
          escalation_tier?: number
          acknowledged_at?: string | null
          resolution_notes?: string | null
          created_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
        Update: {
          deadline_at?: string
          escalated?: boolean
          escalated_at?: string | null
          resolved_at?: string | null
          acknowledged_by?: string | null
          escalation_tier?: number
          acknowledged_at?: string | null
          resolution_notes?: string | null
          deleted_at?: string | null
          is_active?: boolean
        }
      }
      inbound_fax_queue: {
        Row: {
          fax_id: string
          documo_fax_id: string
          from_number: string
          page_count: number
          storage_path: string
          status: FaxQueueStatusEnum
          matched_pharmacy_id: string | null
          matched_order_id: string | null
          processed_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
          deleted_at: string | null
          is_active: boolean
        }
        Insert: {
          fax_id?: string
          documo_fax_id: string
          from_number: string
          page_count: number
          storage_path: string
          status?: FaxQueueStatusEnum
          matched_pharmacy_id?: string | null
          matched_order_id?: string | null
          processed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
        Update: {
          status?: FaxQueueStatusEnum
          matched_pharmacy_id?: string | null
          matched_order_id?: string | null
          processed_by?: string | null
          notes?: string | null
          updated_at?: string
          deleted_at?: string | null
          is_active?: boolean
        }
      }
      pharmacy_api_configs: {
        Row: {
          config_id: string
          pharmacy_id: string
          base_url: string
          vault_secret_id: string
          webhook_secret_vault_id: string | null
          endpoints: Json
          api_version: string | null
          timeout_ms: number
          retry_config: Json | null
          rate_limit: Json | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          config_id?: string
          pharmacy_id: string
          base_url: string
          vault_secret_id: string
          webhook_secret_vault_id?: string | null
          endpoints: Json
          api_version?: string | null
          timeout_ms?: number
          retry_config?: Json | null
          rate_limit?: Json | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          base_url?: string
          vault_secret_id?: string
          webhook_secret_vault_id?: string | null
          endpoints?: Json
          api_version?: string | null
          timeout_ms?: number
          retry_config?: Json | null
          rate_limit?: Json | null
          is_active?: boolean
          updated_at?: string
        }
      }
      pharmacy_portal_configs: {
        Row: {
          config_id: string
          pharmacy_id: string
          portal_url: string
          username_vault_id: string
          password_vault_id: string
          login_selector: Json | null
          order_form_selector: Json | null
          confirmation_selector: Json | null
          login_flow: Json | null
          submit_flow: Json | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          config_id?: string
          pharmacy_id: string
          portal_url: string
          username_vault_id: string
          password_vault_id: string
          login_selector?: Json | null
          order_form_selector?: Json | null
          confirmation_selector?: Json | null
          login_flow?: Json | null
          submit_flow?: Json | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          portal_url?: string
          username_vault_id?: string
          password_vault_id?: string
          login_selector?: Json | null
          order_form_selector?: Json | null
          confirmation_selector?: Json | null
          login_flow?: Json | null
          submit_flow?: Json | null
          is_active?: boolean
          updated_at?: string
        }
      }
      adapter_submissions: {
        Row: {
          submission_id: string
          order_id: string
          pharmacy_id: string
          tier: IntegrationTierEnum
          status: AdapterSubmissionStatusEnum
          request_payload: Json | null
          response_payload: Json | null
          external_reference_id: string | null
          ai_confidence_score: number | null
          screenshot_url: string | null
          error_code: string | null
          error_message: string | null
          attempt_number: number
          created_at: string
          completed_at: string | null
        }
        Insert: {
          submission_id?: string
          order_id: string
          pharmacy_id: string
          tier: IntegrationTierEnum
          status?: AdapterSubmissionStatusEnum
          request_payload?: Json | null
          response_payload?: Json | null
          external_reference_id?: string | null
          ai_confidence_score?: number | null
          screenshot_url?: string | null
          error_code?: string | null
          error_message?: string | null
          attempt_number?: number
          created_at?: string
          completed_at?: string | null
        }
        Update: Record<string, never> // append-only
      }
      normalized_catalog: {
        Row: {
          normalized_id: string
          canonical_name: string
          form: string
          dose: string
          pharmacy_id: string
          source_item_id: string | null
          source: CatalogSourceEnum
          wholesale_price: number | null
          regulatory_status: RegulatoryStatusEnum
          state_availability: Json | null
          confidence_score: number | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          normalized_id?: string
          canonical_name: string
          form: string
          dose: string
          pharmacy_id: string
          source_item_id?: string | null
          source: CatalogSourceEnum
          wholesale_price?: number | null
          regulatory_status?: RegulatoryStatusEnum
          state_availability?: Json | null
          confidence_score?: number | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          canonical_name?: string
          form?: string
          dose?: string
          wholesale_price?: number | null
          regulatory_status?: RegulatoryStatusEnum
          state_availability?: Json | null
          confidence_score?: number | null
          is_active?: boolean
          updated_at?: string
        }
      }
      pharmacy_webhook_events: {
        Row: {
          id: string
          pharmacy_id: string
          event_id: string
          event_type: string
          payload: Json
          order_id: string | null
          submission_id: string | null
          external_order_id: string | null
          signature_verified: boolean
          retry_count: number
          processed_at: string | null
          error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pharmacy_id: string
          event_id: string
          event_type: string
          payload: Json
          order_id?: string | null
          submission_id?: string | null
          external_order_id?: string | null
          signature_verified?: boolean
          retry_count?: number
          processed_at?: string | null
          error?: string | null
          created_at?: string
        }
        Update: Record<string, never> // append-only
      }
      sms_log: {
        Row: {
          sms_id: string
          order_id: string | null
          patient_id: string | null
          template_name: string
          twilio_message_sid: string
          to_number: string
          status: string
          error_code: string | null
          error_message: string | null
          created_at: string
          delivered_at: string | null
        }
        Insert: {
          sms_id?: string
          order_id?: string | null
          patient_id?: string | null
          template_name: string
          twilio_message_sid: string
          to_number: string
          status?: string
          error_code?: string | null
          error_message?: string | null
          created_at?: string
          delivered_at?: string | null
        }
        Update: Record<string, never> // append-only
      }
      sms_templates: {
        Row: {
          template_id: string
          template_name: string
          body_template: string
          trigger_event: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          template_id?: string
          template_name: string
          body_template: string
          trigger_event: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          trigger_event?: string
          is_active?: boolean
          updated_at?: string
        }
      }
      transfer_failures: {
        Row: {
          failure_id: string
          transfer_id: string
          order_id: string
          clinic_id: string
          amount: number
          currency: string
          failure_code: string
          failure_message: string | null
          created_at: string
        }
        Insert: {
          failure_id?: string
          transfer_id: string
          order_id: string
          clinic_id: string
          amount: number
          currency?: string
          failure_code: string
          failure_message?: string | null
          created_at?: string
        }
        Update: Record<string, never> // append-only
      }
      disputes: {
        Row: {
          dispute_id: string
          order_id: string
          payment_intent_id: string
          reason: string | null
          amount: number
          currency: string
          status: string
          evidence_collected_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          dispute_id: string
          order_id: string
          payment_intent_id: string
          reason?: string | null
          amount: number
          currency?: string
          status: string
          evidence_collected_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          reason?: string | null
          status?: string
          evidence_collected_at?: string | null
          updated_at?: string
        }
      }
    }
    Views: Record<string, never>
    Functions: {
      create_vault_secret: {
        Args: { p_name: string; p_secret: string }
        Returns: string
      }
      rotate_vault_secret: {
        Args: { p_secret_id: string; p_new_secret: string }
        Returns: undefined
      }
      delete_vault_secret: {
        Args: { p_secret_id: string }
        Returns: undefined
      }
    }
    Enums: {
      order_status_enum: OrderStatusEnum
      stripe_connect_status_enum: StripeConnectStatusEnum
      app_role_enum: AppRoleEnum
      webhook_source_enum: WebhookSourceEnum
      sla_type_enum: SlaTypeEnum
      fax_queue_status_enum: FaxQueueStatusEnum
      regulatory_status_enum: RegulatoryStatusEnum
      integration_tier_enum: IntegrationTierEnum
      adapter_submission_status_enum: AdapterSubmissionStatusEnum
      catalog_source_enum: CatalogSourceEnum
    }
  }
}

// ============================================================
// CONVENIENCE TYPE ALIASES
// ============================================================

type Tables = Database['public']['Tables']

export type Clinic = Tables['clinics']['Row']
export type Provider = Tables['providers']['Row']
export type Patient = Tables['patients']['Row']
export type Pharmacy = Tables['pharmacies']['Row']
export type PharmacyStateLicense = Tables['pharmacy_state_licenses']['Row']
export type CatalogItem = Tables['catalog']['Row']
export type CatalogHistory = Tables['catalog_history']['Row']
export type Order = Tables['orders']['Row']
export type OrderStatusHistory = Tables['order_status_history']['Row']
export type WebhookEvent = Tables['webhook_events']['Row']
export type OrderSlaDeadline = Tables['order_sla_deadlines']['Row']
export type InboundFaxQueue = Tables['inbound_fax_queue']['Row']
export type PharmacyApiConfig = Tables['pharmacy_api_configs']['Row']
export type PharmacyPortalConfig = Tables['pharmacy_portal_configs']['Row']
export type AdapterSubmission = Tables['adapter_submissions']['Row']
export type NormalizedCatalog = Tables['normalized_catalog']['Row']
export type PharmacyWebhookEvent = Tables['pharmacy_webhook_events']['Row']
export type SmsLog = Tables['sms_log']['Row']
export type SmsTemplate = Tables['sms_templates']['Row']
export type TransferFailure = Tables['transfer_failures']['Row']
export type Dispute = Tables['disputes']['Row']

// Insert types
export type InsertOrder = Tables['orders']['Insert']
export type InsertPatient = Tables['patients']['Insert']
export type InsertProvider = Tables['providers']['Insert']
export type InsertOrderStatusHistory = Tables['order_status_history']['Insert']
export type InsertAdapterSubmission = Tables['adapter_submissions']['Insert']
export type InsertSmsLog = Tables['sms_log']['Insert']
