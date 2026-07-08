# Documentation Audit — 2026-07-07

**Method:** two parallel doc-audit agents (root-level docs + `docs/` tree incl. demo doc), checked against GitHub `main` at ~`e5d2bff`.

**Important context:** the local OneDrive checkout is at `99bff95` — **behind `main`**. It doesn't yet contain PR #100 (the V3 importer) or the merge commits for #98/#99/#100. A `git pull` is pending (blocked by the same local git-auth issue). This audit describes what the docs must say to match **GitHub `main`** (the source of truth); some files won't show the latest code until the checkout syncs.

---

## What we shipped that the docs don't reflect

Jun-14 batch (#90–95), dependabot #89, orphan `adapter-health-check` cron removed (#96), PHI purge cron daily→hourly (#94), 166-product demo catalog CSV (#98), types cleanup + cast removal (#99), and the **V3 catalog importer** (#100: `scripts/import-catalog-v3.ts` / `npm run seed:catalog` + `scripts/generate-catalog-sql.py`). Phase C multi-Rx "Combine and Send" has been live since Jun 12; role features F-3/F-5 shipped. None of the partner-facing or technical docs describe the catalog or Phase C.

---

## Priority 0 — quick factual fixes (low risk, unambiguous)

| Doc | Fix |
|---|---|
| **STATUS.md** | Header still `2026-07-02` / commit `c9d79c1`; zero mention of #98/#99/#100 or the catalog. → refreshed this session (see below). |
| **docs/audits/phi-policy-adapter-submissions.md** | "Retention cron … scheduled **daily at 03:00 UTC**" is wrong — it's now **hourly** (`0 * * * *`, PR #94). Worst-case PHI residence is ~25h, not 48h. One-line fix. |
| **docs/audits/role-audit-and-data-model.md** | §10 says F-3 has "no toggle" — superseded by PR #92 (provider opt-in clinic-view toggle). F-5 (`primary_provider_id`) still listed OPEN but shipped in PR #93. Append a "§11 — 2026-07-02 resolution" (F-3 toggle added, F-5 done). F-4 genuinely still open. |

## Priority 1 — the partner-facing headline: `POC-DEMO-DETAILED.md`

**Source:** `docs/archive/source/POC-DEMO-DETAILED.md` (v2.5). Renders to `docs/POC-DEMO-DETAILED.pdf` / `.docx` via `npm run docs:pdf` / `docs:docx` (a local build step). **Two material gaps:**

1. **Catalog (Part 3D/3E, "POC Seed Data" table).** Currently lists 5 meds (Semaglutide, Tirzepatide, Testosterone, Sermorelin, Naltrexone) and hardcodes a dollar chain ($150 wholesale → $300 total → $22.50 fee → $127.50 margin). Once the 166-product catalog loads:
   - The 5-med line becomes 79 ingredients / 166 formulations / 13 categories.
   - Semaglutide alone now has **7 formulations** at different prices — the script must name the exact card ("Semaglutide Injectable Solution, 5 mg/mL, Subcutaneous — $95 wholesale") or the presenter stalls choosing between 7 cards.
   - The wholesale price is now **$95** (not $150), so **every dollar figure in 3E→4C must be recomputed** (or reworded to "note the wholesale shown; margin follows").
   - **Testosterone cascade changes shape:** the new catalog models "Testosterone Cypionate" / "Testosterone Propionate" as separate top-level ingredients, and topical/pellet testosterone as a bare "Testosterone" with no salt form. The scripted click-path "select Testosterone → select Cypionate salt form" is no longer literally reproducible. Re-walk against the live UI and rewrite the steps.

2. **Phase C "Combine and Send" (Part 3F/3G) — missing, and the demo currently narrates the exact friction Phase C removed.** Today the script creates two Rx for the same patient+provider and says "two payment links … all from one signature," then copies one link. The live app now shows a **"Combine into one payment link"** picker + **"Combine and Copy Payment Link"** button, and patient checkout renders **"Prescription Bundle · N prescriptions."** Add a sub-part demonstrating the bundled flow; update Part 4A to the group-checkout surface and combined total. This is a bigger investor story than the current script.

**Also:** add a v2.6 version-history entry (the doc's own convention), then regenerate the PDF/DOCX, then run a fresh browser-agent walkthrough (**R9** — none exists covering Phase C or the catalog) before using it live. `POC-DEMO-QUICKSTART.pdf/.md` inherits the same staleness — quick pass after.

## Priority 1 — DEPLOYMENT.md (most factually wrong file)

- Describes a custom GitHub Actions CD pipeline (main→CI→Supabase migrate→Vercel→Slack) that is **disabled** — real deploys are Vercel's native GitHub integration; migrations are applied manually (`supabase db push`), not by CI.
- `/api/health` sample is wrong: it shows `{"status":"ok","db":"ok",…}`; actual is `{"ok":true,"timestamp":"…","version":"<sha>"}` (no DB check). Also wrong URL (`app.compoundiq.com` → `functional-medicine-infrastructure.vercel.app`).

## Priority 1 — README.md

- `Next.js 14` → **16** (contradicts its own badge). Split "CI/CD" row (CI = Actions; CD = Vercel).
- Broken links: `docs/poc-setup.md` → `docs/technical/poc-setup.md`; `docs/poc-validation-log.md` → `docs/qa-reports/poc-validation-log.md`; `docs/system-architecture.md` (missing).
- No mention of the **dual catalog** (legacy flat `catalog` + V3 hierarchical) or `npm run seed:catalog`.

## Priority 2 — technical reference docs (accuracy for future engineers)

- **technical/API-REFERENCE.md** (v1.0, Apr 5): cron table still lists removed `adapter-health-check`, missing `purge-phi-debug`; no `/api/formulations` (V3 cascade) or `/api/checkout/payment-group` (Phase C).
- **technical/erd.md** + **DATA-DICTIONARY.md** (Jun 9): missing `payment_groups`, `dispute_orders`, `adapter_submission_debug_payloads`; `orders.payment_group_id` and `patients.primary_provider_id` absent; table-count math is internally inconsistent (breakdown sums to 42, total says 33).
- **technical/POC-TESTING-GUIDE.md**: describes the old 3-step wizard (now cascading builder), old "Awaiting Payment" tab name (renamed "Pending Payment", #90), and frames checkout as **Stripe test mode** — contradicts the documented **live-keys-only** POC constraint. Reconcile.
- **ARCHITECTURE.md**: "26 tables" → now 44; no V3 catalog, Phase C, or F-3/F-5. Broken `docs/erd.md` link (→ `docs/technical/erd.md`).
- **CONTRIBUTING.md**: one broken path `docs/archive/source/technical/erd.md` → `docs/technical/erd.md`.

**Current / no action:** TROUBLESHOOTING.md, AGENTS.md, CLAUDE.md, docs/handoff/*, qa-templates/* (self-updating), CATALOG-DATA-GUIDE.md (separate legacy path), launch-kit/* (evergreen), poc-setup.md, evergreen process docs.

---

## ⚠️ Cross-cutting risk found during the audit (not a doc issue — a data issue)

The catalog seed/importer keys idempotency on **deterministic md5 UUIDs unique to the new file**, not natural keys. If the V3 catalog already contains the older 5-med hand-seed (`scripts/seed-formulations.ts`, which assigns its own different UUIDs), running the new seed will **add duplicate "Semaglutide"/"Tirzepatide"/"Testosterone"/"Sermorelin"/"Naltrexone" ingredient rows** (different PKs, same name) — so the cascade would show those meds twice. `ingredients.common_name` has no unique constraint, so it won't hard-fail; it just duplicates.

**Before running the big SQL:** check whether the V3 catalog is empty or already has the 5-med seed. If empty → clean. If it has the 5 → either clear the old V3 rows first, or accept/prune 5 duplicates. (Options: add a clean-slate preamble to the seed, or add a unique index on `ingredients.common_name` + switch the importer's `onConflict` to it. Flag for decision.)

---

## Recommended execution order

1. **P0 fixes** (STATUS.md ✓ done; phi-policy line; role-audit §11) — trivial.
2. **Resolve the seed-collision** decision before/with loading products.
3. **Demo doc rewrite** (catalog + Phase C) → regenerate PDF/DOCX → **run R9** walkthrough. Highest external value.
4. **DEPLOYMENT.md + README.md** corrections.
5. **Technical refs** (API-REFERENCE, erd, data-dictionary, POC-TESTING-GUIDE) — batch pass for engineering accuracy.
