-- Seeded copies of the prod test data plus Sunrise / demo rows that must survive.
-- Ids: demo a1.../a4... (as the repo seeds); test data uses other prefixes.

-- Reference data.
INSERT INTO dosage_forms (dosage_form_id, name) VALUES ('d0000000-0000-4000-8000-000000000001', 'Cleanup Test Form');
INSERT INTO routes_of_administration (route_id, name, abbreviation, sig_prefix) VALUES ('d0000000-0000-4000-8000-000000000002', 'Cleanup Test Route', 'CTR', 'Apply');
INSERT INTO formulations (formulation_id, name, dosage_form_id, route_id) VALUES ('d0000000-0000-4000-8000-000000000003', 'Cleanup Test Formulation', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');

-- ── Demo (must survive) ─────────────────────────────────────────
INSERT INTO clinics (clinic_id, name, stripe_connect_status) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Sunrise Functional Medicine', 'ACTIVE'),
  ('a1000000-0000-0000-0000-000000000010', 'Demo Onboarding Clinic', 'PENDING');
INSERT INTO pharmacies (pharmacy_id, name, slug, integration_tier) VALUES
  ('a4000000-0000-0000-0000-000000000001', 'Strive Pharmacy', 'strive', 'TIER_4_FAX'),
  ('a4000000-0000-0000-0000-000000000002', 'Quick Rx Pharmacy', 'quick-rx', 'TIER_4_FAX');
INSERT INTO circuit_breaker_state (pharmacy_id) VALUES ('a4000000-0000-0000-0000-000000000001');

INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', 'admin@sunrise-clinic.com', '{"app_role":"clinic_admin","clinic_id":"a1000000-0000-0000-0000-000000000001"}'),
  ('a0000000-0000-4000-8000-0000000000a2', 'dr.chen@sunrise-clinic.com', '{"app_role":"provider","clinic_id":"a1000000-0000-0000-0000-000000000001"}'),
  ('a0000000-0000-4000-8000-0000000000a3', 'ma@sunrise-clinic.com', '{"app_role":"medical_assistant","clinic_id":"a1000000-0000-0000-0000-000000000001"}'),
  ('a0000000-0000-4000-8000-0000000000a4', 'ops@compoundiq-poc.com', '{"app_role":"ops_admin"}');
INSERT INTO auth.identities (provider_id, user_id, provider, email) VALUES ('a0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'email', 'admin@sunrise-clinic.com');
INSERT INTO auth.sessions (id, user_id) VALUES ('a0000000-0000-4000-8000-0000000005a1', 'a0000000-0000-4000-8000-0000000000a1');

INSERT INTO providers (provider_id, clinic_id, first_name, last_name, npi_number, license_state, license_number, user_id) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Sarah', 'Chen', '1234567890', 'TX', 'TX-1', 'a0000000-0000-4000-8000-0000000000a2');
INSERT INTO provider_state_licenses (provider_id, state, license_number, expires_on, source) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'TX', 'DEMO-TX-0001', '2027-12-31', 'demo_seed');

INSERT INTO patients (patient_id, clinic_id, first_name, last_name, date_of_birth, phone, phone_e164) VALUES
  ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Alex', 'Demo', '1985-06-15', '+15125550100', '+15125550100'),
  ('a3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Test', 'Patient', '1980-01-01', '+15125550101', '+15125550101');

INSERT INTO orders (order_id, patient_id, provider_id, clinic_id, pharmacy_id, formulation_id, status, quantity, locked_at) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'SHIPPED', 1, now());
INSERT INTO order_status_history (order_id, old_status, new_status) VALUES ('d1000000-0000-4000-8000-000000000001', 'PAID_PROCESSING', 'SHIPPED');
INSERT INTO adapter_submissions (submission_id, order_id, pharmacy_id, tier) VALUES ('d1000000-0000-4000-8000-0000000000b1', 'd1000000-0000-4000-8000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'TIER_4_FAX');
INSERT INTO ledger_entries (order_id, clinic_id, pharmacy_id, party, entry_type, amount_cents, status, source_event_id, line_key) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'clinic', 'charge', 19000, 'succeeded', 'demo-evt-1', 'charge');
INSERT INTO pharmacy_payables (payable_id, order_id, pharmacy_id, clinic_id, wholesale_cents, shipping_cents, amount_cents) VALUES
  ('d1000000-0000-4000-8000-0000000000c1', 'd1000000-0000-4000-8000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 9500, 0, 9500);
INSERT INTO payable_events (payable_id, action, actor_user_id) VALUES ('d1000000-0000-4000-8000-0000000000c1', 'marked_scheduled', 'a0000000-0000-4000-8000-0000000000a4');
INSERT INTO agreement_acceptances (clinic_id, agreement, template_version, text_sha256, signer_name, signer_title, user_id) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'baa', 'v1.0', repeat('a', 64), 'Sunrise Admin', 'Owner', 'a0000000-0000-4000-8000-0000000000a1');
INSERT INTO clinic_onboarding_events (clinic_id, event, actor_user_id, actor_role) VALUES
  ('a1000000-0000-0000-0000-000000000010', 'invite_created', 'a0000000-0000-4000-8000-0000000000a4', 'ops_admin');
