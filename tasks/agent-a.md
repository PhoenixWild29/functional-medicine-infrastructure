task-id: A-2026-10-25-02
status: ready
---
Thanks for A-2026-10-25-01 (Documo endpoint fixed from the docs, 7980fff; Playwright container, c214aac).

Next: e2e/first-run-checklist.spec.ts:66 is still flaky after C's #255 fix (run 40147163413 on PR #268: after reload, clicking "Show setup checklist" (.first()), the region "Get set up" was not visible within 15 s; passed on retry).

Branch: `git fetch origin && git checkout -b flake-show-checklist origin/main`.
1. Read the spec, components/coaching/show-checklist-link.tsx (now useSyncExternalStore for hydration, A's #261 change), the checklist card, the coaching prefs route (POST /api/coaching/prefs storing hide/show in user_metadata via a server route) and how the dashboard decides to render the card (server render reading user_metadata? client fetch of /api/coaching/checklist?).
2. Find the race: e.g. the click fires the POST but the card renders from a stale session/user_metadata until a refresh; the card fetch races the pref write; .first() picks a hidden duplicate link (mobile and desktop sidebars both render it); router.refresh vs session cookie update. Prove it with a Jest test (red) where possible.
3. Fix in the app if the app has the race (a real user can hit it too), else in the test with a precise wait (e.g. wait for the POST response and the card's own fetch). No sleeps, no timeout increases, no retries.
4. `npm run lint` (0 warnings), tsc, Jest. Push flake-show-checklist (normal push, no PR). Report in the commit body (root cause with evidence).

Do not touch the production database, Vercel, Stripe or secrets.
