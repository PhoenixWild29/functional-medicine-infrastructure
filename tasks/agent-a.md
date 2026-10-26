task-id: A-2026-10-26-06
status: ready
---
Thanks for A-2026-10-26-05 (mfa-gate-payment-group 35b8cd0; verify-r1 d2514db). C is applying V1/V2.

Next: a PREPARED Tailwind 4 migration, not in the merge plan. C's orphans review (origin/orphans-review) found Dependabot #272 needs Tailwind 4 to clear the last dev advisory (postcss-selector-parser), and the PR as written breaks next build.
Branch: `git fetch origin && git checkout -b tailwind4 origin/bundle-ci` (bundle-ci has the libc-safe lockfile).
- Follow Tailwind's official v3 to v4 upgrade path for Next.js: @tailwindcss/postcss plugin, CSS-first config (@import "tailwindcss", @theme) or the compatibility path that keeps tailwind.config.js via @config, and the renamed or removed utilities (shadow, ring, blur, rounded scale shifts, outline-none, etc.). Read the installed v4 docs in node_modules after install; do not guess.
- Keep the visual result identical: run the existing axe/contrast tests and take Playwright screenshots of the 10 most important pages (login, dashboard, Rx builder steps, Review, order drawer, plan page, checkout, ops pipeline, settings) before and after at 1280 and 390 widths; report any pixel differences that matter, and fix them.
- Lockfile: regenerate only in the Linux workspace or copy Linux-generated entries; keep the 20 libc markers.
- npm audit (dev included) after: report remaining advisories.
Gates: npm ci, lint (0 warnings), tsc, jest, next build. Push tailwind4 (normal push, no PR). Report in the commit body with the screenshot comparison summary. It merges only after the 13 planned PRs, if Sam agrees.

Do not touch the production database, Vercel, Stripe or secrets.