INSERT INTO storage.objects (bucket_id, name) VALUES ('pharmacy-license-documents', 'a4000000-0000-0000-0000-000000000001/TX/doc.pdf');
INSERT INTO storage.objects (bucket_id, name) VALUES ('prescription-pdfs', 'fax/d1000000-0000-4000-8000-000000000001/attempt-1.pdf');

-- ── QA Test Clinic ──────────────────────────────────────────────
INSERT INTO clinics (clinic_id, name, stripe_connect_status, onboarding_status) VALUES
  ('c0000000-0000-4000-8000-0000000000c1', 'QA Test Clinic', 'PENDING', 'approved');
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('c0000000-0000-4000-8000-0000000001a1', 'qa-admin@qaclinic.example.org', '{"app_role":"clinic_admin","clinic_id":"c0000000-0000-4000-8000-0000000000c1"}'),
  ('c0000000-0000-4000-8000-0000000001a2', 'qa-provider@qaclinic.example.org', '{"app_role":"provider","clinic_id":"c0000000-0000-4000-8000-0000000000c1"}');
INSERT INTO auth.identities (provider_id, user_id, provider, email) VALUES
  ('c0000000-0000-4000-8000-0000000001a1', 'c0000000-0000-4000-8000-0000000001a1', 'email', 'qa-admin@qaclinic.example.org'),
  ('c0000000-0000-4000-8000-0000000001a2', 'c0000000-0000-4000-8000-0000000001a2', 'email', 'qa-provider@qaclinic.example.org');
INSERT INTO auth.sessions (id, user_id) VALUES ('c0000000-0000-4000-8000-0000000005a1', 'c0000000-0000-4000-8000-0000000001a1');
INSERT INTO auth.refresh_tokens (token, user_id, session_id) VALUES ('t1', 'c0000000-0000-4000-8000-0000000001a1', 'c0000000-0000-4000-8000-0000000005a1');
INSERT INTO auth.mfa_factors (id, user_id) VALUES ('c0000000-0000-4000-8000-0000000006a1', 'c0000000-0000-4000-8000-0000000001a1');
INSERT INTO providers (provider_id, clinic_id, first_name, last_name, npi_number, license_state, license_number, user_id) VALUES
  ('c0000000-0000-4000-8000-0000000002a1', 'c0000000-0000-4000-8000-0000000000c1', 'Quinn', 'Tester', '1999999999', 'TX', 'TX-QA', 'c0000000-0000-4000-8000-0000000001a2');
