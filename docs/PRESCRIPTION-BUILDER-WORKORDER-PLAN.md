# CompoundIQ — Cascading Dropdown Prescription Builder — Work Order Plan

**Date:** April 8, 2026
**Status:** Work orders created, ready for phased execution
**Approach:** 3-layer build where each layer ships independently

---

## Architecture Decision: Build Alongside, Switch Over

- New tables coexist with existing `catalog` table — no migration, no disruption
- New prescription flow uses new hierarchical tables
- Old card-based search stays accessible as fallback during development
- Existing orders unaffected (snapshot fields are self-contained)
- Once new flow validated, deprecate old path
- Rollback is trivial — just hide the new route

---

## Layer 1: Foundation (Hierarchical Catalog + Cascading Dropdowns)

**What changes:** Data model + pharmacy search UI
**What doesn't change:** Everything after medication selection (margin builder, batch review, signature, checkout, ops dashboard)

### WO-82: Hierarchical Catalog Data Model
- **Phase:** 17 (Prescription Builder)
- **Blocked by:** Nothing — can start immediately
- **Scope:** New database tables (ingredients, salt_forms, formulations, formulation_ingredients, pharmacy_formulations, sig_templates)
- **Seed data:** 20-30 formulations from Lauren's real protocols
- **Key principle:** Coexists alongside existing `catalog` table

### WO-83: Cascading Dropdown UI
- **Phase:** 17
- **Blocked by:** WO-82
- **Scope:** 10-level cascade replacing card-based pharmacy search
- **Key feature:** Progressive disclosure — fields appear only when relevant
- **Integration:** Plugs into existing WO-80 multi-prescription session flow
- **Target:** Sub-30-seconds per NEW prescription

### WO-84: Structured Sig Builder + Titration Engine
- **Phase:** 17
- **Blocked by:** WO-83
- **Scope:** Auto-generate sig from dropdown selections, titration mode, cycling mode, unit auto-conversion
- **Competitive differentiator:** MARKET FIRST — no existing platform has a titration schedule builder
- **Test cases:** 7 real-world sigs from Lauren's protocols

---

## Layer 2: Speed (Favorites + Protocol Templates)

**What changes:** New speed features on top of dropdown system
**Depends on:** Layer 1 complete

### WO-85: Provider Favorites + Protocol Templates + Adaptive Shortlist
- **Phase:** 18 (Speed Optimization)
- **Blocked by:** WO-84
- **Scope:**
  - Provider favorites: save/load prescription configs (one-click)
  - Protocol templates: multi-medication bundles with phases (one-click adds all to session)
  - Adaptive shortlist: system learns from prescribing patterns
  - Recent orders: last 10 prescriptions for quick reorder
- **Competitive differentiator:** MARKET FIRST — no portal supports protocol templates as structured order bundles
- **Benchmark:** Epic SmartSets achieve 5x friction reduction — our target

---

## Layer 3: Advanced (Regulatory + Clinical Decision Support)

**What changes:** EPCS compliance, drug interactions, phase management
**Depends on:** Layers 1 + 2 complete

### WO-86: EPCS 2FA + Drug Interaction Alerts + Phase Management
- **Phase:** 19 (Regulatory Compliance)
- **Blocked by:** WO-85
- **Scope:**
  - EPCS Two-Factor Authentication for controlled substances (DEA 21 CFR 1311)
  - Drug interaction alerts (SS-31 + MOTS-c same-day constraint)
  - FDA regulatory alerts (BPC-157 Category 2, Semaglutide status)
  - Clinical Difference statement for commercial equivalents
  - Phase-gated protocol advancement based on lab results
  - Cycling protocol support (5on/2off, pulse dosing)
- **Legal requirement:** EPCS 2FA is mandatory for Schedule II-V prescribing — not optional

---

## Dependency Chain

```
WO-82 (Data Model) ← START HERE
  │
  v
WO-83 (Cascading Dropdown UI)
  │
  v
WO-84 (Sig Builder + Titration)
  │
  v
WO-85 (Favorites + Protocols + Shortlist)
  │
  v
WO-86 (EPCS + Interactions + Phases)
```

---

## Research Foundation

| Document | Lines | What It Covers |
|----------|-------|---------------|
| PRESCRIPTION-BUILDER-DESIGN-BRIEF.md | ~500 | Master design doc: data model, UI design, test cases, phased build |
| COMPOUNDING-RX-UX-RESEARCH.md | ~130 | Gemini research summary (22 pages, 82 citations) |
| compoundiq_rx_ordering_ux_research.pdf | 137 pages | Full Perplexity PDF |
| research_area_1_portals.md | 613 | DrScript, WellsPx3, LifeFile, Empower, ReviveRX, Belmar |
| research_area_2_structured_sig.md | 544 | NCPDP structured sig, Surescripts Sig IQ, frequency codes |
| research_area_3_data_models.md | 795 | MFR schema, 503A/503B, RxNorm, PCCA, USP 795/797, SQL |
| research_area_4_protocol_templates.md | 549 | Practice Better, Cerbo, Elation, CharmHealth |
| research_area_5_progressive_disclosure.md | 532 | Epic FPO metrics, Cerner PowerPlans, 62-clicks study |
| research_area_6_regulatory.md | 506 | DEA 21 CFR 1306/1311, EPCS 2FA, state board rules |
| research_area_7_medication_examples.md | 850 | Semaglutide, Testosterone, LDN, BPC-157 configurations |
| REAL-PROTOCOL-DATA-LAUREN.md | ~360 | 3 real protocols (17+ daily items, 6-phase detox, prescription labels) |

**Total research: 5,000+ lines across 11 documents**

---

## Three Competitive Gaps CompoundIQ Will Fill

1. **Structured titration schedule builder** — First in market (WO-84)
2. **Protocol templates as order bundles** — First in market (WO-85)
3. **Progressive disclosure cascading dropdowns** — First in compounding pharmacy space (WO-83)

---

## Speed Targets

| Scenario | Target | How |
|----------|--------|-----|
| New medication (never prescribed before) | Sub-30 seconds | Cascading dropdowns with progressive disclosure |
| Repeat medication (prescribed before) | Sub-5 seconds | Provider favorites (one-click load) |
| Full protocol (3-5 medications) | Sub-15 seconds | Protocol template (one-click adds all) |
| Reorder previous prescription | Sub-3 seconds | Recent orders or Clone |

---

*This plan is backed by 137+ pages of competitive research, 3 real patient protocols, and direct clinician feedback. Each layer delivers independent value and can be deployed and tested before the next begins.*
