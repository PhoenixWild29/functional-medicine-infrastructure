# CompoundIQ — UI/UX Redesign Specification
# Phase 13: World-Class Interface Design

**Document Version:** 2.0 (Updated with Cowork Review)
**Date:** 2026-03-27
**Status:** Approved — Ready for Implementation

---

## Executive Summary

CompoundIQ is a medical SaaS platform handling prescription management, pharmacy routing, and patient checkout. This document defines a complete redesign strategy to achieve world-class UI/UX across all three application surfaces.

**Cowork Grade:** B+ (visual direction) → Target: A (visual + interaction)
**Key cowork finding:** The original spec was a visual reskin. This version adds interaction design, loading/error states, accessibility specifics, and responsive breakpoints — the elements that make a UI feel alive rather than just pretty.

**Design Philosophy:** Clean, trustworthy, and effortless. Every pixel communicates precision and reliability. Every interaction state is defined. No user is ever left wondering "did that work?"

**Reference Apps:** Stripe Dashboard, Linear, Vercel Dashboard, Supabase Dashboard, Elation Health, Canvas Medical, Ramp.

---

## Three Surfaces, Three Strategies

### Surface 1 — Clinic App (providers, medical assistants)
- **Mode:** Light mode
- **Primary:** `#2563EB` blue-600
- **Tone:** Professional, clinical, efficient

### Surface 2 — Ops Dashboard (internal operations team)
- **Mode:** Dark mode (`.dark` class scoped to ops layout only)
- **Primary:** `#3B82F6` blue-500 on dark
- **Tone:** Dense, powerful, information-first

### Surface 3 — Patient Checkout (public-facing, mobile-first)
- **Mode:** Light mode
- **Primary:** `#2563EB` blue-600
- **Tone:** Trustworthy, calm, effortless

---

## WO-70: UI Foundations (Split into 70a + 70b)

### 70a — Ships First (unblocks WO-71 styling immediately)
- CSS tokens, font, base component overrides

### 70b — Ships Second
- StatusBadge component + status-config logic

### Font — Geist (Self-Hosted)
Self-hosted via `next/font` — NOT a CDN. Healthcare environments frequently block external font CDNs.

Fallback chain: `Geist Sans → Inter → ui-sans-serif → system-ui → sans-serif`

Verify rendering at 14px on 1080p Windows with ClearType (clinic workstations), not just Retina.

### Color System

**Light Mode:**
| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#FFFFFF` | Page backgrounds |
| `--foreground` | `#0F172A` | Primary text |
| `--muted` | `#F8FAFC` | Subtle surfaces |
| `--muted-foreground` | `#64748B` | Secondary text |
| `--primary` | `#2563EB` | Interactive |
| `--border` | `#E2E8F0` | All borders |
| `--destructive` | `#EF4444` | Delete/error |
| `--success` | `#22C55E` | Confirmation |
| `--warning` | `#F59E0B` | Alerts |
| `--info` | `#0EA5E9` | Informational |
| `--radius` | `0.625rem` | Border radius |

**Dark Mode (ops layout only):**
| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#0C0E14` | Page backgrounds |
| `--foreground` | `#E8EAF0` | Primary text |
| `--card` | `#161B27` | Card surfaces |
| `--muted` | `#1E2535` | Elevated surfaces |
| `--border` | `#2A3347` | All borders |
| `--primary` | `#3B82F6` | Interactive |

**Critical:** Do NOT apply `.dark` globally. Scope to ops layout wrapper only to prevent token leakage into Clinic App and Checkout.

### Motion System
```
--duration-fast:   150ms   hover states, focus rings
--duration-normal: 250ms   sidebar collapse, card hover
--duration-slow:   350ms   page transitions, drawer open/close
--easing-standard: cubic-bezier(0.4, 0, 0.2, 1)
```

### Typography Scale (with line-heights)
```
Display/Metric    32px  font-bold      lh-1.1   Revenue totals
Page Header       24px  font-semibold  lh-1.25  Page titles
Section Header    18px  font-semibold  lh-1.4   Card headings
Subheading        15px  font-medium    lh-1.5   Section labels
Body              14px  font-normal    lh-1.6   Table cells (critical for dense views)
Small             13px  font-normal    lh-1.5   Helper text
Metadata          11px  font-medium    lh-1.4   UPPERCASE tracking-wide, column headers
Monospace         13px  font-mono      lh-1.5   Order IDs, reference numbers
```

### Status System — Colorblind Safe Dot + Label

Violet replaces cyan for SUBMITTED to avoid cyan/blue confusion (tritanopia):

```
● AWAITING_PAYMENT   amber  #D97706
● PAYMENT_RECEIVED   blue   #2563EB
● SUBMITTED          violet #7C3AED  ← changed from cyan
● FAX_QUEUED         cyan   #0891B2  ← distinct from violet
● COMPLETED          green  #16A34A
● PHARMACY_REJECTED  red    #DC2626
● EXPIRED            slate  #94A3B8
● CANCELLED          slate  #64748B
```

