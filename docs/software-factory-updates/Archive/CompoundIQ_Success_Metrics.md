CompoundIQ defines success across 7 categories: Operational Performance (adapter and fulfillment), Platform Reliability (SLA enforcement and system health), Growth (adoption and retention), Customer Experience (patient-facing), Financial (revenue and unit economics), Security/Compliance (HIPAA and data integrity), and Prescription Builder & Regulatory Compliance (cascading builder, structured sig, favorites/protocols, EPCS 2FA, drug interactions — added in Phases 17–19, WO-82 through WO-86). Each metric has a quantitative target, measurement method, and the V2.2 specification document it originates from.

---

## **Category 1: Operational Performance Metrics**

These measure the core value proposition — how effectively the Pharmacy Adapter Layer routes and fulfills orders across all 4 integration tiers.

| **Metric** | **Target** | **Measurement Method** | **Source** |
| --- | --- | --- | --- |
| Adapter Submission Success Rate (all tiers, weighted) | &gt;90% | adapter_submissions table: COUNT(status='ACKNOWLEDGED') / COUNT(all) over 24h rolling window, weighted by tier volume | 90-Day Roadmap V2.0, Section 6.3 |
| Tier 1 API Response Time (p95) | <2 seconds | adapter_submissions.latency_ms WHERE submission_method = 'REST_API', 95th percentile | 90-Day Roadmap V2.0, Section 6.3 |
| Tier 2 Portal Submission Time (p95) | <30 seconds | adapter_submissions.duration_ms WHERE submission_method = 'PORTAL_AUTOMATION', 95th percentile. Measures full Playwright flow: login → order entry → confirmation | 90-Day Roadmap V2.0, Section 6.3 |
| Tier 4 Fax Delivery Time | <30 minutes | Documo webhook fax.delivered timestamp minus fax.queued timestamp | SLA Engine Spec V2.0, Section 3.4 |
| Adapter Failover Rate | <5% | Orders where tier_fallback_from IS NOT NULL / total orders. Measures orders that had to fall back to a lower tier | 90-Day Roadmap V2.0, Section 6.3 |
| Tier Distribution | Maximize Tier 1/2, minimize Tier 4 | adapter_submissions grouped by submission_method. Track weekly trend of % orders by tier. Goal: shift volume from fax toward API/portal | 90-Day Roadmap V2.0, Section 6.3 |
| Webhook Processing Latency (p95) | <5 seconds | Time from webhook receipt (webhook_events.received_at) to order status update (order_status_history.changed_at), 95th percentile | 90-Day Roadmap V2.0, Section 6.3 |
| Order Completion Rate | &gt;95% | Orders reaching DELIVERED or REFUNDED terminal states / total orders past PAID_PROCESSING. Excludes orders cancelled pre-payment | 90-Day Roadmap V2.0, Appendix |
| Adapter Submission ACK SLA (Tier 1/3) | 15-minute acknowledgment | order_sla_deadlines WHERE sla_type = 'ADAPTER_SUBMISSION_ACK'. This is the 16x improvement over fax (15 min vs 4 business hours) — the primary metric for measuring adapter ROI | SLA Engine Spec V2.0, Section 3.9 |
| Adapter Submission ACK SLA (Tier 2) | 30-minute acknowledgment | Same table, Tier 2 orders. Portal automation has longer window due to Playwright session overhead | SLA Engine Spec V2.0, Section 3.9 |
| Circuit Breaker Activation Rate | Minimize (track, no hard target) | pharmacy_api_configs WHERE circuit_breaker_status = 'OPEN'. Track per-pharmacy. Frequent activation signals unreliable pharmacy integration | Master Initialization Artifact V2.2, HC-15 |
| AI Confidence Threshold Compliance | 100% enforcement | All Tier 2 portal submissions with confidence_score < 0.85 MUST route to PENDING_MANUAL_REVIEW. Zero auto-confirmations below threshold | Master Initialization Artifact V2.2, HC-16 |

---

## **Category 2: SLA Enforcement Metrics**

These measure the SLA Engine's effectiveness — the "nervous system" of the platform. Each SLA type has specific deadline targets and escalation thresholds.

