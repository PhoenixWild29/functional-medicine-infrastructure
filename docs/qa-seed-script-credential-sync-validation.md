# Seed Script Credential Sync — QA Validation Report

**Date:** April 3, 2026
**Change:** `scripts/seed-poc.ts` — Auth user upsert (credential drift fix)
**Application:** https://functional-medicine-infrastructure.vercel.app
**Tester:** Claude (Automated QA)

---

## Summary

**Overall Result: ✅ ALL CHECKS PASS**

The seed script credential sync fix is validated. All 4 POC accounts authenticate with their canonical passwords, RBAC correctly blocks cross-role access, and all seed data (clinic, pharmacy, catalog) is intact.

---

## Results

| Check | Result | Notes |
|-------|--------|-------|
| Ops Admin login | ✅ PASS | `ops@compoundiq-poc.com` / `POCAdmin2026!` → Redirected to `/ops/pipeline` (dark mode Ops Dashboard). Pipeline shows 2 orders. |
| Clinic Admin login | ✅ PASS | `admin@sunrise-clinic.com` / `POCClinic2026!` → Redirected to `/dashboard` (Clinic App). Dashboard shows KPI cards and 2 orders. |
| Provider login | ✅ PASS | `dr.chen@sunrise-clinic.com` / `POCProvider2026!` → Redirected to `/dashboard` (Clinic App). |
| MA login | ✅ PASS | `ma@sunrise-clinic.com` / `POCMA2026!` → Redirected to `/dashboard` (Clinic App). |
| RBAC: ops → /dashboard blocked | ✅ PASS | Ops admin navigated to `/dashboard` → Redirected to `/unauthorized`. "Access Denied" page shows: signed in as `ops@compoundiq-poc.com`, Role: `ops_admin`. |
| RBAC: clinic → /ops blocked | ✅ PASS | Clinic admin navigated to `/ops/pipeline` → Redirected to `/unauthorized`. "Access Denied" page displayed. |
| Seed data: medications searchable | ✅ PASS | Typed "Sema" in medication search → Dropdown shows "Semaglutide Injectable · 0.5mg/0.5mL". |
| Seed data: pharmacy visible | ✅ PASS | Searched Semaglutide + TX → "1 pharmacy found": Strive Pharmacy, $150.00 wholesale, Fax · ~30 min. |

---

## What Was Validated

1. **Credential sync works** — All 4 accounts authenticate with the canonical POC passwords defined in `seed-poc.ts`. The previous "skip if exists" behavior would have left stale passwords in place; the new upsert ensures passwords match the script.

2. **No regressions** — Role metadata (`role`, `clinic_id`) is correctly set on all accounts. RBAC enforcement is intact. Seed data (clinic, patient, provider, pharmacy, catalog items) was not corrupted by the upsert.

3. **Demo-ready** — All accounts can be used immediately after running the seed script, regardless of whether the Supabase Auth users already existed.