INSERT INTO provider_state_licenses (provider_id, state, license_number, expires_on, source) VALUES ('c0000000-0000-4000-8000-0000000002a1', 'TX', 'QA-TX-1', '2027-12-31', 'manual');
INSERT INTO provider_npi_verifications (provider_id, npi, status, source) VALUES ('c0000000-0000-4000-8000-0000000002a1', '1999999999', 'not_found', 'nppes');
INSERT INTO onboarding_invites (kind, clinic_id, email, token_hash, expires_at, created_by, accepted_at, accepted_user_id) VALUES
  ('clinic_admin', 'c0000000-0000-4000-8000-0000000000c1', 'qa-admin@qaclinic.example.org', repeat('1', 64), now() + interval '7 days', 'a0000000-0000-4000-8000-0000000000a4', now(), 'c0000000-0000-4000-8000-0000000001a1');
INSERT INTO clinic_onboarding_steps (clinic_id, step, status) VALUES ('c0000000-0000-4000-8000-0000000000c1', 'practice', 'complete'), ('c0000000-0000-4000-8000-0000000000c1', 'baa', 'complete');
INSERT INTO clinic_onboarding_events (clinic_id, event, actor_user_id, actor_role) VALUES
  ('c0000000-0000-4000-8000-0000000000c1', 'invite_created', 'a0000000-0000-4000-8000-0000000000a4', 'ops_admin'),
  ('c0000000-0000-4000-8000-0000000000c1', 'approved', 'a0000000-0000-4000-8000-0000000000a4', 'ops_admin');
INSERT INTO agreement_acceptances (clinic_id, agreement, template_version, text_sha256, signer_name, signer_title, user_id) VALUES
  ('c0000000-0000-4000-8000-0000000000c1', 'baa', 'v1.0', repeat('b', 64), 'QA Admin', 'Owner', 'c0000000-0000-4000-8000-0000000001a1'),
  ('c0000000-0000-4000-8000-0000000000c1', 'terms', 'v1.0', repeat('c', 64), 'QA Admin', 'Owner', 'c0000000-0000-4000-8000-0000000001a1');
INSERT INTO clinic_signup_links (clinic_id, token_hash) VALUES ('c0000000-0000-4000-8000-0000000000c1', repeat('2', 64));
INSERT INTO protocol_templates (protocol_id, clinic_id, name) VALUES ('c0000000-0000-4000-8000-0000000007a1', 'c0000000-0000-4000-8000-0000000000c1', 'QA protocol');
INSERT INTO protocol_template_versions (protocol_id, version_number) VALUES ('c0000000-0000-4000-8000-0000000007a1', 1);
INSERT INTO patients (patient_id, clinic_id, first_name, last_name, date_of_birth, phone, phone_e164) VALUES
  ('c0000000-0000-4000-8000-0000000003a1', 'c0000000-0000-4000-8000-0000000000c1', 'Pat', 'QA', '1990-01-01', '+15125550200', '+15125550200'),
  ('c0000000-0000-4000-8000-0000000003a2', 'c0000000-0000-4000-8000-0000000000c1', 'Sam', 'QA', '1991-01-01', '+15125550201', '+15125550201');
INSERT INTO patient_intake_links (clinic_id, patient_id, token_hash, expires_at) VALUES ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000003a1', repeat('3', 64), now() + interval '1 day');
INSERT INTO payment_groups (group_id, clinic_id, patient_id, provider_id, total_cents, status) VALUES
  ('c0000000-0000-4000-8000-0000000009a1', 'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000003a1', 'c0000000-0000-4000-8000-0000000002a1', 38000, 'PAID');
