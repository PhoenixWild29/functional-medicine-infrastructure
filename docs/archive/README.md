# CompoundIQ Documentation

## Investor & Partner Documents

These are the primary documents for demos, investor meetings, and partner onboarding.

| Document | Description |
|----------|-------------|
| [Executive Overview](COMPOUNDIQ-EXECUTIVE-OVERVIEW.md) | Company overview, market opportunity, product vision |
| [System Architecture](SYSTEM-ARCHITECTURE-OVERVIEW.md) | Technical architecture, data flow, infrastructure |
| [Demo Guide — Quick Start](POC-DEMO-QUICKSTART.md) | 5-minute demo walkthrough for live presentations |
| [Demo Guide — Detailed](POC-DEMO-DETAILED.md) | Comprehensive demo with all features and edge cases |
| [Pharmacy Integration Guide](PHARMACY-INTEGRATION-GUIDE.md) | How compounding pharmacies connect to CompoundIQ |
| [Clinic Onboarding Playbook](CLINIC-ONBOARDING-PLAYBOOK.md) | Step-by-step clinic setup and training guide |
| [Business Action Plan](BUSINESS-ACTION-PLAN.md) | Go-to-market strategy and execution plan |

> PDF versions of each document are available alongside the markdown files.

---

## Subdirectories

### [`technical/`](technical/)

Developer reference documentation — API specs, data dictionary, ops runbook, setup guides, and security docs.

| Document | Description |
|----------|-------------|
| API-REFERENCE | REST API endpoints, auth, request/response schemas |
| DATA-DICTIONARY | All database tables, columns, types, relationships |
| OPS-RUNBOOK | Ops dashboard usage, SLA management, fax workflows |
| CATALOG-DATA-GUIDE | Pharmacy catalog CSV format, upload, sync |
| POC-TESTING-GUIDE | Test scenarios for POC validation |
| erd | Entity-relationship diagram |
| event-sequencing | Order lifecycle event flow |
| migration-guide | Database migration procedures |
| poc-setup | Local development setup |
| security-audit | Security review findings |
| snapshot-immutability | Order snapshot design |
| ui-redesign-spec | UI/UX redesign specifications |
| vercel-setup-guide | Vercel deployment configuration |
| vault-credential-guide | Secrets management |
| webhook-secrets | Webhook authentication setup |

### [`research/`](research/)

Deep research reports from Perplexity and Gemini, plus real patient protocol data and design briefs used to inform the cascading prescription builder (WO-82 through WO-86).

| Document | Description |
|----------|-------------|
| perplexity-portals | Competitive analysis: DrScript, WellsPx3, LifeFile, Empower |
| perplexity-structured-sig | NCPDP structured sig format, frequency codes, Surescripts |
| perplexity-data-models | Master Formulation Records, 503A/503B, RxNorm |
| perplexity-protocol-templates | Practice Better, Cerbo Chart Parts, Elation |
| perplexity-progressive-disclosure | Epic SmartSets, cascading dropdown UX patterns |
| perplexity-regulatory | DEA 21 CFR 1306/1311, EPCS, state board rules |
| perplexity-medication-examples | BPC-157, Semaglutide, real formulation configurations |
| compounding-rx-ux-research | Gemini deep research (22 pages, 82 citations) |
| prescription-builder-design-brief | Master design document for the cascading builder |
| prescription-builder-workorder-plan | 3-layer build plan (WO-82 through WO-86) |
| real-protocol-data-lauren | 3 real patient protocols with 16 test cases |

### [`qa-reports/`](qa-reports/)

QA validation reports from Claude Cowork browser testing. Each report documents test results, screenshots, and findings for a specific phase or work order.

| Report | Phase/WO | Result |
|--------|----------|--------|
| qa-phase17-cascading-prescription-builder | Phase 17 (WO-82/83/84) | 8/8 PASS |
| qa-phase18-provider-favorites-protocol-templates | Phase 18 (WO-85) | 7/7 PASS |
| qa-phase19-epcs-2fa-drug-interactions | Phase 19 (WO-86) | 6/6 PASS |
| qa-wo77-provider-signature-queue | WO-77 | PASS |
| qa-wo80-multi-script-patient-session | WO-80 | 7/7 PASS |
| qa-wo82-medication-catalog-api | WO-82 | 4/4 PASS |
| qa-wo83-cascading-dropdown-prescription-builder | WO-83 | 6/6 PASS |
| qa-clinic-app-visual-validation | UI Visual Review | PASS |
| qa-ops-dashboard-dark-mode-validation | Dark Mode | PASS |
| qa-patient-checkout-validation | Checkout Flow | PASS |
| qa-seed-script-credential-sync | Credential Sync | PASS |
| poc-validation-log | Full POC Validation | PASS |
