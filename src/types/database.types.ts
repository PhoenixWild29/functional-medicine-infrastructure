export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      adapter_submissions: {
        Row: {
          acknowledged_at: string | null
          ai_confidence_score: number | null
          attempt_number: number
          completed_at: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          external_reference_id: string | null
          metadata: Json | null
          order_id: string
          pharmacy_id: string
          portal_last_polled_at: string | null
          request_payload: Json | null
          response_payload: Json | null
          screenshot_url: string | null
          status: Database["public"]["Enums"]["adapter_submission_status_enum"]
          submission_id: string
          submitted_at: string | null
          tier: Database["public"]["Enums"]["integration_tier_enum"]
        }
        Insert: {
          acknowledged_at?: string | null
          ai_confidence_score?: number | null
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          external_reference_id?: string | null
          metadata?: Json | null
          order_id: string
          pharmacy_id: string
          portal_last_polled_at?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          screenshot_url?: string | null
          status?: Database["public"]["Enums"]["adapter_submission_status_enum"]
          submission_id?: string
          submitted_at?: string | null
          tier: Database["public"]["Enums"]["integration_tier_enum"]
        }
        Update: {
          acknowledged_at?: string | null
          ai_confidence_score?: number | null
          attempt_number?: number
          completed_at?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          external_reference_id?: string | null
          metadata?: Json | null
          order_id?: string
          pharmacy_id?: string
          portal_last_polled_at?: string | null
          request_payload?: Json | null
          response_payload?: Json | null
          screenshot_url?: string | null
          status?: Database["public"]["Enums"]["adapter_submission_status_enum"]
          submission_id?: string
          submitted_at?: string | null
          tier?: Database["public"]["Enums"]["integration_tier_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "adapter_submissions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "adapter_submissions_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
        ]
      }
      catalog: {
        Row: {
          created_at: string
          dea_schedule: number
          deleted_at: string | null
          dose: string
          form: string
          is_active: boolean
          item_id: string
          medication_name: string
          normalized_id: string | null
          pharmacy_id: string
          regulatory_status: Database["public"]["Enums"]["regulatory_status_enum"]
          requires_prior_auth: boolean
          retail_price: number | null
          updated_at: string
          upload_history_id: string | null
          wholesale_price: number
        }
        Insert: {
          created_at?: string
          dea_schedule?: number
          deleted_at?: string | null
          dose: string
          form: string
          is_active?: boolean
          item_id?: string
          medication_name: string
          normalized_id?: string | null
          pharmacy_id: string
          regulatory_status?: Database["public"]["Enums"]["regulatory_status_enum"]
          requires_prior_auth?: boolean
          retail_price?: number | null
          updated_at?: string
          upload_history_id?: string | null
          wholesale_price: number
        }
        Update: {
          created_at?: string
          dea_schedule?: number
          deleted_at?: string | null
          dose?: string
          form?: string
          is_active?: boolean
          item_id?: string
          medication_name?: string
          normalized_id?: string | null
          pharmacy_id?: string
          regulatory_status?: Database["public"]["Enums"]["regulatory_status_enum"]
          requires_prior_auth?: boolean
          retail_price?: number | null
          updated_at?: string
          upload_history_id?: string | null
          wholesale_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_normalized_id_fkey"
            columns: ["normalized_id"]
            isOneToOne: false
            referencedRelation: "normalized_catalog"
            referencedColumns: ["normalized_id"]
          },
          {
            foreignKeyName: "catalog_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
          {
            foreignKeyName: "catalog_upload_history_id_fkey"
            columns: ["upload_history_id"]
            isOneToOne: false
            referencedRelation: "catalog_upload_history"
            referencedColumns: ["history_id"]
          },
        ]
      }
      catalog_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          field_changed: string
          history_id: string
          item_id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          field_changed: string
          history_id?: string
          item_id: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          field_changed?: string
          history_id?: string
          item_id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "catalog"
            referencedColumns: ["item_id"]
          },
        ]
      }
      catalog_upload_history: {
        Row: {
          delta_summary: Json
          history_id: string
          is_active: boolean
          notes: string | null
          pharmacy_id: string
          row_count: number
          upload_source: string
          uploaded_at: string
          uploader: string
          version_number: number
        }
        Insert: {
          delta_summary?: Json
          history_id?: string
          is_active?: boolean
          notes?: string | null
          pharmacy_id: string
          row_count?: number
          upload_source?: string
          uploaded_at?: string
          uploader: string
          version_number: number
        }
        Update: {
          delta_summary?: Json
          history_id?: string
          is_active?: boolean
          notes?: string | null
          pharmacy_id?: string
          row_count?: number
          upload_source?: string
          uploaded_at?: string
          uploader?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_upload_history_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
        ]
      }
      circuit_breaker_state: {
        Row: {
          cooldown_until: string | null
          failure_count: number
          last_failure_at: string | null
          pharmacy_id: string
          state: string
          tripped_by_submission_id: string | null
          updated_at: string
        }
        Insert: {
          cooldown_until?: string | null
          failure_count?: number
          last_failure_at?: string | null
          pharmacy_id: string
          state?: string
          tripped_by_submission_id?: string | null
          updated_at?: string
        }
        Update: {
          cooldown_until?: string | null
          failure_count?: number
          last_failure_at?: string | null
          pharmacy_id?: string
          state?: string
          tripped_by_submission_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuit_breaker_state_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
          {
            foreignKeyName: "circuit_breaker_state_tripped_by_submission_id_fkey"
            columns: ["tripped_by_submission_id"]
            isOneToOne: false
            referencedRelation: "adapter_submissions"
            referencedColumns: ["submission_id"]
          },
        ]
      }
      clinic_notifications: {
        Row: {
          acknowledged_at: string | null
          clinic_id: string
          created_at: string
          message: string
          notification_id: string
          notification_type: string
          order_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          clinic_id: string
          created_at?: string
          message: string
          notification_id?: string
          notification_type: string
          order_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          clinic_id?: string
          created_at?: string
          message?: string
          notification_id?: string
          notification_type?: string
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_notifications_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["clinic_id"]
          },
          {
            foreignKeyName: "clinic_notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
        ]
      }
      clinics: {
        Row: {
          clinic_id: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          default_markup_pct: number | null
          deleted_at: string | null
          is_active: boolean
          logo_url: string | null
          name: string
          order_intake_blocked: boolean
          stripe_connect_account_id: string | null
          stripe_connect_status: Database["public"]["Enums"]["stripe_connect_status_enum"]
          updated_at: string
        }
        Insert: {
          clinic_id?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          default_markup_pct?: number | null
          deleted_at?: string | null
          is_active?: boolean
          logo_url?: string | null
          name: string
          order_intake_blocked?: boolean
          stripe_connect_account_id?: string | null
          stripe_connect_status?: Database["public"]["Enums"]["stripe_connect_status_enum"]
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          default_markup_pct?: number | null
          deleted_at?: string | null
          is_active?: boolean
          logo_url?: string | null
          name?: string
          order_intake_blocked?: boolean
          stripe_connect_account_id?: string | null
          stripe_connect_status?: Database["public"]["Enums"]["stripe_connect_status_enum"]
          updated_at?: string
        }
        Relationships: []
      }
      disputes: {
        Row: {
          amount: number
          created_at: string
          currency: string
          dispute_id: string
          evidence_collected_at: string | null
          order_id: string
          payment_intent_id: string
          reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          dispute_id: string
          evidence_collected_at?: string | null
          order_id: string
          payment_intent_id: string
          reason?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          dispute_id?: string
          evidence_collected_at?: string | null
          order_id?: string
          payment_intent_id?: string
          reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
        ]
      }
      dosage_forms: {
        Row: {
          calculation_method: string | null
          default_route: string | null
          dosage_form_id: string
          is_sterile: boolean
          name: string
          requires_injection_supplies: boolean
          sort_order: number
        }
        Insert: {
          calculation_method?: string | null
          default_route?: string | null
          dosage_form_id?: string
          is_sterile?: boolean
          name: string
          requires_injection_supplies?: boolean
          sort_order?: number
        }
        Update: {
          calculation_method?: string | null
          default_route?: string | null
          dosage_form_id?: string
          is_sterile?: boolean
          name?: string
          requires_injection_supplies?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      formulation_ingredients: {
        Row: {
          concentration_per_unit: string
          concentration_unit: string | null
          concentration_value: number | null
          formulation_id: string
          formulation_ingredient_id: string
          ingredient_id: string
          role: string
          salt_form_id: string | null
          sort_order: number
        }
        Insert: {
          concentration_per_unit: string
          concentration_unit?: string | null
          concentration_value?: number | null
          formulation_id: string
          formulation_ingredient_id?: string
          ingredient_id: string
          role?: string
          salt_form_id?: string | null
          sort_order?: number
        }
        Update: {
          concentration_per_unit?: string
          concentration_unit?: string | null
          concentration_value?: number | null
          formulation_id?: string
          formulation_ingredient_id?: string
          ingredient_id?: string
          role?: string
          salt_form_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "formulation_ingredients_formulation_id_fkey"
            columns: ["formulation_id"]
            isOneToOne: false
            referencedRelation: "formulations"
            referencedColumns: ["formulation_id"]
          },
          {
            foreignKeyName: "formulation_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["ingredient_id"]
          },
          {
            foreignKeyName: "formulation_ingredients_salt_form_id_fkey"
            columns: ["salt_form_id"]
            isOneToOne: false
            referencedRelation: "salt_forms"
            referencedColumns: ["salt_form_id"]
          },
        ]
      }
      formulations: {
        Row: {
          concentration: string | null
          concentration_unit: string | null
          concentration_value: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          dosage_form_id: string
          excipient_base: string | null
          formulation_id: string
          is_active: boolean
          is_combination: boolean
          name: string
          route_id: string
          salt_form_id: string | null
          total_ingredients: number
          updated_at: string
        }
        Insert: {
          concentration?: string | null
          concentration_unit?: string | null
          concentration_value?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          dosage_form_id: string
          excipient_base?: string | null
          formulation_id?: string
          is_active?: boolean
          is_combination?: boolean
          name: string
          route_id: string
          salt_form_id?: string | null
          total_ingredients?: number
          updated_at?: string
        }
        Update: {
          concentration?: string | null
          concentration_unit?: string | null
          concentration_value?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          dosage_form_id?: string
          excipient_base?: string | null
          formulation_id?: string
          is_active?: boolean
          is_combination?: boolean
          name?: string
          route_id?: string
          salt_form_id?: string | null
          total_ingredients?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "formulations_dosage_form_id_fkey"
            columns: ["dosage_form_id"]
            isOneToOne: false
            referencedRelation: "dosage_forms"
            referencedColumns: ["dosage_form_id"]
          },
          {
            foreignKeyName: "formulations_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes_of_administration"
            referencedColumns: ["route_id"]
          },
          {
            foreignKeyName: "formulations_salt_form_id_fkey"
            columns: ["salt_form_id"]
            isOneToOne: false
            referencedRelation: "salt_forms"
            referencedColumns: ["salt_form_id"]
          },
        ]
      }
      inbound_fax_queue: {
        Row: {
          created_at: string
          deleted_at: string | null
          documo_fax_id: string
          fax_id: string
          from_number: string
          is_active: boolean
          matched_order_id: string | null
          matched_pharmacy_id: string | null
          notes: string | null
          page_count: number
          processed_by: string | null
          status: Database["public"]["Enums"]["fax_queue_status_enum"]
          storage_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          documo_fax_id: string
          fax_id?: string
          from_number: string
          is_active?: boolean
          matched_order_id?: string | null
          matched_pharmacy_id?: string | null
          notes?: string | null
          page_count: number
          processed_by?: string | null
          status?: Database["public"]["Enums"]["fax_queue_status_enum"]
          storage_path: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          documo_fax_id?: string
          fax_id?: string
          from_number?: string
          is_active?: boolean
          matched_order_id?: string | null
          matched_pharmacy_id?: string | null
          notes?: string | null
          page_count?: number
          processed_by?: string | null
          status?: Database["public"]["Enums"]["fax_queue_status_enum"]
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbound_fax_queue_matched_order_id_fkey"
            columns: ["matched_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "inbound_fax_queue_matched_pharmacy_id_fkey"
            columns: ["matched_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
        ]
      }
      ingredients: {
        Row: {
          common_name: string
          created_at: string
          dea_schedule: number | null
          deleted_at: string | null
          description: string | null
          fda_alert_message: string | null
          fda_alert_status: string | null
          ingredient_id: string
          is_active: boolean
          is_hazardous: boolean
          therapeutic_category: string | null
          updated_at: string
        }
        Insert: {
          common_name: string
          created_at?: string
          dea_schedule?: number | null
          deleted_at?: string | null
          description?: string | null
          fda_alert_message?: string | null
          fda_alert_status?: string | null
          ingredient_id?: string
          is_active?: boolean
          is_hazardous?: boolean
          therapeutic_category?: string | null
          updated_at?: string
        }
        Update: {
          common_name?: string
          created_at?: string
          dea_schedule?: number | null
          deleted_at?: string | null
          description?: string | null
          fda_alert_message?: string | null
          fda_alert_status?: string | null
          ingredient_id?: string
          is_active?: boolean
          is_hazardous?: boolean
          therapeutic_category?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      normalized_catalog: {
        Row: {
          canonical_name: string
          confidence_score: number | null
          created_at: string
          dose: string
          form: string
          is_active: boolean
          normalized_id: string
          pharmacy_id: string
          regulatory_status: Database["public"]["Enums"]["regulatory_status_enum"]
          source: Database["public"]["Enums"]["catalog_source_enum"]
          source_item_id: string | null
          state_availability: Json | null
          updated_at: string
          wholesale_price: number | null
        }
        Insert: {
          canonical_name: string
          confidence_score?: number | null
          created_at?: string
          dose: string
          form: string
          is_active?: boolean
          normalized_id?: string
          pharmacy_id: string
          regulatory_status?: Database["public"]["Enums"]["regulatory_status_enum"]
          source: Database["public"]["Enums"]["catalog_source_enum"]
          source_item_id?: string | null
          state_availability?: Json | null
          updated_at?: string
          wholesale_price?: number | null
        }
        Update: {
          canonical_name?: string
          confidence_score?: number | null
          created_at?: string
          dose?: string
          form?: string
          is_active?: boolean
          normalized_id?: string
          pharmacy_id?: string
          regulatory_status?: Database["public"]["Enums"]["regulatory_status_enum"]
          source?: Database["public"]["Enums"]["catalog_source_enum"]
          source_item_id?: string | null
          state_availability?: Json | null
          updated_at?: string
          wholesale_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "normalized_catalog_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
          {
            foreignKeyName: "normalized_catalog_source_item_id_fkey"
            columns: ["source_item_id"]
            isOneToOne: false
            referencedRelation: "catalog"
            referencedColumns: ["item_id"]
          },
        ]
      }
      ops_alert_queue: {
        Row: {
          alert_id: string
          alert_type: string
          created_at: string
          message: string
          metadata: Json | null
          sent_at: string | null
          severity: string
          slack_channel: string
        }
        Insert: {
          alert_id?: string
          alert_type: string
          created_at?: string
          message: string
          metadata?: Json | null
          sent_at?: string | null
          severity?: string
          slack_channel?: string
        }
        Update: {
          alert_id?: string
          alert_type?: string
          created_at?: string
          message?: string
          metadata?: Json | null
          sent_at?: string | null
          severity?: string
          slack_channel?: string
        }
        Relationships: []
      }
      order_sla_deadlines: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          cascade_attempted: boolean
          created_at: string
          deadline_at: string
          deleted_at: string | null
          escalated: boolean
          escalated_at: string | null
          escalation_tier: number
          is_active: boolean
          last_alerted_at: string | null
          order_id: string
          resolution_notes: string | null
          resolved_at: string | null
          sla_type: Database["public"]["Enums"]["sla_type_enum"]
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          cascade_attempted?: boolean
          created_at?: string
          deadline_at: string
          deleted_at?: string | null
          escalated?: boolean
          escalated_at?: string | null
          escalation_tier?: number
          is_active?: boolean
          last_alerted_at?: string | null
          order_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          sla_type: Database["public"]["Enums"]["sla_type_enum"]
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          cascade_attempted?: boolean
          created_at?: string
          deadline_at?: string
          deleted_at?: string | null
          escalated?: boolean
          escalated_at?: string | null
          escalation_tier?: number
          is_active?: boolean
          last_alerted_at?: string | null
          order_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          sla_type?: Database["public"]["Enums"]["sla_type_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "order_sla_deadlines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          history_id: string
          metadata: Json | null
          new_status: Database["public"]["Enums"]["order_status_enum"]
          old_status: Database["public"]["Enums"]["order_status_enum"]
          order_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          history_id?: string
          metadata?: Json | null
          new_status: Database["public"]["Enums"]["order_status_enum"]
          old_status: Database["public"]["Enums"]["order_status_enum"]
          order_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          history_id?: string
          metadata?: Json | null
          new_status?: Database["public"]["Enums"]["order_status_enum"]
          old_status?: Database["public"]["Enums"]["order_status_enum"]
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
        ]
      }
      orders: {
        Row: {
          adapter_submission_id: string | null
          carrier: string | null
          catalog_item_id: string
          clinic_id: string
          created_at: string
          deleted_at: string | null
          documo_fax_id: string | null
          estimated_completion_at: string | null
          fax_attempt_count: number
          is_active: boolean
          locked_at: string | null
          medication_snapshot: Json | null
          notes: string | null
          ops_assignee: string | null
          order_id: string
          order_number: string | null
          patient_id: string
          pharmacy_id: string | null
          pharmacy_snapshot: Json | null
          provider_id: string
          provider_npi_snapshot: string | null
          provider_signature_hash_snapshot: string | null
          quantity: number
          reroute_count: number
          retail_price_snapshot: number | null
          shipping_state_snapshot: string | null
          sig_text: string | null
          status: Database["public"]["Enums"]["order_status_enum"]
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          submission_tier:
            | Database["public"]["Enums"]["integration_tier_enum"]
            | null
          tracking_number: string | null
          updated_at: string
          wholesale_price_snapshot: number | null
        }
        Insert: {
          adapter_submission_id?: string | null
          carrier?: string | null
          catalog_item_id: string
          clinic_id: string
          created_at?: string
          deleted_at?: string | null
          documo_fax_id?: string | null
          estimated_completion_at?: string | null
          fax_attempt_count?: number
          is_active?: boolean
          locked_at?: string | null
          medication_snapshot?: Json | null
          notes?: string | null
          ops_assignee?: string | null
          order_id?: string
          order_number?: string | null
          patient_id: string
          pharmacy_id?: string | null
          pharmacy_snapshot?: Json | null
          provider_id: string
          provider_npi_snapshot?: string | null
          provider_signature_hash_snapshot?: string | null
          quantity: number
          reroute_count?: number
          retail_price_snapshot?: number | null
          shipping_state_snapshot?: string | null
          sig_text?: string | null
          status?: Database["public"]["Enums"]["order_status_enum"]
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          submission_tier?:
            | Database["public"]["Enums"]["integration_tier_enum"]
            | null
          tracking_number?: string | null
          updated_at?: string
          wholesale_price_snapshot?: number | null
        }
        Update: {
          adapter_submission_id?: string | null
          carrier?: string | null
          catalog_item_id?: string
          clinic_id?: string
          created_at?: string
          deleted_at?: string | null
          documo_fax_id?: string | null
          estimated_completion_at?: string | null
          fax_attempt_count?: number
          is_active?: boolean
          locked_at?: string | null
          medication_snapshot?: Json | null
          notes?: string | null
          ops_assignee?: string | null
          order_id?: string
          order_number?: string | null
          patient_id?: string
          pharmacy_id?: string | null
          pharmacy_snapshot?: Json | null
          provider_id?: string
          provider_npi_snapshot?: string | null
          provider_signature_hash_snapshot?: string | null
          quantity?: number
          reroute_count?: number
          retail_price_snapshot?: number | null
          shipping_state_snapshot?: string | null
          sig_text?: string | null
          status?: Database["public"]["Enums"]["order_status_enum"]
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          submission_tier?:
            | Database["public"]["Enums"]["integration_tier_enum"]
            | null
          tracking_number?: string | null
          updated_at?: string
          wholesale_price_snapshot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_adapter_submission_id_fkey"
            columns: ["adapter_submission_id"]
            isOneToOne: false
            referencedRelation: "adapter_submissions"
            referencedColumns: ["submission_id"]
          },
          {
            foreignKeyName: "orders_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "orders_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["clinic_id"]
          },
          {
            foreignKeyName: "orders_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["patient_id"]
          },
          {
            foreignKeyName: "orders_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
          {
            foreignKeyName: "orders_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["provider_id"]
          },
        ]
      }
      patients: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          city: string | null
          clinic_id: string
          created_at: string
          date_of_birth: string
          deleted_at: string | null
          email: string | null
          first_name: string
          is_active: boolean
          last_name: string
          patient_id: string
          phone: string
          sms_opt_in: boolean
          state: string | null
          updated_at: string
          zip: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          clinic_id: string
          created_at?: string
          date_of_birth: string
          deleted_at?: string | null
          email?: string | null
          first_name: string
          is_active?: boolean
          last_name: string
          patient_id?: string
          phone: string
          sms_opt_in?: boolean
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          clinic_id?: string
          created_at?: string
          date_of_birth?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string
          is_active?: boolean
          last_name?: string
          patient_id?: string
          phone?: string
          sms_opt_in?: boolean
          state?: string | null
          updated_at?: string
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["clinic_id"]
          },
        ]
      }
      pharmacies: {
        Row: {
          adapter_status: string | null
          address_line1: string | null
          address_line2: string | null
          api_config_id: string | null
          average_turnaround_days: number | null
          catalog_last_synced_at: string | null
          city: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          fax_number: string | null
          integration_tier: Database["public"]["Enums"]["integration_tier_enum"]
          is_active: boolean
          name: string
          pharmacy_id: string
          pharmacy_status: string
          phone: string | null
          portal_config_id: string | null
          slug: string
          state: string | null
          supports_real_time_status: boolean
          supports_webhook: boolean
          timezone: string
          updated_at: string
          website_url: string | null
          zip: string | null
        }
        Insert: {
          adapter_status?: string | null
          address_line1?: string | null
          address_line2?: string | null
          api_config_id?: string | null
          average_turnaround_days?: number | null
          catalog_last_synced_at?: string | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          fax_number?: string | null
          integration_tier?: Database["public"]["Enums"]["integration_tier_enum"]
          is_active?: boolean
          name: string
          pharmacy_id?: string
          pharmacy_status?: string
          phone?: string | null
          portal_config_id?: string | null
          slug: string
          state?: string | null
          supports_real_time_status?: boolean
          supports_webhook?: boolean
          timezone?: string
          updated_at?: string
          website_url?: string | null
          zip?: string | null
        }
        Update: {
          adapter_status?: string | null
          address_line1?: string | null
          address_line2?: string | null
          api_config_id?: string | null
          average_turnaround_days?: number | null
          catalog_last_synced_at?: string | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          fax_number?: string | null
          integration_tier?: Database["public"]["Enums"]["integration_tier_enum"]
          is_active?: boolean
          name?: string
          pharmacy_id?: string
          pharmacy_status?: string
          phone?: string | null
          portal_config_id?: string | null
          slug?: string
          state?: string | null
          supports_real_time_status?: boolean
          supports_webhook?: boolean
          timezone?: string
          updated_at?: string
          website_url?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pharmacies_api_config_id_fkey"
            columns: ["api_config_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_api_configs"
            referencedColumns: ["config_id"]
          },
          {
            foreignKeyName: "pharmacies_portal_config_id_fkey"
            columns: ["portal_config_id"]
            isOneToOne: false
            referencedRelation: "pharmacy_portal_configs"
            referencedColumns: ["config_id"]
          },
        ]
      }
      pharmacy_api_configs: {
        Row: {
          api_version: string | null
          auth_type: string | null
          base_url: string
          circuit_breaker_threshold: number
          config_id: string
          created_at: string
          endpoints: Json
          is_active: boolean
          payload_transformer: string | null
          pharmacy_id: string
          rate_limit: Json | null
          rate_limit_concurrent: number | null
          rate_limit_rpm: number | null
          response_parser: string | null
          retry_config: Json | null
          timeout_ms: number
          updated_at: string
          vault_secret_id: string
          webhook_callback_url: string | null
          webhook_events: string[]
          webhook_secret_encrypted: string | null
          webhook_secret_vault_id: string | null
        }
        Insert: {
          api_version?: string | null
          auth_type?: string | null
          base_url: string
          circuit_breaker_threshold?: number
          config_id?: string
          created_at?: string
          endpoints: Json
          is_active?: boolean
          payload_transformer?: string | null
          pharmacy_id: string
          rate_limit?: Json | null
          rate_limit_concurrent?: number | null
          rate_limit_rpm?: number | null
          response_parser?: string | null
          retry_config?: Json | null
          timeout_ms?: number
          updated_at?: string
          vault_secret_id: string
          webhook_callback_url?: string | null
          webhook_events?: string[]
          webhook_secret_encrypted?: string | null
          webhook_secret_vault_id?: string | null
        }
        Update: {
          api_version?: string | null
          auth_type?: string | null
          base_url?: string
          circuit_breaker_threshold?: number
          config_id?: string
          created_at?: string
          endpoints?: Json
          is_active?: boolean
          payload_transformer?: string | null
          pharmacy_id?: string
          rate_limit?: Json | null
          rate_limit_concurrent?: number | null
          rate_limit_rpm?: number | null
          response_parser?: string | null
          retry_config?: Json | null
          timeout_ms?: number
          updated_at?: string
          vault_secret_id?: string
          webhook_callback_url?: string | null
          webhook_events?: string[]
          webhook_secret_encrypted?: string | null
          webhook_secret_vault_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_api_configs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
        ]
      }
      pharmacy_formulations: {
        Row: {
          available_quantities: Json | null
          available_supply_durations: Json | null
          created_at: string
          deleted_at: string | null
          estimated_turnaround_days: number | null
          formulation_id: string
          is_active: boolean
          is_available: boolean
          last_synced_at: string | null
          pharmacy_formulation_id: string
          pharmacy_id: string
          sku_code: string | null
          updated_at: string
          wholesale_price: number
        }
        Insert: {
          available_quantities?: Json | null
          available_supply_durations?: Json | null
          created_at?: string
          deleted_at?: string | null
          estimated_turnaround_days?: number | null
          formulation_id: string
          is_active?: boolean
          is_available?: boolean
          last_synced_at?: string | null
          pharmacy_formulation_id?: string
          pharmacy_id: string
          sku_code?: string | null
          updated_at?: string
          wholesale_price: number
        }
        Update: {
          available_quantities?: Json | null
          available_supply_durations?: Json | null
          created_at?: string
          deleted_at?: string | null
          estimated_turnaround_days?: number | null
          formulation_id?: string
          is_active?: boolean
          is_available?: boolean
          last_synced_at?: string | null
          pharmacy_formulation_id?: string
          pharmacy_id?: string
          sku_code?: string | null
          updated_at?: string
          wholesale_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_formulations_formulation_id_fkey"
            columns: ["formulation_id"]
            isOneToOne: false
            referencedRelation: "formulations"
            referencedColumns: ["formulation_id"]
          },
          {
            foreignKeyName: "pharmacy_formulations_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
        ]
      }
      pharmacy_portal_configs: {
        Row: {
          config_id: string
          confirmation_selector: Json | null
          created_at: string
          is_active: boolean
          login_flow: Json | null
          login_selector: Json | null
          order_form_selector: Json | null
          password_vault_id: string
          pharmacy_id: string
          poll_interval_minutes: number
          portal_type: string | null
          portal_url: string
          screenshot_on_error: boolean
          selectors: Json | null
          status_check_flow: Json | null
          submit_flow: Json | null
          updated_at: string
          username_vault_id: string
        }
        Insert: {
          config_id?: string
          confirmation_selector?: Json | null
          created_at?: string
          is_active?: boolean
          login_flow?: Json | null
          login_selector?: Json | null
          order_form_selector?: Json | null
          password_vault_id: string
          pharmacy_id: string
          poll_interval_minutes?: number
          portal_type?: string | null
          portal_url: string
          screenshot_on_error?: boolean
          selectors?: Json | null
          status_check_flow?: Json | null
          submit_flow?: Json | null
          updated_at?: string
          username_vault_id: string
        }
        Update: {
          config_id?: string
          confirmation_selector?: Json | null
          created_at?: string
          is_active?: boolean
          login_flow?: Json | null
          login_selector?: Json | null
          order_form_selector?: Json | null
          password_vault_id?: string
          pharmacy_id?: string
          poll_interval_minutes?: number
          portal_type?: string | null
          portal_url?: string
          screenshot_on_error?: boolean
          selectors?: Json | null
          status_check_flow?: Json | null
          submit_flow?: Json | null
          updated_at?: string
          username_vault_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_portal_configs_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: true
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
        ]
      }
      pharmacy_state_licenses: {
        Row: {
          deleted_at: string | null
          expiration_date: string
          is_active: boolean
          license_number: string
          pharmacy_id: string
          state_code: string
        }
        Insert: {
          deleted_at?: string | null
          expiration_date: string
          is_active?: boolean
          license_number: string
          pharmacy_id: string
          state_code: string
        }
        Update: {
          deleted_at?: string | null
          expiration_date?: string
          is_active?: boolean
          license_number?: string
          pharmacy_id?: string
          state_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_state_licenses_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
        ]
      }
      pharmacy_webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event_id: string
          event_type: string
          external_order_id: string | null
          id: string
          order_id: string | null
          payload: Json
          pharmacy_id: string
          processed_at: string | null
          retry_count: number
          signature_verified: boolean
          submission_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id: string
          event_type: string
          external_order_id?: string | null
          id?: string
          order_id?: string | null
          payload: Json
          pharmacy_id: string
          processed_at?: string | null
          retry_count?: number
          signature_verified?: boolean
          submission_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string
          event_type?: string
          external_order_id?: string | null
          id?: string
          order_id?: string | null
          payload?: Json
          pharmacy_id?: string
          processed_at?: string | null
          retry_count?: number
          signature_verified?: boolean
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_webhook_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "pharmacy_webhook_events_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
          {
            foreignKeyName: "pharmacy_webhook_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "adapter_submissions"
            referencedColumns: ["submission_id"]
          },
        ]
      }
      protocol_items: {
        Row: {
          condition_description: string | null
          created_at: string | null
          default_quantity: string | null
          default_refills: number | null
          dose_amount: string | null
          dose_unit: string | null
          formulation_id: string
          frequency_code: string | null
          is_conditional: boolean | null
          item_id: string
          pharmacy_id: string | null
          phase_end_week: number | null
          phase_name: string | null
          phase_start_week: number | null
          protocol_id: string
          sig_mode: string | null
          sig_text: string | null
          sort_order: number | null
          timing_code: string | null
        }
        Insert: {
          condition_description?: string | null
          created_at?: string | null
          default_quantity?: string | null
          default_refills?: number | null
          dose_amount?: string | null
          dose_unit?: string | null
          formulation_id: string
          frequency_code?: string | null
          is_conditional?: boolean | null
          item_id?: string
          pharmacy_id?: string | null
          phase_end_week?: number | null
          phase_name?: string | null
          phase_start_week?: number | null
          protocol_id: string
          sig_mode?: string | null
          sig_text?: string | null
          sort_order?: number | null
          timing_code?: string | null
        }
        Update: {
          condition_description?: string | null
          created_at?: string | null
          default_quantity?: string | null
          default_refills?: number | null
          dose_amount?: string | null
          dose_unit?: string | null
          formulation_id?: string
          frequency_code?: string | null
          is_conditional?: boolean | null
          item_id?: string
          pharmacy_id?: string | null
          phase_end_week?: number | null
          phase_name?: string | null
          phase_start_week?: number | null
          protocol_id?: string
          sig_mode?: string | null
          sig_text?: string | null
          sort_order?: number | null
          timing_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protocol_items_formulation_id_fkey"
            columns: ["formulation_id"]
            isOneToOne: false
            referencedRelation: "formulations"
            referencedColumns: ["formulation_id"]
          },
          {
            foreignKeyName: "protocol_items_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
          {
            foreignKeyName: "protocol_items_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "protocol_templates"
            referencedColumns: ["protocol_id"]
          },
        ]
      }
      protocol_templates: {
        Row: {
          clinic_id: string
          created_at: string | null
          created_by: string | null
          description: string | null
          is_active: boolean | null
          name: string
          protocol_id: string
          therapeutic_category: string | null
          total_duration_weeks: number | null
          updated_at: string | null
          use_count: number | null
        }
        Insert: {
          clinic_id: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          is_active?: boolean | null
          name: string
          protocol_id?: string
          therapeutic_category?: string | null
          total_duration_weeks?: number | null
          updated_at?: string | null
          use_count?: number | null
        }
        Update: {
          clinic_id?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          is_active?: boolean | null
          name?: string
          protocol_id?: string
          therapeutic_category?: string | null
          total_duration_weeks?: number | null
          updated_at?: string | null
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "protocol_templates_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["clinic_id"]
          },
          {
            foreignKeyName: "protocol_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["provider_id"]
          },
        ]
      }
      provider_favorites: {
        Row: {
          created_at: string | null
          default_quantity: string | null
          default_refills: number | null
          dose_amount: string | null
          dose_unit: string | null
          duration_code: string | null
          favorite_id: string
          formulation_id: string
          frequency_code: string | null
          label: string
          last_used_at: string | null
          pharmacy_id: string | null
          provider_id: string
          sig_mode: string | null
          sig_text: string | null
          timing_code: string | null
          updated_at: string | null
          use_count: number | null
        }
        Insert: {
          created_at?: string | null
          default_quantity?: string | null
          default_refills?: number | null
          dose_amount?: string | null
          dose_unit?: string | null
          duration_code?: string | null
          favorite_id?: string
          formulation_id: string
          frequency_code?: string | null
          label: string
          last_used_at?: string | null
          pharmacy_id?: string | null
          provider_id: string
          sig_mode?: string | null
          sig_text?: string | null
          timing_code?: string | null
          updated_at?: string | null
          use_count?: number | null
        }
        Update: {
          created_at?: string | null
          default_quantity?: string | null
          default_refills?: number | null
          dose_amount?: string | null
          dose_unit?: string | null
          duration_code?: string | null
          favorite_id?: string
          formulation_id?: string
          frequency_code?: string | null
          label?: string
          last_used_at?: string | null
          pharmacy_id?: string | null
          provider_id?: string
          sig_mode?: string | null
          sig_text?: string | null
          timing_code?: string | null
          updated_at?: string | null
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_favorites_formulation_id_fkey"
            columns: ["formulation_id"]
            isOneToOne: false
            referencedRelation: "formulations"
            referencedColumns: ["formulation_id"]
          },
          {
            foreignKeyName: "provider_favorites_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
          {
            foreignKeyName: "provider_favorites_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["provider_id"]
          },
        ]
      }
      providers: {
        Row: {
          clinic_id: string
          created_at: string
          dea_number: string | null
          deleted_at: string | null
          first_name: string
          is_active: boolean
          last_name: string
          license_number: string
          license_state: string
          npi_number: string
          provider_id: string
          signature_hash: string | null
          signature_on_file: boolean
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          dea_number?: string | null
          deleted_at?: string | null
          first_name: string
          is_active?: boolean
          last_name: string
          license_number: string
          license_state: string
          npi_number: string
          provider_id?: string
          signature_hash?: string | null
          signature_on_file?: boolean
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          dea_number?: string | null
          deleted_at?: string | null
          first_name?: string
          is_active?: boolean
          last_name?: string
          license_number?: string
          license_state?: string
          npi_number?: string
          provider_id?: string
          signature_hash?: string | null
          signature_on_file?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "providers_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["clinic_id"]
          },
        ]
      }
      routes_of_administration: {
        Row: {
          abbreviation: string
          name: string
          route_id: string
          sig_prefix: string
          sort_order: number
        }
        Insert: {
          abbreviation: string
          name: string
          route_id?: string
          sig_prefix: string
          sort_order?: number
        }
        Update: {
          abbreviation?: string
          name?: string
          route_id?: string
          sig_prefix?: string
          sort_order?: number
        }
        Relationships: []
      }
      salt_forms: {
        Row: {
          abbreviation: string | null
          cas_number: string | null
          conversion_factor: number | null
          created_at: string
          deleted_at: string | null
          ingredient_id: string
          is_active: boolean
          molecular_weight: number | null
          salt_form_id: string
          salt_name: string
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          cas_number?: string | null
          conversion_factor?: number | null
          created_at?: string
          deleted_at?: string | null
          ingredient_id: string
          is_active?: boolean
          molecular_weight?: number | null
          salt_form_id?: string
          salt_name: string
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          cas_number?: string | null
          conversion_factor?: number | null
          created_at?: string
          deleted_at?: string | null
          ingredient_id?: string
          is_active?: boolean
          molecular_weight?: number | null
          salt_form_id?: string
          salt_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salt_forms_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["ingredient_id"]
          },
        ]
      }
      sig_templates: {
        Row: {
          created_at: string
          cycling_duration: string | null
          cycling_off_days: number | null
          cycling_on_days: number | null
          cycling_rest: string | null
          dose_amount: string | null
          dose_unit: string | null
          dose_value: number | null
          duration: string | null
          formulation_id: string | null
          frequency_code: string | null
          frequency_display: string | null
          generated_sig_text: string | null
          is_cycling: boolean
          is_titration: boolean
          label: string | null
          route_text: string | null
          sig_template_id: string
          timing: string | null
          titration_increment: string | null
          titration_interval: string | null
          titration_start_dose: string | null
          titration_target: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          cycling_duration?: string | null
          cycling_off_days?: number | null
          cycling_on_days?: number | null
          cycling_rest?: string | null
          dose_amount?: string | null
          dose_unit?: string | null
          dose_value?: number | null
          duration?: string | null
          formulation_id?: string | null
          frequency_code?: string | null
          frequency_display?: string | null
          generated_sig_text?: string | null
          is_cycling?: boolean
          is_titration?: boolean
          label?: string | null
          route_text?: string | null
          sig_template_id?: string
          timing?: string | null
          titration_increment?: string | null
          titration_interval?: string | null
          titration_start_dose?: string | null
          titration_target?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          cycling_duration?: string | null
          cycling_off_days?: number | null
          cycling_on_days?: number | null
          cycling_rest?: string | null
          dose_amount?: string | null
          dose_unit?: string | null
          dose_value?: number | null
          duration?: string | null
          formulation_id?: string | null
          frequency_code?: string | null
          frequency_display?: string | null
          generated_sig_text?: string | null
          is_cycling?: boolean
          is_titration?: boolean
          label?: string | null
          route_text?: string | null
          sig_template_id?: string
          timing?: string | null
          titration_increment?: string | null
          titration_interval?: string | null
          titration_start_dose?: string | null
          titration_target?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sig_templates_formulation_id_fkey"
            columns: ["formulation_id"]
            isOneToOne: false
            referencedRelation: "formulations"
            referencedColumns: ["formulation_id"]
          },
        ]
      }
      sla_notifications_log: {
        Row: {
          channel: string
          escalation_tier: number
          id: string
          order_id: string
          sent_at: string
          sla_type: string
        }
        Insert: {
          channel: string
          escalation_tier: number
          id?: string
          order_id: string
          sent_at?: string
          sla_type: string
        }
        Update: {
          channel?: string
          escalation_tier?: number
          id?: string
          order_id?: string
          sent_at?: string
          sla_type?: string
        }
        Relationships: []
      }
      sms_log: {
        Row: {
          created_at: string
          delivered_at: string | null
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          order_id: string | null
          patient_id: string | null
          sent_at: string | null
          sms_id: string
          status: string
          template_name: string
          to_number: string
          twilio_message_sid: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          order_id?: string | null
          patient_id?: string | null
          sent_at?: string | null
          sms_id?: string
          status?: string
          template_name: string
          to_number: string
          twilio_message_sid: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          order_id?: string | null
          patient_id?: string | null
          sent_at?: string | null
          sms_id?: string
          status?: string
          template_name?: string
          to_number?: string
          twilio_message_sid?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "sms_log_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["patient_id"]
          },
        ]
      }
      sms_templates: {
        Row: {
          body_template: string
          created_at: string
          is_active: boolean
          template_id: string
          template_name: string
          trigger_event: string
          updated_at: string
        }
        Insert: {
          body_template: string
          created_at?: string
          is_active?: boolean
          template_id?: string
          template_name: string
          trigger_event: string
          updated_at?: string
        }
        Update: {
          body_template?: string
          created_at?: string
          is_active?: boolean
          template_id?: string
          template_name?: string
          trigger_event?: string
          updated_at?: string
        }
        Relationships: []
      }
      transfer_failures: {
        Row: {
          amount: number
          clinic_id: string
          created_at: string
          currency: string
          failure_code: string
          failure_id: string
          failure_message: string | null
          order_id: string
          transfer_id: string
        }
        Insert: {
          amount: number
          clinic_id: string
          created_at?: string
          currency?: string
          failure_code: string
          failure_id?: string
          failure_message?: string | null
          order_id: string
          transfer_id: string
        }
        Update: {
          amount?: number
          clinic_id?: string
          created_at?: string
          currency?: string
          failure_code?: string
          failure_id?: string
          failure_message?: string | null
          order_id?: string
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_failures_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["clinic_id"]
          },
          {
            foreignKeyName: "transfer_failures_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event_id: string
          event_type: string
          external_event_id: string | null
          order_id: string | null
          payload: Json
          processed_at: string | null
          retry_count: number
          source: Database["public"]["Enums"]["webhook_source_enum"]
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id?: string
          event_type: string
          external_event_id?: string | null
          order_id?: string | null
          payload: Json
          processed_at?: string | null
          retry_count?: number
          source: Database["public"]["Enums"]["webhook_source_enum"]
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string
          event_type?: string
          external_event_id?: string | null
          order_id?: string | null
          payload?: Json
          processed_at?: string | null
          retry_count?: number
          source?: Database["public"]["Enums"]["webhook_source_enum"]
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
        ]
      }
    }
    Views: {
      pharmacy_webhook_dead_letter_queue: {
        Row: {
          created_at: string | null
          error: string | null
          event_type: string | null
          external_order_id: string | null
          id: string | null
          order_id: string | null
          pharmacy_id: string | null
          processed_at: string | null
          retry_count: number | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          event_type?: string | null
          external_order_id?: string | null
          id?: string | null
          order_id?: string | null
          pharmacy_id?: string | null
          processed_at?: string | null
          retry_count?: number | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          event_type?: string | null
          external_order_id?: string | null
          id?: string | null
          order_id?: string | null
          pharmacy_id?: string | null
          processed_at?: string | null
          retry_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pharmacy_webhook_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
          {
            foreignKeyName: "pharmacy_webhook_events_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "pharmacies"
            referencedColumns: ["pharmacy_id"]
          },
        ]
      }
      provider_prescribing_history: {
        Row: {
          catalog_item_id: string | null
          last_prescribed_at: string | null
          medication_name: string | null
          prescription_count: number | null
          provider_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "orders_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["provider_id"]
          },
        ]
      }
      webhook_dead_letter_queue: {
        Row: {
          created_at: string | null
          error: string | null
          event_id: string | null
          event_type: string | null
          order_id: string | null
          processed_at: string | null
          retry_count: number | null
          source: Database["public"]["Enums"]["webhook_source_enum"] | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          event_id?: string | null
          event_type?: string | null
          order_id?: string | null
          processed_at?: string | null
          retry_count?: number | null
          source?: Database["public"]["Enums"]["webhook_source_enum"] | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          event_id?: string | null
          event_type?: string | null
          order_id?: string | null
          processed_at?: string | null
          retry_count?: number | null
          source?: Database["public"]["Enums"]["webhook_source_enum"] | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["order_id"]
          },
        ]
      }
    }
    Functions: {
      create_vault_secret: {
        Args: { p_name: string; p_secret: string }
        Returns: string
      }
      delete_vault_secret: { Args: { p_secret_id: string }; Returns: undefined }
      rotate_vault_secret: {
        Args: { p_new_secret: string; p_secret_id: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      adapter_submission_status_enum:
        | "PENDING"
        | "SUBMITTED"
        | "CONFIRMED"
        | "FAILED"
        | "TIMEOUT"
        | "PORTAL_ERROR"
        | "MANUAL_REVIEW"
        | "ACKNOWLEDGED"
        | "REJECTED"
        | "SUBMISSION_FAILED"
        | "CANCELLED"
      app_role_enum:
        | "clinic_admin"
        | "provider"
        | "medical_assistant"
        | "ops_admin"
      catalog_source_enum:
        | "PHARMACY_API"
        | "PORTAL_SCRAPE"
        | "MANUAL_ENTRY"
        | "BULK_IMPORT"
      fax_queue_status_enum:
        | "RECEIVED"
        | "MATCHED"
        | "UNMATCHED"
        | "PROCESSING"
        | "ERROR"
        | "PROCESSED"
        | "ARCHIVED"
      integration_tier_enum:
        | "TIER_1_API"
        | "TIER_2_PORTAL"
        | "TIER_3_HYBRID"
        | "TIER_4_FAX"
        | "TIER_3_SPEC"
      order_status_enum:
        | "DRAFT"
        | "AWAITING_PAYMENT"
        | "PAYMENT_EXPIRED"
        | "PAID_PROCESSING"
        | "SUBMISSION_PENDING"
        | "SUBMISSION_FAILED"
        | "FAX_QUEUED"
        | "FAX_DELIVERED"
        | "FAX_FAILED"
        | "PHARMACY_ACKNOWLEDGED"
        | "PHARMACY_COMPOUNDING"
        | "PHARMACY_PROCESSING"
        | "PHARMACY_REJECTED"
        | "REROUTE_PENDING"
        | "READY_TO_SHIP"
        | "SHIPPED"
        | "DELIVERED"
        | "CANCELLED"
        | "ERROR_PAYMENT_FAILED"
        | "ERROR_COMPLIANCE_HOLD"
        | "REFUND_PENDING"
        | "REFUNDED"
        | "DISPUTED"
      regulatory_status_enum:
        | "ACTIVE"
        | "RECALLED"
        | "DISCONTINUED"
        | "SHORTAGE"
      sla_type_enum:
        | "FAX_DELIVERY"
        | "PHARMACY_ACKNOWLEDGE"
        | "SHIPPING"
        | "PAYMENT"
        | "SUBMISSION"
        | "PHARMACY_CONFIRMATION"
        | "STATUS_UPDATE"
        | "REROUTE_RESOLUTION"
        | "ADAPTER_SUBMISSION_ACK"
        | "PHARMACY_COMPOUNDING_ACK"
      stripe_connect_status_enum:
        | "PENDING"
        | "ONBOARDING"
        | "RESTRICTED"
        | "ACTIVE"
        | "DEACTIVATED"
      webhook_source_enum: "STRIPE" | "DOCUMO" | "PHARMACY" | "TWILIO"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      adapter_submission_status_enum: [
        "PENDING",
        "SUBMITTED",
        "CONFIRMED",
        "FAILED",
        "TIMEOUT",
        "PORTAL_ERROR",
        "MANUAL_REVIEW",
        "ACKNOWLEDGED",
        "REJECTED",
        "SUBMISSION_FAILED",
        "CANCELLED",
      ],
      app_role_enum: [
        "clinic_admin",
        "provider",
        "medical_assistant",
        "ops_admin",
      ],
      catalog_source_enum: [
        "PHARMACY_API",
        "PORTAL_SCRAPE",
        "MANUAL_ENTRY",
        "BULK_IMPORT",
      ],
      fax_queue_status_enum: [
        "RECEIVED",
        "MATCHED",
        "UNMATCHED",
        "PROCESSING",
        "ERROR",
        "PROCESSED",
        "ARCHIVED",
      ],
      integration_tier_enum: [
        "TIER_1_API",
        "TIER_2_PORTAL",
        "TIER_3_HYBRID",
        "TIER_4_FAX",
        "TIER_3_SPEC",
      ],
      order_status_enum: [
        "DRAFT",
        "AWAITING_PAYMENT",
        "PAYMENT_EXPIRED",
        "PAID_PROCESSING",
        "SUBMISSION_PENDING",
        "SUBMISSION_FAILED",
        "FAX_QUEUED",
        "FAX_DELIVERED",
        "FAX_FAILED",
        "PHARMACY_ACKNOWLEDGED",
        "PHARMACY_COMPOUNDING",
        "PHARMACY_PROCESSING",
        "PHARMACY_REJECTED",
        "REROUTE_PENDING",
        "READY_TO_SHIP",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "ERROR_PAYMENT_FAILED",
        "ERROR_COMPLIANCE_HOLD",
        "REFUND_PENDING",
        "REFUNDED",
        "DISPUTED",
      ],
      regulatory_status_enum: [
        "ACTIVE",
        "RECALLED",
        "DISCONTINUED",
        "SHORTAGE",
      ],
      sla_type_enum: [
        "FAX_DELIVERY",
        "PHARMACY_ACKNOWLEDGE",
        "SHIPPING",
        "PAYMENT",
        "SUBMISSION",
        "PHARMACY_CONFIRMATION",
        "STATUS_UPDATE",
        "REROUTE_RESOLUTION",
        "ADAPTER_SUBMISSION_ACK",
        "PHARMACY_COMPOUNDING_ACK",
      ],
      stripe_connect_status_enum: [
        "PENDING",
        "ONBOARDING",
        "RESTRICTED",
        "ACTIVE",
        "DEACTIVATED",
      ],
      webhook_source_enum: ["STRIPE", "DOCUMO", "PHARMACY", "TWILIO"],
    },
  },
} as const

// ── Custom type aliases (re-added after supabase gen types) ──
export type OrderStatusEnum = Database['public']['Enums']['order_status_enum']
export type StripeConnectStatusEnum = Database['public']['Enums']['stripe_connect_status_enum']
export type IntegrationTierEnum = Database['public']['Enums']['integration_tier_enum']
