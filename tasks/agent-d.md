task-id: D-2026-10-26-11
status: ready
---
Finish D-2026-10-26-10 (runbook and what's-new refresh) first if not done.

Sam has accepted the orchestrator's recommendations in docs/decisions/before-real-patients-2026-10-25.md (origin/bundle-docs). Build the code ones now, on a new branch `decisions-oct26` from origin/bundle-hipaa (it merges into bundle-hipaa; you own both). One commit per item, red tests first:
1. Item 8: drop "Hybrid" (TIER_3_HYBRID) from the prescriber pharmacy-search labels and filters so it is never offered (it stays disabled in ops setup).
2. Item 9: fix the stale comment above STANDARD_CLINICAL_DIFFERENCE_OPTIONS ("First entry is the pre-selected default"); nothing is pre-selected.
3. Item 10: fix the portal status poll (cron/portal-status-poll): map portal text to real statuses through legal casTransition steps (no PHARMACY_READY), and leave SHIPPED tracking unenforced but show "Tracking pending" to ops when a shipped order has none.
4. Item 11: saved clinical statements and favorites can be deleted only by their creator (or the owning provider, for favorites) or a clinic admin; favorites become soft-deleted. If soft delete for favorites needs a column, do NOT migrate: report the design and implement only the permission check.
5. Item 12: NEXT_PUBLIC_SUPPORT_EMAIL env var shown in Help (and anywhere "Contact CompoundIQ" appears); when unset, keep the current generic text. Update the Help test.
6. Invite design (B's P2 from password-flows): a provider or staff user created from an invite link that an admin could have opened is forced to set a new password on first sign-in: set app_metadata.must_change_password on accept, and the middleware sends that user to /reset-password before any other page or API (API answers 403 MUST_CHANGE_PASSWORD). Clear the flag on a successful change.
Gates: npm ci, lint (0 warnings), tsc, jest, next build. Push decisions-oct26, then merge it into bundle-hipaa, gate, push. Report in the commit bodies, with the env var name for Sam.

Do not touch the production database, Vercel, Stripe or secrets.
