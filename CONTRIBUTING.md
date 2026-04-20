# Contributing to CompoundIQ

Thanks for your interest in contributing. This document describes how to set up a local development environment, run the test suite, and submit changes.

CompoundIQ is proprietary software (see [LICENSE](LICENSE)). Unless you have been explicitly granted access as a collaborator or contractor, please do not fork, redistribute, or reuse any portion of this codebase.

---

## Prerequisites

| Tool | Minimum Version | Purpose |
|------|-----------------|---------|
| Node.js | 18.17 | Runtime for Next.js 16 + CLI scripts |
| npm | 9+ | Package manager (repo uses `package-lock.json`) |
| Supabase CLI | latest | Local database schema, migrations, type generation |
| Vercel CLI | latest (optional) | Local preview deployments + env pulls |
| Stripe CLI | latest (optional) | Local webhook event forwarding |
| Git | 2.40+ | Source control |
| pandoc | 3+ (optional) | Required only for `npm run docs:docx` |

On Windows we recommend installing via `scoop` (pandoc) and the official installers for everything else. On macOS, `brew install node supabase/tap/supabase vercel-cli stripe/stripe-cli/stripe pandoc`.

---

## One-Time Setup

1. **Clone the repo** (you must be an invited collaborator — the repo is private):

   ```bash
   git clone https://github.com/PhoenixWild29/functional-medicine-infrastructure.git
   cd functional-medicine-infrastructure
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Get environment variables.** Pull from Vercel (if you have access):

   ```bash
   npx vercel env pull .env.local --environment=development
   ```

   If you don't have Vercel access, ask a maintainer for a `.env.local` template. All keys are listed in `.env.example`. Never commit `.env.local`.

4. **Seed the local POC database** (one time, or any time you want to reset):

   ```bash
   npm run seed:poc
   ```

   This creates 4 demo users, 1 clinic, 1 patient, 1 pharmacy, and 5 catalog items. Idempotent — safe to re-run.

5. **Start the dev server:**

   ```bash
   npm run dev
   ```

   App runs at http://localhost:3000. Demo credentials are documented in `docs/POC-DEMO-DETAILED.pdf`.

---

## Daily Workflow

### Branch & Commit Conventions

- **Branch naming:** `wo-XX-short-description` for work-order-backed changes, `fix/short-description` for hotfixes, `docs/short-description` for doc-only changes.
- **Commit messages:** [Conventional Commits](https://www.conventionalcommits.org/). Examples:
  - `feat(margin): add 2.5x multiplier button`
  - `fix(checkout): resolve Apple Pay button missing on iOS Safari 17`
  - `docs: update POC-DEMO-DETAILED with Part 3D price changes`
  - `chore: bump axios for SSRF security fix`
- **PRs to `main`:** Small, focused, reviewed. No direct commits to `main` — branch protection requires at least one approving review.

### Before Opening a PR

Run the full local CI equivalent:

```bash
npm run lint        # ESLint, max-warnings 0
npm run type-check  # tsc --noEmit
npm test            # Jest unit tests
npm run build       # Next.js production build
```

If any fail, fix locally before pushing. The GitHub Actions CI workflow will re-run all 4 jobs + Playwright E2E tests on your PR and block the merge until green.

### Database Changes

All schema changes go through versioned migrations in `supabase/migrations/`.

1. Write the `.sql` migration file (format: `YYYYMMDDHHMMSS_wo-XX_description.sql`)
2. Apply locally: `npm run db:migrate`
3. Regenerate TypeScript types: `npm run db:types` (then commit the regenerated `src/types/database.types.ts`)
4. Update the ERD + Data Layer docs if the change affects the canonical schema (see `docs/archive/source/technical/erd.md`)

**Do not** modify the database via the Supabase dashboard UI — every schema change must land in a migration file so staging + production stay reproducible.

---

## Architecture Documentation

The repo ships with investor + partner-facing PDFs at `docs/` root and engineering references at `docs/technical/`. Source markdown lives in `docs/archive/source/` and renders to both PDF and DOCX via:

```bash
npm run docs:pdf    # regenerates all 10 partner-facing PDFs
npm run docs:docx   # regenerates all 15 Word docs for editing
```

When editing any doc source in `docs/archive/source/`, run both commands before committing so the rendered files stay in sync.

See `docs/SYSTEM-ARCHITECTURE-OVERVIEW.pdf` for the 10,000-ft architectural view, `docs/technical/API-REFERENCE.pdf` for the REST surface, and `docs/technical/DATA-DICTIONARY.pdf` for the full 33-table schema.

---

## Secrets & Security

**Never commit secrets.** The repo's `.gitignore` excludes `.env`, `.env.local`, `.env.*.local`, Supabase CLI secrets, and MCP config. Still, before every commit:

```bash
git diff --cached | grep -iE "(api[_-]?key|secret|password|token|sk_live_|pk_live_)"
```

If that finds anything, stop and rework the commit.

PHI handling rules:
- Zero PHI in Stripe metadata (never include medication name, diagnosis, etc.)
- Zero PHI in SMS (only first name + URL allowed per `src/lib/sms/templates.ts`)
- PHI-scrubbing on all Sentry breadcrumbs (`src/lib/sentry/phi-scrubber.ts`)
- Supabase Realtime is disabled (project setting; do not re-enable)

HIPAA compliance architecture is documented in `docs/technical/security-audit.pdf` and enforced via RLS on all 33 tables + immutable audit logs.

---

## Testing

| Test Type | Command | When to Run |
|-----------|---------|-------------|
| Unit | `npm test` | Before every commit |
| Unit w/ coverage | `npm run test:coverage` | Before opening a PR for new features |
| E2E (Playwright) | `npm run test:e2e` | Before opening a PR that touches UI |
| Type check | `npm run type-check` | Before every commit |
| Lint | `npm run lint` | Before every commit |
| Format | `npm run format:write` | Any time |

CI runs all of the above on every PR and blocks the merge on any failure.

---

## Deployment

Deployment is automated via Vercel on every push to `main`. Manual deploys:

```bash
npx vercel deploy --prod --yes   # production
npx vercel deploy                 # preview
```

Rollback to a previous deployment via the Vercel dashboard or `.github/workflows/rollback.yml`.

---

## Getting Help

- **Bugs or issues:** Open a GitHub issue with the bug label.
- **Feature questions:** Check `docs/qa-reports/` for prior QA round notes, then `docs/archive/source/technical/` for architecture references.
- **Credential drift or POC demo access issues:** Log in as ops, go to `/ops/demo-tools`, click Reset Demo Credentials. Recovery procedure documented in `docs/technical/poc-setup.pdf`.
- **Maintainer contact:** See README.md.

---

## Code Review Expectations

Reviewers will check:

1. **Correctness** — does it do what it claims to do, based on the PR description?
2. **Tests** — are new behaviors covered? Is CI green?
3. **Types** — does it compile in strict mode? Any `any` casts have a justifying comment?
4. **Documentation** — if the change affects architecture, schema, or partner-facing behavior, are the relevant docs updated?
5. **Security** — no new secrets, no PHI exposure, no RLS bypass via service role without a comment explaining why.
6. **Migration safety** — for schema changes, does the migration work for a non-empty production database? Are there irreversible steps flagged?

Approvals should not rubber-stamp. If a change raises questions about architecture or security, block the merge and discuss.
