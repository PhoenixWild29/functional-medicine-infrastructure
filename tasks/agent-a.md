task-id: A-2026-10-25-09
status: ready
---
Thanks for A-2026-10-25-08 (rx-allergies-required, 92540ab).

Next: the residual you flagged in A-07. Stripe.js runs on /checkout/<jwt> and can read window.location, so the patient's payment token is visible to a third-party script.

Branch: `git fetch origin && git checkout -b checkout-token-out-of-url origin/token-pages-hardening` (builds on A-07; keep it mergeable after it).
- Get the token out of the address bar before Stripe.js loads. Preferred design: the server page for /checkout/[token] validates the token, then the client immediately does history.replaceState to /checkout (no token) and keeps the token only in memory for the POSTs to /api/checkout/payment-intent and payment-group-intent. Stripe.js is loaded only after replaceState (loadStripe called after mount, not at module scope).
- Refresh after replaceState: the patient lands on /checkout with no token. Show a neutral page: "For your security, please reopen the payment link from your text message." Do NOT store the token in localStorage, sessionStorage or a non-HttpOnly cookie. If you think a short-lived HttpOnly, SameSite=Strict, path=/checkout cookie set by the server is the better way to survive refresh, say so in the report with the trade-off; do not build it in this task.
- /checkout?token= form: same treatment.
- Confirm Sentry, analytics and any error boundary never capture the original URL (scrub or capture after replaceState).
- Payment success and expired flows unchanged.
Tests: jest for the client flow (replaceState called before loadStripe; token never written to storage). Extend the existing checkout E2E to assert the URL has no token once the payment form is visible. Never enter a card on prod; E2E uses the test environment only.
No database migrations.
Gates: lint (0 warnings), tsc, jest, next build. Push checkout-token-out-of-url (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
