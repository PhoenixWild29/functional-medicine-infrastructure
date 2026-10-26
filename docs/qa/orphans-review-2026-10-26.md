# Orphans review, 2026-10-26

**Task:** C-2026-10-26-06.

**Scope:** two branches that D's branch inventory (`origin/branch-inventory`, `docs/qa/branch-inventory-2026-10-26.md`) lists with no plan:
- Dependabot PR #272;
- `request-access`.

No production database, Vercel, Stripe or secrets were touched.

## 1. Dependabot PR #272

Branch: `dependabot/npm_and_yarn/npm_and_yarn-e7c415db2f`, commit c8b0864b, on main 2696ff24.

### What it bumps

| Package | From | To | Kind |
|---|---|---|---|
| `@humanfs/node` | 0.16.7 | 0.16.8 (with `@humanfs/core` 0.19.1 → 0.19.2, and the new `@humanfs/types` 0.15.0) | indirect, dev (via eslint) |
| `js-yaml` (the copy nested under `@istanbuljs/load-nyc-config`) | 3.14.2 | 3.15.2 | indirect, dev (via jest coverage) |
| `handlebars` | 4.7.9 | 4.7.10 | indirect, dev (via ts-jest) |
| `postcss-selector-parser` | 6.1.2 | removed | indirect, dev (via tailwindcss 3) |
| **`tailwindcss`** | **^3.4.0** | **^4.3.3** (`package.json`) | **direct, dev: a major version** |

The PR title names four indirect updates. To drop `postcss-selector-parser` it also moved `tailwindcss` to v4, and it removed Tailwind 3's whole tree:
- `postcss-import`, `postcss-js`, `postcss-nested`, `sucrase`, `jiti`, `chokidar`, `fast-glob` and others;
- 32 packages out, 1 in (`@humanfs/types`).

### Why: the advisories

Source: `npm audit --package-lock-only` on main's lockfile, through npm's advisory service.

| Package | Advisories (severity, affected range) |
|---|---|
| `@humanfs/node` | GHSA-p498-v437-472g (moderate, < 0.16.8) |
| `js-yaml` 3.x | GHSA-h67p-54hq-rp68 (moderate, < 3.15.0); GHSA-52cp-r559-cp3m (high, < 3.15.0); GHSA-5p4m-2wfm-xmqj (high, < 3.15.1); GHSA-2883-xcg3-v3hh (high, < 3.15.2) |
| `handlebars` | GHSA-8r5x-fm3f-whwj (critical, 4.0.0 to 4.7.9); GHSA-p8wg-vrv2-v86f (critical, 3.0.0 to 4.7.9); GHSA-xw65-4hp5-5hc7 (moderate, 4.0.0 to 4.7.9) |
| `postcss-selector-parser` | GHSA-rj75-hqrm-r3gf (moderate, < 7.1.6); GHSA-w9m9-85wc-3x92 (low, 6.1.0 to 6.1.2) |

**All of them are dev-only.** `npm audit --omit=dev` reports **0** on main and on bundle-ci. The one production `js-yaml` is 4.3.2, which none of these advisories affect. None of these packages is loaded by the deployed app.

### Is #272 safe? No: it breaks the build

I built #272's head (`npm ci`, then `next build`). The build fails, 3 errors, for `src/app/globals.css` and the two `geist` font CSS modules:

> It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin. The PostCSS plugin has moved to a separate package…

The project is set up for Tailwind 3:
- `postcss.config.js` uses the `tailwindcss` plugin;
- `globals.css` uses `@tailwind base/components/utilities`;
- the theme is in a JS `tailwind.config.ts`.

Tailwind 4 needs `@tailwindcss/postcss`, which #272's lockfile does not contain, and CSS-first configuration. That is a migration of every stylesheet and the config, not a dependency bump. **#272 must not merge as it is.**

### What I applied on bundle-ci instead

