# Desktop Regression Report — Post Mobile UX Fixes

**Commit under test:** `9c1e1ac` (8 mobile UX CSS changes)  
**Baseline:** Round 6 validation (commit `23d7815`) — CLEAN PASS  
**Test date:** 2026-04-19  
**Viewport:** Desktop (1545 × 784)  
**Logged in as:** clinic_admin (admin)  
**Scope:** Layout regression only — 5 screens affected by CSS changes  

---

## Changes Under Test

| Component | Change | Risk |
|-----------|--------|------|
| `order-history-table.tsx` | select font-size 14→16px | Low |
| `patient-provider-selector.tsx` | input font-size 14→16px, session banner button min-h-[44px] | Medium |
| `cascading-prescription-builder.tsx` | 18 input/select elements font-size 14→16px | **High** |
| `structured-sig-builder.tsx` | sig builder input font-size 14→16px | **High** |
| `margin-builder-form.tsx` | retail price input + sig textarea font-size 14→16px | Medium |
| `order-drawer.tsx` | max-w-md → md:max-w-md (responsive) | Medium |

---

## Screen-by-Screen Results

### Screen 1 — Dashboard (Filter Tabs + Order Table) → **PASS**

- Status filter tabs (`All 12`, `Drafts 1`, `Awaiting Payment 10`, `Submitting 1`, `Processing`, `Shipped`, `Errors`) render inline without wrapping
- Table/Kanban toggle and "+ New Prescription" button correctly positioned
- Column headers (`ORDER #`, `PATIENT`, `MEDICATION`, `STATUS`, `METHOD`, `CREATED`, `UPDATED`) fit without truncation
- Order rows render at proper height with 16px select font

### Screen 2 — Patient / Provider Selection → **PASS**

- Session banner ("Alex Demo" + "Sarah Chen") renders with proper padding
- Banner buttons at min-h-[44px] are proportionate on desktop — no oversized appearance
- Patient search input at 16px font renders cleanly, no overflow
- Provider dropdown at 16px renders correctly

### Screen 3 — Cascading Prescription Builder + Structured Sig → **PASS**

- **MEDICATION** field: "Semaglutide" renders at 16px, no overflow ✓
- **FORMULATION** cards: Both formulation options display cleanly ✓
- **DOSE & DIRECTIONS (Standard mode):**
  - Row 1: Amount input + units dropdown + Select frequency dropdown — all 3 fit on one row ✓
  - Row 2: timing dropdown + duration dropdown — both fit on one row ✓
- **Titration mode (highest risk):**
  - "Start at" — numeric input (0.1) + unit dropdown (mL) fit on one row ✓
  - "Increase by" — numeric input (0.1) + unit dropdown (mL) fit on one row ✓
  - "Every" — dropdown (Every 3-4 days) fits on one row ✓
  - "Up to" — numeric input (0.5) + unit dropdown (mL) + "as tolerated" text — all fit on one row ✓
  - **No wrapping or overflow in w-20/w-16 containers at 16px** ✓
- **Cycling mode:**
  - "5 days on / 2 days off" — both inputs + labels fit on one row ✓
  - "Cycle for 6 weeks then reassess" — input + dropdown + label fit on one row ✓
  - "Rest period" text input — full width, no clipping ✓
- **QUANTITY & REFILLS**: Select quantity + 0 refills — both fit inline ✓
- **Continue button**: Full width, renders correctly ✓

### Screen 4 — Margin Builder → **PASS**

- **WHOLESALE COST card**: Medication name + $150.00 right-aligned, clean ✓
- **Retail Price input**: `$ 210.00` — dollar sign prefix properly aligned to left of input at 16px, no overlap or misalignment ✓
- **Multiplier buttons**: 1.5× / 2× / 2.5× / 3× — all 4 inline, correct spacing ✓
- **MARGIN SUMMARY**: Margin % 28.6%, Platform fee $9.00 (15% of margin), Est. clinic margin $51.00 — all right-aligned, clean ✓
- **Sig textarea**: Full sig text at 16px renders without clipping, textarea has proper height ✓
- **Character counter**: "73 characters" visible ✓
- **Action buttons**: "Add & Search Another" + "Review & Send" side by side ✓
- **"Save as Draft"** button below, full width ✓

### Screen 5 — Order Detail Drawer → **PASS**

- **Drawer width**: ~448px (max-w-md) applied correctly at desktop via `md:max-w-md` breakpoint — identical to Round 6 baseline ✓
- **ORDER header**: Full UUID renders without truncation ✓
- **Awaiting Provider Signature banner**: Text wraps properly within drawer width ✓
- **"Review & Sign This Prescription" button**: Full width within drawer ✓
- **PRESCRIPTION section**: Medication name, patient, dispatch — all fit ✓
- **FINANCIAL SPLIT card**: All 5 line items (Wholesale cost, Patient retail price, Margin, Platform fee, Clinic payout) with right-aligned dollar values — clean layout ✓
- **RX DOCUMENT + STATUS TIMELINE**: Both sections visible ✓
- **Close button (×)**: Properly positioned top-right ✓

---

## Summary

| Screen | Verdict | Regressions |
|--------|---------|-------------|
| 1. Dashboard | **PASS** | 0 |
| 2. Patient/Provider Selection | **PASS** | 0 |
| 3. Cascading Builder + Sig | **PASS** | 0 |
| 4. Margin Builder | **PASS** | 0 |
| 5. Order Detail Drawer | **PASS** | 0 |

### Overall Verdict: **CLEAN PASS — 0 desktop regressions**

The 8 mobile UX CSS changes (font-size 14→16px, min-h-[44px] touch targets, md:max-w-md responsive drawer) introduce **zero layout regressions** on desktop. All fields fit within their containers, no text wrapping or overflow observed, and the order drawer width is unchanged from the Round 6 baseline.

The demo walkthrough document (`POC-DEMO-DETAILED.md`) remains fully accurate at the desktop pixel-precision level.
