task-id: B-2026-10-25-11
status: ready
---
Thanks for B-2026-10-25-10 (practitioner E2E, 31bb77e).

Next: keyboard-only and screen-reader use of the clinic's core flows. axe catches markup; it does not catch a flow you cannot finish without a mouse.

Branch: `git checkout bundle-features && git pull` (you own it; add commits on top).
Walk these with keyboard only (Tab, Shift+Tab, Enter, Space, Esc, arrows) locally:
1. Rx builder: search, choose pharmacy, dose step dropdowns, price page, Review (edit a line in place, clinical difference, allergies/NKDA inline prompt), Sign all.
2. Favorites and Frequently used, Make favorite dialog (Practice / This patient).
3. Propose a plan, Copy link / Show QR dialog.
4. Order drawer open/close, tabs, failure reason.
5. Settings: Team invite dialog, Notifications page.
Check: every control reachable and operable; visible focus ring; dialogs trap focus, close on Esc and return focus to the opener; no focus lost to <body> after async updates; error and status messages announced (aria-live) without using role=alert on things that are not alerts; labels on every input; buttons with icon-only content have accessible names.
Fix what fails, keeping the visual style. Add a Playwright spec e2e/keyboard-core-flows.spec.ts that drives the Rx builder to Review and the Make favorite dialog with keyboard only (press, not click) and asserts focus return after closing dialogs. Unique locators; no getByRole('alert').
Gates: lint (0 warnings), tsc, jest, next build. Push bundle-features (normal push, no PR). Report in the commit body: each check, pass/fixed.

Do not touch the production database, Vercel, Stripe or secrets.
