task-id: D-2026-10-25-04
status: ready
---
Thanks for D-2026-10-25-03 (axe-all-routes, shard-ready, proxy updated).

Next: a click-through checklist so the orchestrator can verify prod in a browser quickly and completely (AI-facing; Markdown is right).

Branch: `git fetch origin && git checkout -b docs-prod-clickthrough origin/main`.
Write docs/qa/prod-clickthrough-checklist.md, generated from the code on main (read the pages and routes; do not guess):
- For each role: clinic admin (Sunrise: admin@sunrise-clinic.com), provider, MA, ops admin, pharmacy admin, patient (token pages): every page in the sidebar/nav, every button and link on it, every tab, drawer, dialog and form, in a sensible click order.
- For each item: what to click, what must appear (exact visible text where stable: headings, button labels, notices, empty states), and what must NOT happen.
- Mark each item SAFE (read-only) or WRITES DATA (creates/changes prod rows) or NEVER (must not be pressed on prod: entering a card at checkout (Stripe is live), Reset Credentials on /ops/demo-tools, Re-run NPI check on demo providers, anything that sends real SMS/fax/email, Approve on a real clinic).
- Include the features merged Oct 14 to 25: self-serve sign-up and approval, team invites/deactivate, protocol create without a patient, setup checklist and tips, sign-up link/QR, practice details in Settings, submitted banner, failure reason in the order drawer, 4 MB upload limits, demo payout label, ops pipeline filters (tier, chips, URL), patient protocol choice (provider proposes, Copy link/QR, /plan/<token> DOB, choose, provider signs, Proposed tab), face-sheet hidden without a key, fax viewer (if merged), ops approval license check.
- Where demo data is needed (Sunrise demo orders DEMO-1001..1015, DEMO-1011 failed), say which order to open.
- Keep it to what a careful tester can do in about 60 to 90 minutes; group by role.
Push docs-prod-clickthrough (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
