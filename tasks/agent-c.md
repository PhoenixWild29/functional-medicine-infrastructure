task-id: C-2026-10-23-02
status: ready
---
If Sam already pasted this exact task to you, do not redo it: finish it if unfinished, otherwise just mark the task-id done.

Continue on `lauren-polish-oct23`. No migration. Push only. Red test then fix per item.

1. Settings > Clinic Profile gets the onboarding wizard's practice details: legal name, DBA, address lines 1 and 2, city, state, ZIP, phone, practice NPI (Type 2, optional), tax ID last 4. Same fields, validation and API as the wizard step. Clinic admin edits; providers and MAs read-only.
2. Checklist: for approved clinics, "Enter your practice details" links to that section and ticks done from the same data as the wizard step.
3. Selected-patient card: restore a visible separator between the chips and "TX, DOB: ...".
4. jest-axe on changed views. Lint, tsc, Jest, build green. Put your full report (head SHA, Jest count) in the body of your final commit message and push.
