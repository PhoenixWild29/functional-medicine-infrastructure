task-id: A-2026-10-25-03
status: ready
---
Thanks for A-2026-10-25-02 (show-checklist race fixed in the app, cde04e5).

Next: bring the developer docs up to date with everything from Oct 14 to 25. These are AI- and developer-facing (repo files), so Markdown is right.

Branch: `git fetch origin && git checkout -b docs-oct25 origin/main`.
Update CLAUDE.md, ARCHITECTURE.md, TROUBLESHOOTING.md, DEPLOYMENT.md and README.md (and docs/ where a doc already covers the area) for, at least: Next 16.4.3 + React 19 + eslint-config-next 16.4.3 and `--max-warnings=0`; the proxy rename pending (#266; describe middleware.ts as current until it merges); E2E now PR-only + nightly, docs-only skip, one shared E2E DB and the migration-order rule (a migration PR must merge before any other PR runs E2E, because the shared E2E DB gets the migration on first run); the orchestrator-tasks queue and agent loop (what agents may and may not do: no prod DB, Vercel, Stripe, secrets; report in commit body; BLOCKED commits); self-serve sign-up + approval guard; team invites/deactivate; demo payouts on approval (and that H1 is pending); face-sheet hidden without a key; submission failure reason; upload 4 MB limit; patient sign-up link; protocol create; patient protocol choice (#268, if merged by then; otherwise as pending); security review outcomes (C1 lockdown, same-origin helper, sniffing, PHI log on duplicates) and what is still open (L5 v2, L7, M2 email confirm, zod done); the test-data cleanup script (Sam runs after Lauren's review); the prod SQL handoff rule (Sam runs all prod SQL, migration before merge).
Keep each doc accurate to the code on main: read the code, do not copy from task text. Remove statements that are now false.
`npm run lint` (0 warnings) if any code-adjacent file changes; push docs-oct25 (normal push, no PR). Report in the commit body: files and sections changed.

Do not touch the production database, Vercel, Stripe or secrets.
