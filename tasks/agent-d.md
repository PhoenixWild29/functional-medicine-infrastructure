task-id: D-2026-10-26-12
status: ready
---
Merge day has started: #271 (fax) is merged (main eb36332). #273 (lockdown v2) was brought up to date by the orchestrator (bd0b2aa + GitHub branch update); nothing to do there.

You are the merge steward for the rest of the plan: when the orchestrator opens the next PR and it conflicts, a line will appear here (or a new task id). Do it before anything else.

Now: build the decisions code (from D-2026-10-26-11), on a new branch `decisions-oct26` from origin/bundle-hipaa, one commit per item, red tests first:
1. Item 8: drop "Hybrid" (TIER_3_HYBRID) from the prescriber pharmacy-search labels and filters (it stays disabled in ops setup).
2. Item 9: fix the stale comment above STANDARD_CLINICAL_DIFFERENCE_OPTIONS; nothing is pre-selected.
3. Item 10: portal status poll (cron/portal-status-poll): map portal text to real statuses through legal casTransition steps (no PHARMACY_READY); leave SHIPPED tracking unenforced but show "Tracking pending" to ops when a shipped order has none.
4. Item 11: saved clinical statements and favorites deletable only by their creator (or the owning provider, for favorites) or a clinic admin; soft-delete favorites only if no migration is needed (else report the design and implement only the permission check).
5. Item 12: NEXT_PUBLIC_SUPPORT_EMAIL shown in Help (and wherever "Contact CompoundIQ" appears); unset keeps the generic text.
6. Invite: users created from an invite link get app_metadata.must_change_password on accept; the middleware sends them to /reset-password before any other page (API: 403 MUST_CHANGE_PASSWORD); the flag clears on a successful change.
Gates: npm ci, lint (0 warnings), tsc, jest, next build. Push decisions-oct26, then merge it into bundle-hipaa, gate, push. Report in the commit bodies, with the env var name for Sam.

Do not touch the production database, Vercel, Stripe or secrets.