| **SLA Type** | **Deadline Target** | **Clock Type** | **Escalation Tiers** | **Source** |
| --- | --- | --- | --- | --- |
| PAYMENT_EXPIRY | 72 hours after order enters AWAITING_PAYMENT | Wall clock 24/7 | Automated: transition to PAYMENT_EXPIRED status, notify clinic | SLA Engine V2.0, Section 3.1 |
| SMS_REMINDER_24H | 24 hours after order creation | Wall clock 24/7 | Automated: send SMS reminder to patient with payment link | SLA Engine V2.0, Section 3.2 |
| SMS_REMINDER_48H | 48 hours after checkout link sent (24h before expiry) | Wall clock 24/7 | Automated: send final SMS reminder to patient with payment link | SLA Engine V2.0, Section 3.3 |
| FAX_DELIVERY (Tier 4 only) | 30 minutes after fax submission | Wall clock 24/7 | Tier 1: Slack #ops-alerts (at deadline). Tier 2: Slack DM to ops lead (+15 min). Tier 3: PagerDuty page (+30 min) | SLA Engine V2.0, Section 3.4 |
| PHARMACY_ACK (Tier 4 only) | 4 business hours after fax delivery | Business hours M-F 8am-6pm | Tier 1: Slack (+0). Tier 2: Slack DM (+2 biz hrs). Tier 3: PagerDuty (+next biz day) | SLA Engine V2.0, Section 3.5 |
| PHARMACY_COMPOUNDING (Tier 4 only) | Pharmacy TAT + 4 business hours buffer | Business hours M-F 8am-6pm | Tier 1: Slack (+0). Tier 2: Slack DM (+24h). Tier 3: PagerDuty (+48h) | SLA Engine V2.0, Section 3.6 |
| SHIPPING | 24 hours after entering READY_TO_SHIP | Wall clock 24/7 | Tier 1: Slack (+0). Tier 2: Slack DM (+24h). Tier 3: PagerDuty (+48h) | SLA Engine V2.0, Section 3.7 |
| TRACKING_UPDATE | 48 hours after entering SHIPPED | Wall clock 24/7 | Tier 1: Slack (+0). Tier 2: Slack DM (+48h). Tier 3: PagerDuty (+72h) | SLA Engine V2.0, Section 3.8 |
| ADAPTER_SUBMISSION_ACK (Tier 1/2/3 — NEW) | 15 min (Tier 1/3 API) or 30 min (Tier 2 Portal) | Wall clock 24/7 | Automated cascade to next tier on breach, then: Tier 1: Slack (+0). Tier 2: Slack DM (+15 min). Tier 3: PagerDuty (+30 min) | SLA Engine V2.0, Section 3.9 |
| PHARMACY_COMPOUNDING_ACK (Tier 1/2/3 — NEW) | 2 business hours after acknowledgment | Business hours M-F 8am-6pm | Tier 1: Slack (+0). Tier 2: Slack DM (+2 biz hrs). Tier 3: PagerDuty (+4 biz hrs) | SLA Engine V2.0, Section 3.10 |

**SLA Engine Processing:** Cron job runs every 5 minutes via Vercel Crons (vercel.json). The /api/cron/sla-check endpoint uses an advisory lock pattern to prevent overlapping runs. Scans for breached, unresolved SLAs and processes escalation actions. Automated SLAs (PAYMENT_EXPIRY, SMS reminders) self-execute. Manual SLAs follow 3-tier escalation cascade. ADAPTER_SUBMISSION_ACK follows a cascade-then-escalate pattern — auto-cascade to next tier before escalating to humans.

---

## **Category 3: Growth & Adoption Metrics**

| **Metric** | **Target** | **Measurement Method** | **Source** |
| --- | --- | --- | --- |
| Prescriber Reorder Rate | &gt;50% by Week 4 of beta | Unique providers with 2+ orders / total unique providers. Measured weekly. Key retention signal | 90-Day Roadmap V2.0, Section 6.3 |
| Time-to-First-Order | <15 minutes from signup | Timestamp of clinic activation (stripe_connect_status = ACTIVE) to first order creation (orders.created_at). Key onboarding signal | 90-Day Roadmap V2.0, Section 6.3 |
| Beta Clinic Onboarding | 2-3 design partner clinics by Day 53 | Count of clinics with stripe_connect_status = ACTIVE during beta phase | 90-Day Roadmap V2.0, Section 6.1 |
| Revenue Per Order | Track and grow (no hard target for beta) | platform_fee_amount per completed order. Track trend over time | 90-Day Roadmap V2.0, Appendix |
| Avg Prescriptions Per Session (WO-80) | Track trend, target growth over time | AVG count of prescriptions per provider signature batch. Higher = more efficient multi-script sessions | WO-80 multi-script patient session |
| Provider Favorite Reuse Rate (WO-85) | &gt;30% of orders use a saved favorite by Week 8 | Orders created from a favorite (use_count > 0 increment) / total orders. Measures speed-feature adoption | WO-85 provider favorites |
| Protocol Template Usage (WO-85) | &gt;1 protocol per active clinic by Week 12 | Count of unique protocol_templates with use_count > 0 per clinic. Indicates clinics moving from ad-hoc to standardized prescribing | WO-85 clinic protocol templates |
| Draft Order Turnaround Time (WO-77) | <8 hours median from MA save to provider sign | MEDIAN(sign_at - draft_created_at) on orders that went through DRAFT state. Long delays signal provider workflow friction | WO-77 provider signature queue |

