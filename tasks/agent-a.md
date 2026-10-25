task-id: A-2026-10-25-16
status: ready
---
Thanks for A-2026-10-25-15 (prod public smoke, a03ac01). Good run.

Next: a decision brief (AI-facing; I turn it into a Word document for Sam). Several open items need Sam's decision before real patient data. Lay each out so he can decide in a minute.

Branch: `git checkout bundle-docs && git pull`. Write docs/decisions/before-real-patients-2026-10-25.md.
For each item: what exists in the code today (cite files), the options (2 or 3), the effort and risk of each, what it blocks, and a recommendation with one line of why. Read the code; do not guess.
1. Demo vs real records: there is no way to mark a clinic, pharmacy or patient as demo or real. Options (e.g. is_demo flag on clinics with inheritance; a separate prod project for demo; delete demo data at go-live) and what each means for payouts, pharmacy submissions, texting, reports and the cleanup script.
2. Two-step sign-in for all staff: name the switch, what turning it on does to existing users (enrolment flow on next sign-in), and the demo accounts.
3. Data retention: rules count but delete nothing. What would turn deletion on, what it would delete, legal hold, and the risk of turning it on with demo data.
4. Notification preferences: B's design from settings-notifications (origin/settings-notifications report): schema, effort.
5. Texting on prod (Twilio): what turning it on needs (A2P 10DLC registration, BAA, env vars by name only), and what starts sending once it is on.
6. Patient receipt email: syntax-only validation today; deliverability options.
7. Pharmacy home page: what a live pharmacy would need to see.
8. TIER_3_HYBRID: build or leave disabled.
9. GLP-1 clinical difference pre-selection (the NP asked for it; today none is pre-selected; saved statements are on clinical-difference-saved).
10. State machine: the rules B left unenforced, if any (origin/state-machine-enforcement docs/technical/state-machine-enforcement.md).
11. Who can delete saved clinical statements and favorites (any clinic role today).
12. Support contact shown in Help (D's clinic-help report).
Keep each item to about 10 lines. Push bundle-docs (normal push, no PR). Summary in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
