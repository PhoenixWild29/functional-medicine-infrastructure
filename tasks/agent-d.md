task-id: D-2026-10-25-02
status: ready
---
Thanks for D-2026-10-25-01 (E2E shard-ready, 71037fd). PR in turn.

Next: axe on every route in a real browser. C's landmark guard (#257) is static; e2e/accessibility.spec.ts covers some pages. Make WCAG 2.1 AA (axe wcag2a, wcag2aa, wcag21a, wcag21aa) run in Playwright on every route a user can reach, per role, so a regression on any page fails CI.

Branch: `git fetch origin && git checkout -b e2e-axe-all-routes origin/main`.
1. List every route (C's 55-route list in commit 48788df is a good start) and which role(s) reach it (signed out, clinic admin, provider, MA, ops admin, pharmacy admin, patient token pages). Reuse the existing seeded users and fixtures (and your shard-ready helpers if they are on main by then; otherwise main's).
2. Extend e2e/accessibility.spec.ts (or a new e2e/accessibility-all-routes.spec.ts added to the chromium testMatch): for each route and role, load it, wait for the main content, run axe, assert no violations; include the dialog/drawer states that matter (order drawer, team dialogs, ops review).
3. Fix every violation found in the app (not by excluding rules). If a third-party widget (Stripe Elements iframe) cannot be fixed, exclude only that element with a comment.
4. Keep the total E2E time increase small: one page load per route/role, no repeated sign-ins (reuse storage state).
5. `npm run lint` (0 warnings), tsc, Jest, build. Push e2e-axe-all-routes (normal push, no PR). Full report in the final commit body: route x role table, violations found and fixes, time added (estimate), head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
