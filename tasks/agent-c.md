task-id: C-2026-10-25-04
status: ready
---
Thanks for C-2026-10-25-03 (lockdown v2 9611fd2, remove-dead-code 6f8eabf).

Next: page weight and speed, without changing behaviour.

Branch: `git fetch origin && git checkout -b perf-bundles origin/main`.
1. Run `next build` and record First Load JS per route (and any route over ~250 kB). Use the bundle analyzer if it can run here (@next/bundle-analyzer as a devDependency only if needed; or `next experimental-analyze` if available in 16.4) to find the biggest client modules per heavy route (dashboard, new-prescription, practice, ops pipeline, checkout, /plan/[token], intake).
2. Fix the clear wins: client components that import server-only or large libraries they barely use (date libs, chart libs on pages without charts, lucide icon barrels, recharts/react-pdf loaded eagerly), 'use client' boundaries placed too high, large static data shipped to the client, dynamic import for heavy modals and PDF/QR code paths. Never move auth, PHI handling or validation from server to client.
3. Check the patient-facing pages (checkout, /plan, intake, join) load fast on a phone: no unnecessary client JS before the first interaction.
4. Before/after table of First Load JS per route in the report. All tests green: `npm run lint` (0 warnings), tsc, Jest, build.
5. Push perf-bundles (normal push, no PR). Full report in the final commit body.

Do not touch the production database, Vercel, Stripe or secrets.
