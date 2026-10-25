task-id: C-2026-10-25-16
status: ready
---
Thanks for C-2026-10-25-15 (clinic-help review, 8f242aa).

Next: a HIPAA Security Rule technical safeguards evidence map (AI-facing; the orchestrator turns it into a Word document for Sam). Compliance comes first in this project, and we need to show what the code actually does.

Branch: `git checkout review-high-risk && git pull`. Write docs/compliance/technical-safeguards-evidence-2026-10-25.md.
For each standard and implementation specification in 45 CFR 164.312 (access control: unique user identification, emergency access procedure, automatic logoff, encryption and decryption; audit controls; integrity and the mechanism to authenticate ePHI; person or entity authentication; transmission security: integrity controls, encryption), and the related 164.308(a)(5)(ii)(C) log-in monitoring and (D) password management:
- What the code does today on main, and what the queued branches add (name the branch; say "on main" or "queued"). Cite files and functions, tables, policies, migrations, env switches, headers. Read the code; do not trust docs.
- What depends on vendors (Supabase, Vercel, Stripe, Twilio, Documo, Sentry, Keragon, Anthropic) and therefore on a signed BAA and their configuration (encryption at rest, backups, log retention). State plainly: no BAAs are signed yet; prod holds demo data only.
- Gaps, each with: risk, the concrete fix, whether it is code (and roughly how big) or a policy/vendor action, and whether it blocks real patient data.
Include: MFA status (available, required only for pharmacy admins, one switch to require for all: name the switch), session timeout (15 min idle), access log coverage (which reads/writes of PHI are logged and which are not; check every PHI read path), RLS per table with PHI, service-role use (where the server bypasses RLS and how it scopes), backups/restore (what the repo shows), data retention (counts only, deletes nothing), breach detection/alerting (Sentry/Slack scrubbing), and encryption in transit (HSTS, TLS) and at rest (vendor).
No legal conclusions; state facts and gaps. Keep it factual and organised by citation.
Push review-high-risk (normal push, no PR). Summary in the commit body: gaps that block real patient data, one line each.

Do not touch the production database, Vercel, Stripe or secrets.
