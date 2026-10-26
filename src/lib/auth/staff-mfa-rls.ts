// ============================================================
// MFA in RLS (HIPAA B3): which tables, and the database switch
// ============================================================
//
// The middleware MFA gate (lib/auth/mfa, src/middleware.ts) runs only for
// requests through the app. A staff session at aal1 could still read PHI
// straight from PostgREST with the public anon key. Migration
// 20261024000012_rls_require_aal2 puts a RESTRICTIVE policy,
// staff_mfa_aal2, on every table below: for `authenticated`, any command
// passes only if public.staff_mfa_satisfied() is true:
//
//   - the JWT's aal is aal2: true;
//   - pharmacy_admin (ALWAYS_MFA_ROLES): false at aal1, always;
//   - any other JWT, with or without a staff role: false at aal1 only when
//     the database switch security_settings.require_staff_mfa is on (a
//     missing row counts as on: fail closed). Patients never hold a
//     Supabase session, so a JWT with no recognised role gets no
//     exemption: a clinic_id alone does not read PHI at aal1.
//
// The policy wraps the call as (SELECT public.staff_mfa_satisfied()), so it
// runs once per statement (an InitPlan), not once per row.
//
// Postgres cannot see REQUIRE_MFA, so the switch is a one-row table that
// no API role can read or write. Flip it together with REQUIRE_MFA (the app
// redirects to enrollment / the challenge; the database refuses the rows).
// MFA_ENFORCED_EMAILS (per account) is app-only.
//
// The service role bypasses RLS: patients' token pages, crons and webhooks
// are unaffected.
//
// A later migration that adds a PHI table adds it to this list and to
// apply_staff_mfa_scope()'s, and runs SELECT public.apply_staff_mfa_scope();
// src/lib/auth/__tests__/rls-staff-mfa-migration.test.ts holds the two
// lists equal.

/**
 * The tables that hold or link patient health information, from the RLS
 * inventory (C's evidence map, 2026-10-25). Not listed, on purpose: the
 * catalog and reference data, pharmacies and their configs, clinics,
 * providers and licenses (staff data), onboarding, and the money and
 * operations tables that carry only an order id (ledger, payables,
 * disputes, transfer failures, legal holds). order_sla_deadlines is listed:
 * its resolution_notes is free text that can name a patient or a drug.
 */
export const STAFF_MFA_PHI_TABLES: readonly string[] = [
  'patients',
  'orders',
  'order_status_history',
  'order_clarifications',
  'clinic_notifications',
  'adapter_submissions',
  'adapter_submission_debug_payloads',
  'sms_log',
  'webhook_events',
  'pharmacy_webhook_events',
  'inbound_fax_queue',
  'payment_groups',
  'phi_access_log',
  'epcs_audit_log',
  'provider_favorites',
  'protocol_instances',
  'patient_protocol_phases',
  'phase_advancement_history',
  'patient_external_ids',
  'patient_field_changes',
  'patient_import_batches',
  'patient_intake_links',
  'ehr_sync_events',
  'treatment_proposals',
  'treatment_proposal_options',
  'treatment_proposal_events',
  'proposal_choice_items',
  'saved_clinical_statements',
  'order_sla_deadlines',
]

/** How Sam flips the switch: one statement, run as the database owner (SQL editor). */
export const STAFF_MFA_SWITCH_SQL = {
  on:  'UPDATE public.security_settings SET require_staff_mfa = true, updated_at = now() WHERE id = 1;',
  off: 'UPDATE public.security_settings SET require_staff_mfa = false, updated_at = now() WHERE id = 1;',
} as const