### Skeleton Loading System
Required for every data-loaded component:
- `<SkeletonCard />` — metric card placeholder
- `<SkeletonTableRow />` — table row (repeat 8×)
- `<SkeletonKanbanCard />` — kanban card (repeat 3× per lane)
- `<SkeletonText />` — text block

Rule: show skeleton immediately on mount. Never show blank screen.

### Toast / Notification System (Sonner)
```ts
notify.success('Payment link sent')
notify.error('Reroute failed', 'Pharmacy adapter is offline')
notify.warning('SLA breach — Order #abc123')
notify.promise(submitOrder(), { loading: '...', success: '...', error: '...' })
```

---

## WO-71: Clinic App UI Refresh

### Login Page
- Desktop: two-column (brand left, form right)
- Mobile: single-column form only
- Error state: inline red message below form
- Loading state: button disabled + spinner + "Signing in…"
- Trust signal: 🔒 "HIPAA-compliant authentication" (not encryption specifics)
- **Note:** Tagline copy must go through copywriting review — do not ship placeholder marketing text

### Sidebar Navigation — Three Breakpoints
- **≥1280px:** 240px expanded sidebar with labels
- **768–1279px (tablet):** 56px icon-rail only — critical for iPad on rolling carts
- **<768px:** Hidden + slide-over drawer + hamburger

### Metric Cards
- Trend indicator: color + arrow icon (never color alone)
- Comparison period defined: "vs. [same month prior year]"
- Day-one empty state: "—" with hover tooltip
- Skeleton loading state

### Kanban — Interaction Design
- `@dnd-kit/core` for drag-and-drop
- Invalid drop targets: visual rejection during drag (red ring on invalid column)
- Column overflow: max-height with internal scroll
- Empty lane: dashed border "No orders here"
- Skeleton: 3× per lane on load

### Prescription Wizard — State Preservation
- `sessionStorage` preserves mid-wizard state on browser close
- On return: "Continue where you left off?" banner
- Step indicators: clickable for completed steps, locked for future steps
- Form validation: inline errors on blur, not on keystroke

---

## WO-72: Ops Dashboard Dark Mode Redesign

### Dark Mode Scoping
`.dark` class on ops layout wrapper only. Test all three surfaces after implementation to verify no token leakage.

### Pipeline Table
- 8 columns: ID, Patient, Medication, Clinic, Pharmacy, Status, SLA, Actions
- SLA urgency by **absolute time remaining** (not percentage):
  - >4h: muted text
  - 1–4h: amber + clock icon
  - <1h: red + clock icon
  - Overdue: 4 indicators — red border + red tint + ⚠️ icon + "OVERDUE" text
- Real-time: 30s poll or Supabase realtime + "Last updated: Xs ago" timestamp
- Connection lost: "Live updates paused — reconnecting…" banner

### SLA Progress Bars
- Color based on absolute minutes remaining, not percentage
- **Use server-calculated `sla_minutes_remaining`** — never client-side date math (clock skew risk)
- Thresholds: >240m green, 60–240m amber, <60m red, 0 pulsing red

### Adapter Health
- Circuit breaker → plain English: CLOSED="Online", HALF_OPEN="Degraded", OPEN="Offline"
- Status: dot + text + icon (three indicators — never color alone)
- Success rate labeled "(last 24h)" — not all-time

---

## WO-73: Patient Checkout Polish

### Trust Badges — HIPAA Removed
- ✅ 🔒 "256-bit TLS Encryption"
- ✅ ⚡ "Powered by Stripe"
- ❌ HIPAA badge — **legally risky without formal audit. Removed until legal approves.**

### Above the Fold
Pay button visible without scrolling on 375px × 667px (iPhone SE). Collapse order summary if needed.

### All Error States Defined
1. **Card declined** — inline error, pay button re-enables, patient stays on page
2. **Generic payment error** — inline error, retry enabled
3. **Stripe iframe fails** — 10s timeout → fallback message + Sentry log
4. **Already paid** — redirect to success with "already paid" message
5. **Expired token** — redirect to expired page
6. **Invalid token** — redirect to expired page

### Success Page
- CSS keyframe checkmark animation (no external library)
- Static "What happens next" 3-step list (real-time updates are a future enhancement)
- Order reference in font-mono for patient records

### Expired Page
- Amber clock icon (not red — expired ≠ error)
- Calm, instructional copy. Show clinic contact if available.

### Mobile Standards (Non-Negotiable)
- 48px minimum touch targets
- 16px minimum input font-size (prevents iOS zoom)
- No horizontal scroll at any viewport
- `maximum-scale=1` on viewport meta

---

## Design Principles

