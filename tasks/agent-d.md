task-id: D-2026-10-25-08
status: ready
---
Thanks for D-2026-10-25-07 (favorites-frequent, f2c1220).

Next: the Oct 5 meeting coverage audit you could not do because the notes were not in the repo. Here they are.

Branch: `git checkout docs-requirements-coverage && git pull` (your audit branch, df950e5), then `git merge origin/main` if needed.
1. Add docs/meetings/2026-10-05-run-through.md with exactly the content between the markers below.
2. Add a section "Oct 5 run-through (Lauren Perkins, cofounder, and Anila)" to docs/qa/practitioner-requirements-coverage.md, same treatment as before (code on main, how to reach it with exact labels, tests, verdict DONE/PARTIAL/MISSING, gap) for: asks 2, 3, 4, 5, 6, 7, 9 and decisions 1, 3, 6. For decision 1 check each part separately (prescribe now and hold the order until intake is finished; license scan optional; sex collected; current meds free text). Where an item is only done on an unmerged branch, say which branch (check origin branches: e.g. ops-fax-viewer-documo, security-followups-2, signup-squatting, rate-limit-db, rls-user-write-lockdown-v2) and mark it PARTIAL (not on main).
3. Update the summary table and counts.
Push docs-requirements-coverage (normal push, no PR). Report in the commit body: counts and gaps, one line each.

--- BEGIN docs/meetings/2026-10-05-run-through.md ---
# Run-through with Lauren Perkins and Anila, 2026-10-05

Rebuilt from what Sam relayed during the meeting (no transcript). Prod version bcd935e at the start. Sam drove as Dr. Chen; the clinic admin account was also used.

## Questions and asks
1. What does "API" in the Method column mean? Answer: how the order reaches the pharmacy (API = straight into the pharmacy system with automatic status updates, Tier 1; Fax = faxed signed Rx, Tier 4; Portal and Hybrid in between).
2. Is the admin dashboard set up? Follow-up: full admin click-through.
3. The clinic admin should land on the Practice dashboard by default. Agreed.
4. How do we add patients? Follow-up: patient intake portal (zero typing for staff).
5. How do we add providers? Follow-up: Team page with invites (providers, MAs, admins) and prescriber verification.
6. How are new clinics and pharmacies added? Follow-up: clinic onboarding portal; pharmacy onboarding portal.
7. Do we connect to a clinic's existing EHR/EMR? Yes, after native intake: import plus live sync via Keragon, then a direct connector for the pilots' EHR (likely Cerbo).
8. HIPAA and compliance. Follow-up: BAAs, policies, compliance engineering items.
9. Turn on sending orders to pharmacies. Built with an on/off switch; switch on in prod (all pharmacies are demo).
10. Competitor research. Done outside the repo.

## Decisions (Sam, Oct 5 to 6)
1. Patient intake: prescribe now and hold the order until the patient finishes intake; license scan optional; collect sex; current meds free text; Keragon for EHR sync during pilots.
2. EHR integration: yes, after native intake.
3. Clinic admin lands on Practice.
4. Documents versioned; prompts only in chat.
5. Orchestrator plans, reviews, merges and verifies; agents build in parallel.
6. All pharmacies, clinics and patients on prod are demo; pharmacy submissions on.
7. Everything built stays compliant; compliance engineering goes first in the queue.

## Not yet answered
- Which EHR do the pilot clinics use (decides the first direct connector)?
- Weekly dosing for 90 days: 12 or 13 doses?
- Revenue model and markup (healthcare counsel).
--- END ---

Do not touch the production database, Vercel, Stripe or secrets.