---

## **Category 4: Customer Experience Metrics**

| **Metric** | **Target** | **Measurement Method** | **Source** |
| --- | --- | --- | --- |
| Patient Satisfaction (NPS proxy) | &gt;8/10 | Post-delivery SMS survey. Unchanged from V1.0 | 90-Day Roadmap V2.0, Section 6.3 |
| Patient Payment Conversion Rate | Track (no hard target for beta) | Orders reaching PAID_PROCESSING / orders reaching AWAITING_PAYMENT. SMS reminder effectiveness measured by conversion after 24h and 48h reminders | PRD Part 2 V2.2, Section 7 (Friction 1) |
| Payment Link Expiry Rate | Minimize | Orders transitioning to PAYMENT_EXPIRED / total AWAITING_PAYMENT orders. High rate signals pricing or trust issues | PRD Part 2 V2.2, Section 7 (Friction 1) |
| SMS Delivery Success Rate | &gt;95% | Twilio delivery status callbacks: 'delivered' / total sent. 2-5% failure rate is typical. Critical for payment links | PRD Part 2 V2.2, Section 4 (Twilio) |
| MA Workflow Speed (single Rx) | Sub-30-second order creation workflow | Time from Cascading Prescription Builder open (WO-83) to "Sign & Send Payment Link" confirmation. Measured via client-side analytics | Master Initialization Artifact V2.2, Persona 1 |
| MA Workflow Speed (3-Rx batch, WO-80) | Under 60 seconds for 3-medication patient session | Time from patient selection to single batch signature for 3 prescriptions. Measures the multi-script efficiency gain over per-Rx flow | WO-80 multi-script patient session |
| Provider EPCS 2FA Latency (WO-86) | Under 30 seconds from signature to verified | Time from signature capture to TOTP verified event in epcs_audit_log. Long latency signals authenticator setup friction | WO-86 EPCS 2FA |

---

## **Category 5: Financial Metrics**

| **Metric** | **Target** | **Measurement Method** | **Source** |
| --- | --- | --- | --- |
| Platform Fee Capture Rate | 100% of eligible orders | platform_fee_amount collected via Stripe application_fee_amount on every completed order. Formula: (retail_price - wholesale_price) x platform_fee_pct | PRD Part 2 V2.2, Section 5.2 |
| Stripe Dispute Rate | <1% of transactions | charge.dispute.created webhook count / total payment_intent.succeeded count. Above 1% risks Stripe account restrictions | PRD Part 2 V2.2, Section 5 |
| Transfer Failure Rate | Minimize (platform absorbs risk) | transfer.failed webhook count / total transfers. Transfer failures do NOT affect patient orders — they are financial reconciliation issues only | Webhook Architecture V2.2, Section 4.6 |
| Clinic Payout Success Rate | &gt;99% | Successful Stripe transfers to clinic Express accounts / total attempted transfers | PRD Part 2 V2.2, Section 5 |

---

## **Category 6: Security & Compliance Metrics**

