task-id: B-2026-10-26-09
status: ready
---
Thanks for B-2026-10-26-08 (three writes + dashboard bound, 1da631b). D will merge it into bundle-hipaa.

Next: verify A's fixes for D's verification of order-transmission-integrity (origin/order-transmission-integrity f4b7487; findings 1-7 in origin/verify-transmission docs/qa/verify-2026-10-26-transmission.md). You reviewed the original branch, so you know it.
For each: fixed with a test that fails before? Specifically re-run D's Chromium redirect probe (a 302/307 from the portal to another origin must not resend the form body); dev key refused on any Vercel deployment without RX_BINDING_SECRET; RX_BINDING_SECRET_PREVIOUS verifies old bindings and new bindings use the current key; RX_LEGACY_CUTOFF unset in production means no legacy; the clinic copy for T6; vault token_url https; provider_sign_and_send legacy digest compared where present. Also check nothing new opened.
Also note C's dry run 2 (origin/dry-run-2-report) items 6-9: they are combination failures between signed-order-freeze and bundle-hipaa; confirm they are as described.
Report only confirmed results. Append a section to docs/qa/verify-2026-10-26-transmission.md? No, that is D's branch: append to docs/qa/review-2026-10-26-hipaa-fixes.md on review-hipaa-fixes, push (normal push, no PR), summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
