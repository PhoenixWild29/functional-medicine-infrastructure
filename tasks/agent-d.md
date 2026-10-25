task-id: D-2026-10-25-12
status: ready
---
Thanks for D-2026-10-25-11 (what's new source, 6ab63f2).

Next: update the prod click-through checklist so it matches the code after every queued branch merges. I will use it to verify prod in the browser right after the merges.

Branch: `git checkout docs-run-sheet-v3 && git pull`, then `git merge origin/docs-prod-clickthrough` if your checklist is not already on it. Edit docs/qa/prod-clickthrough-checklist.md (rename nothing).
Read the code on these origin branches (not main): bundle-security, bundle-ci, bundle-features (B is building it from state-machine-enforcement, rx-quantity-shipping, rx-allergies-required, favorites-frequent, settings-notifications; if not pushed yet, read those five branches), and the five migration branches (ops-fax-viewer-documo, rls-user-write-lockdown-v2, security-followups-2, signup-squatting, rate-limit-db).
Add or change items for:
- Rx: allergies/NKDA prompt at Review ("Record allergies or mark NKDA before signing") and on sending a plan; quantity and unit on Review and in the order drawer; fax PDF "Quantity: 30 capsules" / "Quantity: 2 vials" (view the PDF only, do not send a fax); shipping on search cards; multi-pharmacy notice on price, review and sign pages; refills range.
- Favorites: Frequently used section and the Make favorite dialog (Practice / This patient).
- Settings > Notifications page content.
- Friendly error and not-found pages: a safe way to see each (e.g. a nonexistent URL per area), with exact text.
- Patient token pages: no token in the address bar on checkout after load (DO NOT enter a card), /plan DOB lockout text (do not lock a real link: use a throwaway demo link and say so), neutral invalid-link pages, phone width check at 390 px.
- Ops: fax viewer (view only), Hybrid tier shown disabled "Not available yet", pipeline filters.
- Anything else these branches change that a tester can see.
Keep SAFE / WRITES DATA / NEVER marks on every item. Keep the total under 90 minutes.
Push docs-run-sheet-v3 (normal push, no PR). Report in the commit body: items added/changed count.

Do not touch the production database, Vercel, Stripe or secrets.
