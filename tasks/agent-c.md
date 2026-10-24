task-id: C-2026-10-24-01
status: ready
---
Branch `clinic-drawer-failure-reason` from origin/main. No migration (if one is needed, push a commit starting "BLOCKED:" explaining why and stop). Push only, no PR. Red test then fix.

When an order is in SUBMISSION_FAILED (or another failed submission state), the clinic order drawer must say why, in plain words, and what happens next. The reason already exists: the ops pipeline drawer reads it from `adapter_submissions.error_code` / `error_message` (latest failed submission for the order). Show in the clinic drawer a short line such as "Sending to <pharmacy> failed: <plain reason>. CompoundIQ ops has been alerted and will re-route or retry." Map known error codes to plain words; never show raw stack traces, internal ids or secrets; no em dashes. Read it with the clinic's own session (RLS) or a clinic-scoped server route; if RLS blocks adapter_submissions for clinic users, add a clinic-scoped API route that returns only {code, plainReason, pharmacyName, at}, guarded by getUser + app_metadata clinic_id. jest-axe on the drawer state. Lint, tsc, Jest, build green. Full report in the body of your final commit message.