INSERT INTO orders (order_id, patient_id, provider_id, clinic_id, pharmacy_id, formulation_id, status, quantity, locked_at, payment_group_id) VALUES
  ('c0000000-0000-4000-8000-0000000004a1', 'c0000000-0000-4000-8000-0000000003a1', 'c0000000-0000-4000-8000-0000000002a1', 'c0000000-0000-4000-8000-0000000000c1', 'a4000000-0000-0000-0000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'SHIPPED', 1, now(), 'c0000000-0000-4000-8000-0000000009a1'),
  ('c0000000-0000-4000-8000-0000000004a2', 'c0000000-0000-4000-8000-0000000003a2', 'c0000000-0000-4000-8000-0000000002a1', 'c0000000-0000-4000-8000-0000000000c1', 'a4000000-0000-0000-0000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'DRAFT', 1, NULL, NULL);
INSERT INTO adapter_submissions (submission_id, order_id, pharmacy_id, tier) VALUES ('c0000000-0000-4000-8000-0000000008a1', 'c0000000-0000-4000-8000-0000000004a1', 'a4000000-0000-0000-0000-000000000001', 'TIER_4_FAX');
UPDATE orders SET adapter_submission_id = 'c0000000-0000-4000-8000-0000000008a1' WHERE order_id = 'c0000000-0000-4000-8000-0000000004a1';
UPDATE circuit_breaker_state SET tripped_by_submission_id = 'c0000000-0000-4000-8000-0000000008a1' WHERE pharmacy_id = 'a4000000-0000-0000-0000-000000000001';
INSERT INTO adapter_submission_debug_payloads (adapter_submission_id, raw_payload) VALUES ('c0000000-0000-4000-8000-0000000008a1', '{}');
INSERT INTO pharmacy_webhook_events (pharmacy_id, event_id, event_type, payload, order_id, submission_id) VALUES ('a4000000-0000-0000-0000-000000000001', 'qa-wh-1', 'status', '{}', 'c0000000-0000-4000-8000-0000000004a1', 'c0000000-0000-4000-8000-0000000008a1');
INSERT INTO order_status_history (order_id, old_status, new_status) VALUES ('c0000000-0000-4000-8000-0000000004a1', 'PAID_PROCESSING', 'SHIPPED');
INSERT INTO order_sla_deadlines (order_id, sla_type, deadline_at) VALUES ('c0000000-0000-4000-8000-0000000004a1', 'SHIPPING', now());
INSERT INTO sla_notifications_log (order_id, sla_type, escalation_tier, channel) VALUES ('c0000000-0000-4000-8000-0000000004a1', 'SHIPPING', 1, 'slack');
INSERT INTO order_clarifications (order_id, reason_code) VALUES ('c0000000-0000-4000-8000-0000000004a1', 'DOSE_UNCLEAR');
INSERT INTO clinic_notifications (clinic_id, order_id, notification_type, message) VALUES ('c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000004a1', 'general', 'x');
INSERT INTO sms_log (order_id, patient_id, template_name, to_number, status) VALUES ('c0000000-0000-4000-8000-0000000004a1', 'c0000000-0000-4000-8000-0000000003a1', 'payment_link', '+15125550200', 'sent');
INSERT INTO webhook_events (source, event_type, payload, order_id) VALUES ('STRIPE', 'payment_intent.succeeded', '{}', 'c0000000-0000-4000-8000-0000000004a1');
INSERT INTO disputes (dispute_id, order_id, payment_intent_id, amount, currency, status) VALUES ('dp_qa1', 'c0000000-0000-4000-8000-0000000004a1', 'pi_qa1', 100, 'usd', 'won');
INSERT INTO dispute_orders (dispute_id, order_id) VALUES ('dp_qa1', 'c0000000-0000-4000-8000-0000000004a1');
INSERT INTO transfer_failures (transfer_id, order_id, clinic_id, amount, failure_code) VALUES ('tr_qa1', 'c0000000-0000-4000-8000-0000000004a1', 'c0000000-0000-4000-8000-0000000000c1', 100, 'x');
INSERT INTO ledger_entries (order_id, payment_group_id, clinic_id, pharmacy_id, party, entry_type, amount_cents, status, source_event_id, line_key) VALUES
  ('c0000000-0000-4000-8000-0000000004a1', 'c0000000-0000-4000-8000-0000000009a1', 'c0000000-0000-4000-8000-0000000000c1', 'a4000000-0000-0000-0000-000000000001', 'clinic', 'charge', 19000, 'succeeded', 'qa-evt-1', 'charge');
INSERT INTO pharmacy_payables (payable_id, order_id, payment_group_id, pharmacy_id, clinic_id, wholesale_cents, shipping_cents, amount_cents) VALUES
  ('c0000000-0000-4000-8000-000000000ca1', 'c0000000-0000-4000-8000-0000000004a1', 'c0000000-0000-4000-8000-0000000009a1', 'a4000000-0000-0000-0000-000000000001', 'c0000000-0000-4000-8000-0000000000c1', 9500, 0, 9500);
INSERT INTO payable_events (payable_id, action, actor_user_id) VALUES ('c0000000-0000-4000-8000-000000000ca1', 'marked_scheduled', 'a0000000-0000-4000-8000-0000000000a4');
INSERT INTO storage.objects (bucket_id, name) VALUES ('prescription-pdfs', 'fax/c0000000-0000-4000-8000-0000000004a1/attempt-1.pdf');
INSERT INTO phi_access_log (actor_user_id, actor_role, action, resource, route, patient_id, clinic_id, order_id) VALUES
  ('c0000000-0000-4000-8000-0000000001a1', 'clinic_admin', 'view', 'patient', '/patients/[id]', 'c0000000-0000-4000-8000-0000000003a1', 'c0000000-0000-4000-8000-0000000000c1', NULL),
  ('a0000000-0000-4000-8000-0000000000a4', 'ops_admin', 'view', 'order', '/ops/pipeline', NULL, 'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000004a1');

-- ── QA Test Pharmacy ────────────────────────────────────────────
INSERT INTO pharmacies (pharmacy_id, name, slug, integration_tier, onboarding_status) VALUES
  ('e0000000-0000-4000-8000-0000000000e1', 'QA Test Pharmacy', 'qa-test-pharmacy', 'TIER_1_API', 'approved');
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('e0000000-0000-4000-8000-0000000001e1', 'qa-pharmacy@qapharmacy.example.org', '{"app_role":"pharmacy_admin","pharmacy_id":"e0000000-0000-4000-8000-0000000000e1"}');
INSERT INTO auth.mfa_factors (id, user_id) VALUES ('e0000000-0000-4000-8000-0000000006e1', 'e0000000-0000-4000-8000-0000000001e1');
INSERT INTO pharmacy_invites (invite_id, pharmacy_name, admin_email, token_hash, expires_at, created_by, accepted_at, accepted_user_id, pharmacy_id) VALUES
  ('e0000000-0000-4000-8000-0000000002e1', 'QA Test Pharmacy', 'qa-pharmacy@qapharmacy.example.org', repeat('4', 64), now() + interval '7 days', 'a0000000-0000-4000-8000-0000000000a4', now(), 'e0000000-0000-4000-8000-0000000001e1', 'e0000000-0000-4000-8000-0000000000e1');
INSERT INTO pharmacy_onboarding_applications (application_id, pharmacy_id, invite_id, admin_user_id, status) VALUES
  ('e0000000-0000-4000-8000-0000000003e1', 'e0000000-0000-4000-8000-0000000000e1', 'e0000000-0000-4000-8000-0000000002e1', 'e0000000-0000-4000-8000-0000000001e1', 'approved');
INSERT INTO pharmacy_state_licenses (pharmacy_id, state_code, license_number, expiration_date, document_path) VALUES
  ('e0000000-0000-4000-8000-0000000000e1', 'TX', 'QA-PH-1', '2027-12-31', 'e0000000-0000-4000-8000-0000000000e1/TX/doc.pdf');
INSERT INTO storage.objects (bucket_id, name) VALUES ('pharmacy-license-documents', 'e0000000-0000-4000-8000-0000000000e1/TX/doc.pdf');
INSERT INTO pharmacy_agreement_acceptances (pharmacy_id, application_id, user_id, signer_name, signer_title, template_key, template_version, text_sha256) VALUES
  ('e0000000-0000-4000-8000-0000000000e1', 'e0000000-0000-4000-8000-0000000003e1', 'e0000000-0000-4000-8000-0000000001e1', 'QA Pharm', 'Owner', 'pharmacy_terms', 'v1.0', repeat('d', 64));
INSERT INTO pharmacy_onboarding_events (actor_user_id, actor_role, action, invite_id, pharmacy_id, application_id, detail) VALUES
  ('a0000000-0000-4000-8000-0000000000a4', 'ops_admin', 'invite_created', 'e0000000-0000-4000-8000-0000000002e1', NULL, NULL, '{}'),
  ('a0000000-0000-4000-8000-0000000000a4', 'ops_admin', 'approved', NULL, 'e0000000-0000-4000-8000-0000000000e1', 'e0000000-0000-4000-8000-0000000003e1', '{}');
INSERT INTO vault.secrets (id, name, secret) VALUES
  ('e0000000-0000-4000-8000-0000000009e1', 'qa-pharmacy-api', 'x'),
  ('e0000000-0000-4000-8000-0000000009e2', 'qa-pharmacy-portal-user', 'x'),
  ('e0000000-0000-4000-8000-0000000009e3', 'qa-pharmacy-portal-pass', 'x'),
  ('a0000000-0000-4000-8000-0000000009a1', 'demo-kept-secret', 'x');
INSERT INTO pharmacy_api_configs (config_id, pharmacy_id, base_url, vault_secret_id, endpoints) VALUES
  ('e0000000-0000-4000-8000-0000000004e1', 'e0000000-0000-4000-8000-0000000000e1', 'https://qa.example.org', 'e0000000-0000-4000-8000-0000000009e1', '{}');
INSERT INTO pharmacy_portal_configs (config_id, pharmacy_id, portal_url, username_vault_id, password_vault_id) VALUES
  ('e0000000-0000-4000-8000-0000000005e1', 'e0000000-0000-4000-8000-0000000000e1', 'https://qa.example.org/portal', 'e0000000-0000-4000-8000-0000000009e2', 'e0000000-0000-4000-8000-0000000009e3');
UPDATE pharmacies SET api_config_id = 'e0000000-0000-4000-8000-0000000004e1', portal_config_id = 'e0000000-0000-4000-8000-0000000005e1' WHERE pharmacy_id = 'e0000000-0000-4000-8000-0000000000e1';
INSERT INTO circuit_breaker_state (pharmacy_id) VALUES ('e0000000-0000-4000-8000-0000000000e1');
INSERT INTO inbound_fax_queue (documo_fax_id, from_number, page_count, storage_path, matched_pharmacy_id) VALUES ('qa-fax-1', '+15125550300', 1, 'documo/qa', 'e0000000-0000-4000-8000-0000000000e1');

-- ── Sunrise test patients ───────────────────────────────────────
INSERT INTO patient_import_batches (batch_id, clinic_id, imported_by, file_name, total_rows, imported_rows, excluded_rows, duplicates_confirmed) VALUES
  ('f0000000-0000-4000-8000-0000000000b1', 'a1000000-0000-0000-0000-000000000001', 'a0000000-0000-4000-8000-0000000000a1', 'qaimport.csv', 3, 3, 0, 0);
INSERT INTO patients (patient_id, clinic_id, first_name, last_name, date_of_birth, phone, phone_e164, source, import_batch_id) VALUES
  ('f0000000-0000-4000-8000-0000000001f1', 'a1000000-0000-0000-0000-000000000001', 'Intake', 'Test', '1970-01-01', '+15125550401', '+15125550401', 'self_intake', NULL),
  ('f0000000-0000-4000-8000-0000000001f2', 'a1000000-0000-0000-0000-000000000001', 'QAImport', 'Alpha', '1970-01-02', '+15125550402', '+15125550402', 'csv_import', 'f0000000-0000-4000-8000-0000000000b1'),
  ('f0000000-0000-4000-8000-0000000001f3', 'a1000000-0000-0000-0000-000000000001', 'QAImport', 'Bravo', '1970-01-03', '+15125550403', '+15125550403', 'csv_import', 'f0000000-0000-4000-8000-0000000000b1'),
  ('f0000000-0000-4000-8000-0000000001f4', 'a1000000-0000-0000-0000-000000000001', 'QAImport', 'Charlie', '1970-01-04', '+15125550404', '+15125550404', 'csv_import', 'f0000000-0000-4000-8000-0000000000b1'),
  ('f0000000-0000-4000-8000-0000000001f5', 'a1000000-0000-0000-0000-000000000001', 'QAKeragon', 'Echo', '1970-01-05', '+15125550405', '+15125550405', 'ehr', NULL);
UPDATE patients SET possible_duplicate_of = 'f0000000-0000-4000-8000-0000000001f1', possible_duplicate_matched_on = 'name_and_date_of_birth', possible_duplicate_flagged_at = now()
WHERE patient_id = 'a3000000-0000-0000-0000-000000000002';
INSERT INTO patient_intake_links (clinic_id, patient_id, token_hash, expires_at) VALUES ('a1000000-0000-0000-0000-000000000001', 'f0000000-0000-4000-8000-0000000001f1', repeat('5', 64), now() + interval '1 day');
INSERT INTO orders (order_id, patient_id, provider_id, clinic_id, pharmacy_id, formulation_id, status, quantity) VALUES
  ('f0000000-0000-4000-8000-0000000004f1', 'f0000000-0000-4000-8000-0000000001f1', 'a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'DRAFT', 1);
INSERT INTO order_status_history (order_id, old_status, new_status) VALUES ('f0000000-0000-4000-8000-0000000004f1', 'DRAFT', 'DRAFT');
INSERT INTO phi_access_log (actor_user_id, actor_role, action, resource, route, patient_id, clinic_id) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', 'clinic_admin', 'view', 'patient', '/patients/[id]', 'f0000000-0000-4000-8000-0000000001f1', 'a1000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-4000-8000-0000000000a1', 'clinic_admin', 'view', 'patient', '/patients/[id]', 'a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001');

-- QA Keragon connection (Sunrise) with its Vault secret.
INSERT INTO vault.secrets (id, name, secret) VALUES ('f0000000-0000-4000-8000-0000000009f1', 'keragon-sunrise', 'x');
INSERT INTO ehr_connections (connection_id, clinic_id, provider, secret_vault_id) VALUES
  ('f0000000-0000-4000-8000-0000000005f1', 'a1000000-0000-0000-0000-000000000001', 'keragon', 'f0000000-0000-4000-8000-0000000009f1');
INSERT INTO ehr_sync_events (sync_event_id, connection_id, clinic_id, status, patient_id, detail) VALUES
  ('f0000000-0000-4000-8000-0000000006f1', 'f0000000-0000-4000-8000-0000000005f1', 'a1000000-0000-0000-0000-000000000001', 'applied', 'f0000000-0000-4000-8000-0000000001f5', '{}'),
  ('f0000000-0000-4000-8000-0000000006f2', 'f0000000-0000-4000-8000-0000000005f1', 'a1000000-0000-0000-0000-000000000001', 'applied', 'a3000000-0000-0000-0000-000000000001', '{}');
INSERT INTO patient_external_ids (clinic_id, patient_id, system, external_patient_id) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'f0000000-0000-4000-8000-0000000001f5', 'keragon', 'kg-echo'),
  ('a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'keragon', 'kg-alex');
INSERT INTO patient_field_changes (clinic_id, patient_id, field, applied, source, sync_event_id) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'f0000000-0000-4000-8000-0000000001f5', 'phone', true, 'ehr_sync', 'f0000000-0000-4000-8000-0000000006f1'),
  ('a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'phone', true, 'ehr_sync', 'f0000000-0000-4000-8000-0000000006f2');

-- ── Beta Test Practice 1 and 2, Beta Test MA ────────────────────
INSERT INTO clinics (clinic_id, name, stripe_connect_status, onboarding_status, signup_source, signup_kind) VALUES
  ('b0000000-0000-4000-8000-0000000000b1', 'Beta Test Practice', 'PENDING', 'submitted', 'self_serve', 'solo_provider'),
  ('b0000000-0000-4000-8000-0000000000b2', 'Beta Test Practice 2', 'PENDING', 'in_progress', 'self_serve', 'solo_provider');
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('b0000000-0000-4000-8000-0000000001b1', 'beta-test-provider@sunrise-clinic.com', '{"app_role":"clinic_admin","clinic_id":"b0000000-0000-4000-8000-0000000000b1"}'),
  ('b0000000-0000-4000-8000-0000000001b2', 'Beta-Test-Provider2@sunrise-clinic.com', '{"app_role":"clinic_admin","clinic_id":"b0000000-0000-4000-8000-0000000000b2"}'),
  ('b0000000-0000-4000-8000-0000000001b3', 'beta-test-ma@sunrise-clinic.com', '{"app_role":"medical_assistant","clinic_id":"a1000000-0000-0000-0000-000000000001"}');
INSERT INTO providers (provider_id, clinic_id, first_name, last_name, npi_number, license_state, license_number, user_id) VALUES
  ('b0000000-0000-4000-8000-0000000002b1', 'b0000000-0000-4000-8000-0000000000b1', 'Beta', 'One', '1888888888', 'TX', 'TX-B1', 'b0000000-0000-4000-8000-0000000001b1'),
  ('b0000000-0000-4000-8000-0000000002b2', 'b0000000-0000-4000-8000-0000000000b2', 'Beta', 'Two', '1777777777', 'TX', 'TX-B2', 'b0000000-0000-4000-8000-0000000001b2');
INSERT INTO provider_state_licenses (provider_id, state, license_number, expires_on, source) VALUES
  ('b0000000-0000-4000-8000-0000000002b1', 'TX', 'B1-TX', '2027-12-31', 'manual'),
  ('b0000000-0000-4000-8000-0000000002b2', 'TX', 'B2-TX', '2027-12-31', 'manual');
INSERT INTO clinic_onboarding_steps (clinic_id, step, status) VALUES ('b0000000-0000-4000-8000-0000000000b1', 'practice', 'complete'), ('b0000000-0000-4000-8000-0000000000b2', 'practice', 'in_progress');
INSERT INTO clinic_onboarding_events (clinic_id, event, actor_user_id, actor_role) VALUES
  ('b0000000-0000-4000-8000-0000000000b1', 'self_signup', 'b0000000-0000-4000-8000-0000000001b1', 'clinic_admin'),
  ('b0000000-0000-4000-8000-0000000000b2', 'self_signup', 'b0000000-0000-4000-8000-0000000001b2', 'clinic_admin');
INSERT INTO agreement_acceptances (clinic_id, agreement, template_version, text_sha256, signer_name, signer_title, user_id) VALUES
  ('b0000000-0000-4000-8000-0000000000b1', 'baa', 'v1.0', repeat('e', 64), 'Beta One', 'Owner', 'b0000000-0000-4000-8000-0000000001b1');
-- The Beta Test MA's Sunrise invite (goes) and Sunrise member event about the MA (stays).
INSERT INTO onboarding_invites (kind, clinic_id, email, token_hash, expires_at, created_by, accepted_at, accepted_user_id) VALUES
  ('medical_assistant', 'a1000000-0000-0000-0000-000000000001', 'beta-test-ma@sunrise-clinic.com', repeat('6', 64), now() + interval '7 days', 'a0000000-0000-4000-8000-0000000000a1', now(), 'b0000000-0000-4000-8000-0000000001b3'),
  ('medical_assistant', 'a1000000-0000-0000-0000-000000000001', 'ma@sunrise-clinic.com', repeat('7', 64), now() + interval '7 days', 'a0000000-0000-4000-8000-0000000000a1', now(), 'a0000000-0000-4000-8000-0000000000a3');
INSERT INTO clinic_onboarding_events (clinic_id, event, actor_user_id, actor_role, subject_user_id) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'member_deactivated', 'a0000000-0000-4000-8000-0000000000a1', 'clinic_admin', 'b0000000-0000-4000-8000-0000000001b3');

-- ── E2E-style login on prod ─────────────────────────────────────
INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
  ('90000000-0000-4000-8000-000000000001', 'test-ops-admin@compoundiq.test', '{"app_role":"ops_admin"}'),
  ('90000000-0000-4000-8000-000000000002', 'e2e-1729@example.com', '{}');
