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