| **Metric** | **Target** | **Measurement Method** | **Source** |
| --- | --- | --- | --- |
| RLS Penetration Test | Zero unauthorized data leaks | Attempt cross-role data access on all 33 tables. RLS must block all cross-role queries. Tested during Sprint 5 integration testing | 90-Day Roadmap V2.0, Sprint 5 |
| HIPAA Session Timeout Compliance | 100% enforcement | All clinic user sessions enforce 30-minute idle timeout with 2-minute warning modal. 12-hour absolute timeout via JWT exp claim | Env & Security Spec V2.2, Section 6.4 |
| Webhook HMAC Verification | 100% of inbound webhooks verified | All pharmacy webhook payloads verified via per-pharmacy HMAC-SHA256 before processing. signature_verified must be TRUE for processing | Webhook Architecture V2.2, Section 3 |
| Supabase Vault Health | 100% rotation success | Credential rotation in Vault completes without downtime. Tested during Sprint 5 | 90-Day Roadmap V2.0, Appendix |
| PHI Leakage to Stripe | Zero occurrences | Stripe metadata contains order_id only. No patient name, DOB, medication, or diagnosis. Customer object: email only | PRD Part 2 V2.2, Section 5.4 |
| Checkout Page PHI Compliance | Zero medication names displayed | Patient checkout page shows "Custom Prescription — [Clinic Name]" only. Never medication names, dosages, or clinical info | PRD Part 2 V2.2, Section 6 (Screen 2.2) |
| SMS Content PHI Compliance | Zero violations | SMS contains patient first name + checkout URL only. Never medication names, dosages, DOB, or last name | Env & Security Spec V2.2, Section 6.5 |
| Failed Login Lockout | 5 attempts per 15 minutes | Supabase Auth rate limiting enforced. Brute-force prevention | Env & Security Spec V2.2, Section 6.4 |
| Rate Limiting Enforcement | Per-category limits enforced | Internal API: 100 req/min per clinic_id. Patient checkout: 10 req/min per IP. Clinic onboarding: 5 req/min per IP. Webhook endpoints: no rate limiting (rejecting causes data loss) | Env & Security Spec V2.2, Section 7.5 |
| Encryption Standards | AES-256 at rest, TLS 1.2+ in transit | All data at rest: AES-256 (Supabase-managed). All API calls: TLS 1.2 minimum. Vault secrets: AES-256-GCM. TOTP secrets (WO-86): AES-256-GCM with service-role-derived key | Env & Security Spec V2.2, Section 6.5 |

---

## **Category 7: Prescription Builder & Regulatory Compliance Metrics (NEW — WO-82 through WO-86)**

These measure the cascading prescription builder, structured sig builder, provider speed features, and DEA 21 CFR 1311 EPCS compliance added in Phases 17–19.

| **Metric** | **Target** | **Measurement Method** | **Source** |
| --- | --- | --- | --- |
| Cascading Builder Adoption | 100% of new prescriptions use cascading dropdown flow | All orders created via /api/formulations endpoint vs legacy catalog search. Should be 100% after WO-83 cutover | WO-83 cascading dropdown UI |
| Hierarchical Catalog Coverage | 50+ formulations seeded by Beta Day 1 | Count of pharmacy_formulations with is_active=true. Track per-pharmacy coverage as new partners onboard | WO-82 hierarchical medication catalog |
| Structured Sig Mode Distribution | Track Standard / Titration / Cycling usage | COUNT(orders) GROUP BY sig_mode. Titration + Cycling combined target: ≥15% of orders by Week 8 (validates the differentiator) | WO-84 structured sig builder |
| NCPDP Sig Length Compliance | 100% under 1,000 characters | All orders.sig_text length checked at submit. Zero orders exceeding NCPDP limit | WO-84 NCPDP enforcement |
| Drug Interaction Alert Surface Rate | 100% of conflicting sessions show alerts | Sessions with 2+ medications matching drug_interactions pairs MUST display severity-coded alerts at batch review. Zero missed alerts | WO-86 drug interaction alerts |
| Drug Interaction Override Rate | Track (no hard target) | Critical-severity alerts that providers signed through anyway (interaction acknowledged in audit log). Above 10% signals alerts may be too noisy | WO-86 drug interaction alerts |
| EPCS 2FA Enrollment Coverage | 100% of providers prescribing controlled substances | providers WHERE totp_enabled=true / providers WHERE has signed at least one DEA-scheduled order. Required for DEA 21 CFR 1311 compliance | WO-86 EPCS 2FA |
| EPCS 2FA Verification Success Rate | &gt;98% on first attempt | epcs_audit_log: COUNT(event_type='TOTP_VERIFIED') / (COUNT(TOTP_VERIFIED) + COUNT(TOTP_FAILED)). Low rate signals authenticator clock drift or UX issues | WO-86 EPCS 2FA |
| EPCS Audit Log Completeness | 100% of controlled substance signings logged | Every order with dea_schedule >= 2 must have at least 1 epcs_audit_log entry of event_type='TOTP_VERIFIED' or 'ORDER_SIGNED'. Zero missing entries | WO-86 epcs_audit_log + DEA 21 CFR 1311 retention |
| EPCS Audit Log Retention | 2 years minimum | epcs_audit_log records older than 2 years are NOT physically deleted. Append-only enforcement via RLS (INSERT only via service_role) | DEA 21 CFR 1311 + WO-86 |
| Provider Favorite Save Rate (WO-85) | Track adoption | Count of provider_favorites created per active provider per week. Higher = better speed-feature stickiness | WO-85 provider favorites |
| Patient Protocol Phase Tracking (WO-86) | 100% of protocol-loaded sessions tracked | patient_protocol_phases records created when a Clinic Protocol Template is loaded into a session. Phase advancements logged to phase_advancement_history | WO-86 patient protocol phases |

