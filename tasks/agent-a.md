task-id: A-2026-10-26-03
status: ready
---
Thanks for A-2026-10-26-02 (T1-T7, e2d293e; freeze merge 495441f). D verified it independently (origin/verify-transmission, docs/qa/verify-2026-10-26-transmission.md). Finish the freeze column update if not done, then fix D's findings on order-transmission-integrity, and re-merge into signed-order-freeze:
1. T5/T7 confirmed gap: Playwright context.route does not see redirect hops; Chromium followed a 302/307 and resent a PHI POST to a blocked origin. Use route.fetch({ maxRedirects: 0 }) with a Location https check (or equivalent), and add D's Chromium redirect probe as a real test.
2. The public development key is used silently whenever VERCEL_ENV is not production. Only allow the dev key when NODE_ENV is test or development AND not on any Vercel deployment; any Vercel deployment (preview included) without RX_BINDING_SECRET fails closed.
3. Key rotation strands signed-unsent orders. Support RX_BINDING_SECRET_PREVIOUS (optional) for verification only; new bindings always use the current key. Document rotation steps in docs/ops.
4. LEGACY_SIGNING_CUTOFF hard-coded: read from env (RX_LEGACY_CUTOFF, ISO date) with a safe default of "no legacy" if unset in production, and document that Sam sets it to the deploy time of this code.
5. T6 copy: tell the clinic CompoundIQ will cancel and refund (ops cancel_refund), not that they should cancel.
6. vault token_url: https check.
7. provider_sign_and_send legacy digest not compared: compare it where the row has one; leave as is only where it truly has none and say why.
Also confirm the migration numbering: D reports 20261024000011 is new on this branch. List every migration on order-transmission-integrity and signed-order-freeze with numbers; they must sort after 000010 and ship together in the signed-order-freeze PR (bundle-hipaa will NOT include order-transmission-integrity because it carries a migration).
Tests for each. Gates: lint (0 warnings), tsc, jest, next build. Push both branches. Report in the commit bodies, with the full SQL of every migration on signed-order-freeze, and the env vars (names only) Sam must set: RX_BINDING_SECRET, RX_LEGACY_CUTOFF, optional RX_BINDING_SECRET_PREVIOUS.

Do not touch the production database, Vercel, Stripe or secrets.