1. **Behavior over appearance** — How it acts when things go wrong matters more than how it looks in a screenshot
2. **Color is communication** — Every color has semantic meaning. Never decorative. Never sole indicator.
3. **Density matches the user** — Ops: dense tables. Patients: spacious forms. Clinic staff: balanced.
4. **Every state is defined** — Loading, empty, error, success. No blank screens. No "No data."
5. **Accessibility is not optional** — WCAG AA minimum. Medical platform. Every user must succeed.
6. **Motion has purpose** — Consistent timing scale. Sidebar: 250ms. Hover: 150ms. Drawers: 350ms.

---

## Implementation Order

1. **WO-70a** — CSS tokens, font, motion system, skeleton, toast (ships first)
2. **WO-70b** — StatusBadge component (ships second, unblocks table/kanban work)
3. **WO-71** — Clinic App (highest daily-use, highest impact)
4. **WO-72** — Ops Dashboard dark mode
5. **WO-73** — Patient Checkout polish

---

## Open Items (Future Enhancements)
- Keyboard shortcuts for ops users (J/K navigation, Enter/Escape)
- Dark mode for Clinic App (system-preference respecting)
- Real-time step updates on checkout success page
- HIPAA trust badge (pending legal/compliance approval)
- Copywriting review for all marketing/tagline copy in the product

---

## Phase 15 Addendum — Patient-Centric Workflow Redesign (WO-77 + WO-80)

**Date:** April 7, 2026
**Status:** Implemented and deployed

Phase 15 introduced major UX changes to the prescription creation flow. These build on the Phase 13 design system (tokens, typography, components) but add new screens and interactions.

### New UI Components (WO-80 — Multi-Script Patient Sessions)

1. **Patient & Provider Selector** (`/new-prescription`)
   - Patient search input with filterable scrollable list (name, DOB, phone, state badge)
   - Provider card list with auto-select for single-provider clinics
   - Green checkmark confirmation on patient selection
   - "Continue to Pharmacy Search" button (disabled until both selected)

2. **Session Banner** (persistent across all prescription flow pages)
   - Left: Patient avatar (initials), name, DOB, state, phone
   - Right: Provider name, NPI
   - Bottom row (when prescriptions added): Count badge + "Review & Send" shortcut link
   - Uses `bg-muted/30`, `border-border`, `text-foreground`/`text-muted-foreground`

3. **Dual Action Buttons** (margin builder page)
   - "Add & Search Another" (outlined/secondary: `border-primary`, `text-primary`)
   - "Review & Send (N)" (primary: `bg-primary`, `text-primary-foreground`) with dynamic count
   - Session count note below buttons when prescriptions already in session

4. **Batch Review Page** (`/new-prescription/review`)
   - Prescription cards: medication, pharmacy, form, dose, sig, wholesale, retail, clinic margin
   - "Remove" link per card
   - "+ Add Another Prescription" dashed border button
   - Combined totals section: total retail, total platform fee (15%), total est. clinic margin
   - Single provider signature pad with "Signing N prescriptions for [Patient]" label
   - "Sign & Send All N Prescriptions" / "Sign & Send Payment Link" (adapts to count)
   - Confirmation dialog with total amount, count, patient name, phone, 72-hour warning

### New UI Components (WO-77 — Provider Signature Queue)

5. **Save as Draft Button** (margin builder page, below main action buttons)
   - Separated by `border-t border-border` divider
   - Muted style: `border-border`, `text-muted-foreground`
   - Helper text: "Creates the order without signing. The provider can review and sign from the dashboard."

6. **Amber "Awaiting Provider Signature" Banner** (order detail drawer for DRAFT orders)
   - `border-amber-300`, `bg-amber-50`, `text-amber-800`
   - Explanation text + "Review & Sign This Prescription" button (`bg-amber-600`)

7. **Provider Sign Page** (`/new-prescription/sign/[orderId]`)
   - Patient info card (left: name, DOB, state, phone / right: provider name, NPI)
   - Prescription detail card (medication, form, dose, pharmacy, sig)
   - Financial summary card (wholesale, retail, platform fee, est. clinic margin)
   - Signature pad with provider name + NPI label
   - "Sign & Send Payment Link" button + confirmation dialog
   - "Back to Dashboard" secondary action

### Updated Wizard Steps

Old (Phase 13):
```
Step 1: Select Pharmacy → Step 2: Set Price → Step 3: Review & Send
```

New (Phase 15):
```
Step 1: Patient & Provider → Step 2: Add Prescriptions → Step 3: Review & Send
```

### Route Changes

| Old Route | New Route | Purpose |
|-----------|-----------|---------|
| `/new-prescription` (pharmacy search) | `/new-prescription` (patient/provider selector) | Entry point changed |
| — | `/new-prescription/search` | Pharmacy search moved here |
| `/new-prescription/review` (single order, URL params) | `/new-prescription/review` (batch, session context) | Now reads from session, not URL |
| — | `/new-prescription/sign/[orderId]` | Provider signs drafts |