---

## **QA Gate Pass Criteria (Integration Testing Milestones)**

These are the binary pass/fail criteria that must be met at each QA gate during the build phase:

| **QA Gate** | **Pass Criteria** | **Phase** |
| --- | --- | --- |
| Gate 1 | All 33 tables provisioned with correct schemas, RLS policies active, all 10 enums created (17 original + 8 catalog WO-82 + 3 favorites/protocols WO-85 + 5 regulatory WO-86) | Sprint 1 (Days 15-22) |
| Gate 2 | End-to-end payment flow: patient checkout → Stripe payment → platform fee split → clinic payout. Refund flow tested | Sprint 2 (Days 23-30) |
| Gate 3 (NEW) | Submit test order through each adapter tier (Tier 1, 2, 4). Verify correct state transitions per tier. Circuit breaker triggers after 3 failures | Sprint 3 (Days 30-40) |
| Gate 4 | Full order lifecycle through ALL adapter tiers. Ops Dashboard shows tier-specific views. SLA timers calculate correctly per tier | Sprint 4 (Days 40-47) |
| Gate 5 | All adapters functional under 50 concurrent orders. Failover works correctly (Tier 1 → Tier 4). Credentials rotate without downtime. Playwright session recovery handles portal expiry. RLS enforced on all 33 tables. All 16 hard constraints validated. EPCS 2FA verified end-to-end for controlled substances (WO-86) | Sprint 5 (Days 47-50) |

---

## **90-Day Milestone Timeline**

| **Day** | **Milestone** | **Phase** |
| --- | --- | --- |
| Day 14 | Legal Foundation Complete | Phase 1 |
| Day 30 | Supply Chain + Adapter Infrastructure Ready | Phase 2 |
| Day 40 | Adapter Layer Functional (NEW in V2.0) | Phase 3 |
| Day 47 | MVP Feature Complete | Phase 3 |
| Day 50 | Integration Hardened | Phase 3 |
| Day 53 | Beta Live (2-3 design partner clinics) | Phase 4 |
| Day 65 | Beta Metrics Available | Phase 4 |
| Day 80 | Investor Meetings Active | Phase 5 |
| Day 90 | Target: Term Sheet | Phase 5 |

---

## **Key Benchmark: Adapter ROI**

The single most important metric differentiating CompoundIQ from a fax-only platform: **ADAPTER_SUBMISSION_ACK SLA of 15 minutes versus PHARMACY_ACK SLA of 4 business hours for fax.** This represents a 16x improvement in pharmacy acknowledgment response time and is the primary metric for measuring adapter layer ROI. This number should be featured prominently in investor data rooms and beta results.

---

**Source Documents:** 90-Day Execution Roadmap V2.0 (Section 6.3 Beta Metrics, Section 9 Appendix Key Metrics), SLA Engine Spec V2.0 (all 10 SLA types with deadlines and escalation tiers), PRD Part 2 V2.2 (Sections 5-7: payment, UI, edge cases), Master Initialization Artifact V2.2 (HC-15 circuit breaker, HC-16 AI confidence, acceptance criteria AC-A through AC-F), Env & Security Spec V2.2 (session timeouts, rate limits, encryption), Pharmacy Adapter Architecture (tier latency benchmarks, AI matching weights), Webhook Architecture V2.2 (processing pipeline), WO-77 (provider signature queue), WO-80 (multi-script patient session), WO-82/83/84 (cascading prescription builder + structured sig builder), WO-85 (provider favorites + clinic protocol templates), WO-86 (EPCS 2FA + drug interaction alerts + patient protocol phases — DEA 21 CFR 1311 compliance).