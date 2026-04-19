# CompoundIQ — Documentation

## Partner-facing PDFs (this folder)

| File | Purpose |
|------|---------|
| `INVESTMENT-STRATEGY-MEMO.pdf` | Investor pitch + strategy memo |
| `POC-DEMO-DETAILED.pdf` | Step-by-step demo walkthrough (validated through 6 rounds of QA) |
| `POC-DEMO-QUICKSTART.pdf` | 2-page cheat sheet for live demos |
| `COMPOUNDIQ-EXECUTIVE-OVERVIEW.pdf` | Non-technical overview for non-technical audiences |
| `SYSTEM-ARCHITECTURE-OVERVIEW.pdf` | Technical architecture overview |
| `PHARMACY-INTEGRATION-GUIDE.pdf` | For pharmacy partners — API specs, webhooks, onboarding |
| `CLINIC-ONBOARDING-PLAYBOOK.pdf` | Internal playbook for onboarding design partner clinics |
| `BUSINESS-ACTION-PLAN.pdf` | LegitScript + catalog data + compliance parallel tracks |
| `pre-launch-checklist.pdf` | 29-item checklist tracking every non-product task before first real order (entity, BAAs, marketing site, insurance, LegitScript, etc.) |
| `mobile-validation-test-plan.pdf` | 30-min mobile QA test plan for iOS Safari + Android Chrome (patient checkout + Apple/Google Pay flows) |

## Subfolders

- **`launch-kit/`** — Word docs you actively use: clinic/pharmacy outreach email templates, LegitScript application checklist, Design Partner LOI, pre-launch checklist
- **`qa-reports/`** — Historical QA validation reports (Rounds 1-6 + phase-specific)
- **`research/`** — Deep research on compounding pharmacy UX, data models, regulatory landscape
- **`software-factory-updates/`** — 8090.ai Refinery/Foundry document exports
- **`technical/`** — Engineering references (API, data dictionary, ERD, runbooks)
- **`archive/`** — Markdown source files + prior PDF versions (source of truth for regeneration)

## Regenerating PDFs and Word Docs

After editing any `.md` source in `docs/archive/source/`:

```bash
npm run docs:pdf    # regenerates all 10 PDFs (8 investor/demo + 2 launch-kit)
npm run docs:docx   # regenerates all 15 Word docs (launch-kit + archived copies)
```

Requires pandoc for DOCX (`scoop install pandoc` on Windows).

## Live App

https://functional-medicine-infrastructure.vercel.app

Demo credentials are in `POC-DEMO-DETAILED.pdf`.