bundle-ci already removes `handlebars`: its lockfile has no `handlebars` (remove-dead-code dropped ts-jest's tree). So bundle-ci's audit shows only `@humanfs/node`, `js-yaml` and `postcss-selector-parser`.

On bundle-ci I applied the safe part of #272: `@humanfs/node` 0.16.8 (with `@humanfs/core` 0.19.2 and `@humanfs/types` 0.15.0) and the nested `js-yaml` 3.15.2.

How the lockfile was edited:
- **Not regenerated on Windows.** I copied the four `packages` entries byte for byte from #272's lockfile, which Dependabot generated on Linux, into bundle-ci's.
- First I checked that a JSON round trip of bundle-ci's lockfile is byte-identical, so nothing else changed.
- The diff is those four entries only: 24 lines in, 10 out. The **20 `libc` markers are kept**.
- The versions fit their parents' ranges:
  - eslint wants `@humanfs/node` ^0.16.6;
  - `@istanbuljs/load-nyc-config` wants `js-yaml` ^3.13.1;
  - `@humanfs/node` 0.16.8 wants `@humanfs/core` ^0.19.2 and `@humanfs/types` ^0.15.0.
- `package.json` is unchanged.

**Pushed to bundle-ci as 028ad82e** (on a03ac017). Gates on that commit:

| Gate | Result |
|---|---|
| `npm ci` | pass; the lockfile is unchanged afterwards |
| `npm audit` | 1 left: `postcss-selector-parser` (moderate) |
| `npm run lint` (0 warnings) | pass |
| `tsc --noEmit` | pass |
| Jest | 618 suites, 6,747 tests, all pass |
| `next build` | pass |


### What is left, and a recommendation

- **`postcss-selector-parser`** (moderate and low, dev-only) stays. Fixing it means leaving Tailwind 3:
  - its fix is 7.1.6, which Tailwind 3.4 does not use;
  - an npm `overrides` entry forcing 7.x under Tailwind 3 is untested and could break the CSS build.

  It runs only at build time, over the project's own CSS. **Recommendation:** a separate work order to migrate to Tailwind 4 (`@tailwindcss/postcss`, CSS-first config, the codemod `npx @tailwindcss/upgrade`), with a visual check of the clinic, ops and patient pages.
- **#272** can be **closed once bundle-ci merges**:
  - bundle-ci carries the `@humanfs` and `js-yaml` fixes, and has no `handlebars`;
  - the Tailwind part needs that work order, not this PR.

## 2. request-access (a7f9f083)

The branch is two commits on main at d09ccd2d (#236):
- b032d7ac, a red test;
- a7f9f083, the migration.

It holds **only a migration**: `supabase/migrations/20261020000001_access_requests.sql`, with its down file and a static test. It has no route, page or ops screen; no remote branch has any `request-access` files beyond it (checked every `origin/*` branch). Only `origin/request-access` contains the commit.

### It cannot merge as it is

Its version, **20261020000001**, is already taken on main by `20261020000001_self_serve_signup.sql`. That is a duplicate migration version.

### What it would have stored, against self sign-up on main

`access_requests` was a request-only front door: no account until ops sent the existing invite. Self sign-up (`/get-started`, `src/lib/signup/self-serve.ts`, migration 20261020000001) creates the account straight away, inactive until ops approves. The comparison:

| access_requests column | Self sign-up on main |
|---|---|
| `request_type` (clinic / pharmacy) | `kind`: solo_provider, clinic or pharmacy (one more choice) |
| `organization_name` | `clinics.name` / the onboarding pharmacy's `name` |
| `contact_name` | the login's full name (`createLogin` `fullName`) |
| `work_email` | the login's email (confirmed), and the pharmacy's `email` |
| `phone` | not at sign-up; the wizard's required practice step (`lib/onboarding/practice.ts`: 10-digit US phone) and the pharmacy wizard (`pharmacies.phone`) |
| `states` | not at sign-up; the clinic address `state` and each provider's license states (solo providers enter them at sign-up); the pharmacy's `ship_to_states` and its state licenses |
| `provider_count` (clinics) | not captured as a number; the clinic adds its providers in the wizard (solo: one, at sign-up) |
| `facility_type` 503A / 503B (pharmacies) | the pharmacy wizard (`validateFacility`, `pharmacies.facility_type`) |
| `note` (free text, 1,000 characters) | **none** |
| `status` new / invited / declined, with `handled_by` and `handled_at` | clinics: `onboarding_status` plus the ops approve flow and the onboarding event log (`self_signup`, then review events). Pharmacies: the application status, and send-back with a note |
| `decline_note` | pharmacies: send-back with a note (`/api/ops/onboarding/pharmacies/[applicationId]/send-back`). **Clinics: no decline on main.** Ops deleting an unapproved self sign-up (`deleteSelfServeSignup`, `src/lib/onboarding/delete-signup.ts`) is on `signup-squatting`, queued as PR 4 in the merge order, not on main. |

### Verdict: superseded

Self sign-up replaces it. Everything `access_requests` collected is captured, at sign-up or in the required wizard steps that follow, except for these three:

1. **A free-text note** from the applicant ("tell us about your practice"). There is no equivalent.
2. **A provider count** for a clinic before it signs up. The wizard records the actual providers instead.
3. **Declining a clinic, with a note.** This arrives with `signup-squatting` (ops can delete an unapproved self sign-up), but without a stored decline note. The pharmacy side already has send-back with a note.

None of these needs `access_requests`; each would be a small change to self sign-up or the ops review if wanted. The design difference (account first, inactive until approved, instead of invite-only) is the product decision already on main.

**Recommendation:** delete `origin/request-access`. Its migration number clashes with main and its table would duplicate self sign-up. If the three items above are wanted, they belong in the self sign-up and ops review flows.
