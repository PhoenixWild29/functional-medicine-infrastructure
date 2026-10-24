task-id: D-2026-10-24-01
status: ready
---
DESIGN ONLY, no code, no branch changes except the report. Feature: patient-facing protocol selection (from the Sep 11 2026 meeting, deferred Sep 14): the provider proposes one or more protocols for a patient; the patient chooses which to start before paying.

Read the current code for protocols, payment groups (src/lib/payment-group), the patient checkout (/checkout) and intake links, and the Sep 11 transcript in docs/practitioner-feedback/. Then write a design report covering: (1) the provider flow (how they propose 2+ protocols to a patient, what is signed and when; nothing can be sent to a pharmacy before the patient chooses and pays); (2) the patient flow on the phone (no login, secure link like checkout, what they see, PHI rules: no medication names in SMS); (3) data model changes and whether a migration is needed; (4) how it fits payment groups and the existing checkout; (5) compliance (prescriber signs only what is dispensed; controlled substances stay blocked); (6) PR breakdown with test plan; (7) open questions for Sam, each with your recommended answer.

Push the report as `docs/design/patient-protocol-choice.md` on a new branch `design-patient-protocol-choice` from origin/main, with the summary in the commit message body. No PR.
