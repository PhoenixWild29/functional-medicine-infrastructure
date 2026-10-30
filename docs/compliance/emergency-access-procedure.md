# Emergency access (break-glass) procedure

HIPAA 164.312(a)(2)(i) and (ii) (unique user identification; emergency access procedure). This closes gap B13 in `technical-safeguards-evidence-2026-10-25.md`.

## When it applies

Use emergency access only when patient data is needed urgently and the normal path is not available. Two examples:

- A patient-safety question about an order (wrong drug, dose or patient). The clinic cannot be reached, and the order is not visible in the ops screens.
- An outage or a lockout that stops every ops_admin from signing in, while orders are in flight.

Do not use it for routine support, billing or curiosity. Those use the normal ops screens and their reasons.

## Who may invoke it

- **Any ops_admin**, for an urgent patient-safety reason on an order. They use their own named account (see "Normal ops access" below). Their own MFA-protected login is the break-glass path for order data. No shared account is used.
- **The Security Officer (Sam), or a person they authorise at that time**, for the break-glass account below. This is used only when no ops_admin can sign in.

## How

### Normal ops access, with emergency access in the app (built)

ops_admin already sees every order across clinics, through the ops pipeline. No new privilege was added for emergencies.

Since 2026-10-30 the pipeline drawer no longer asks "Why are you opening this order?" on every open (HIPAA requires recording each access, not a typed purpose). Opening an order shows it at once, and the open is logged as an order view (see "What is logged"). Emergency access stays in the app as an optional control:

1. In **Ops > Pipeline**, open the order. For an emergency, use **Emergency access** (break-glass, urgent patient safety only) under the drawer's header.
2. The order is reloaded with the emergency reason, which is logged with the access. If that cannot be recorded, the order is not shown and ops tries again.
3. The drawer then shows a notice that the access is reviewed within 24 hours.
4. The person who used it tells the Security Officer the same day. Ops is also alerted in Slack on every emergency open (see "What is logged"), so the review does not depend on that report.

### The break-glass account (when no ops_admin can sign in)

- **Account:** one named ops_admin login, `breakglass@<company domain>`, used for nothing else. Sam to create it; see "To confirm" below.
  - It has MFA (TOTP). The middleware requires a second step for ops_admin.
  - Its password is long and random, and is not known to any day-to-day user.
- **Sealed credentials:** Sam holds the password and the TOTP recovery codes, sealed. The seal is a numbered tamper-evident envelope or a password-manager vault entry that logs each open. Sam records the seal number.
- **To use it:**
  1. Ask Sam, or the person Sam has authorised, to unseal it.
  2. Sign in. Open only the orders needed, using Emergency access on each. Then sign out.
- **After use:**
  - Sam rotates the password and the TOTP secret the same day.
  - Sam reseals with a new seal number.
  - Sam records the old and new numbers.

The Supabase dashboard and the service-role key are not break-glass paths for reading PHI. They are for infrastructure recovery only, for example restoring a locked-out ops login. Their own logs are kept by Supabase.

## What is logged

Every time ops opens an order in the pipeline drawer (`GET /api/ops/orders/[orderId]/detail`), the view row below is written to `phi_access_log`. A normal open sends no reason. **Emergency access** sends the emergency reason (`x-ops-access-reason: emergency`), and the reason row is written too:

| Row | Resource | Recorded with it |
|---|---|---|
| The view | `order` | actor user id and role, time (UTC), clinic, patient, order, route, hashed IP and user agent |
| The reason | `ops_reason_<code>`, e.g. `ops_reason_emergency` | the same actor, time, clinic, patient and order |

- **Where the rows show:** the order's clinic admin sees both in Settings > Access log. The reason row reads "Reason given by CompoundIQ operations: ...". Ops sees them in Ops > Access review.
- **Missing or unknown reason:** a request without a reason is served and logged as a view. A reason not on the list is refused (400); nothing is read, and nothing is logged.
- **Emergency fails closed:** if the `ops_reason_emergency` row cannot be written, the order is not returned (503) and ops tries again. For the other reasons, a failed write is alerted (the audit-write alert) and the order is still shown, as for every other read.
- **Slack alert on every emergency open:** "Emergency (break-glass) access to a patient order", with the code `ops_reason_emergency`, the actor's role and the time. It carries no order, patient, clinic or user id; the reviewer finds the rows in Ops > Access review. A Slack failure is logged and does not block the open.
- **Scope:** no ops screen asks for a reason; the pipeline drawer offers Emergency access as an optional control. Every ops view of order-linked PHI is logged (the drawer as `order`, the inbound fax queue as `inbound_fax`).
- **Codes only:** the reason is a code, not free text. `phi_access_log` has no reason column, and this change adds no migration. A free-text note needs the design below.

## Post-event review (within 24 hours)

The Security Officer (or the named reviewer, if the Security Officer used it) completes this within 24 hours of each emergency access.

1. **Find the rows.** In Ops > Access review, set:
   - Resource = `ops_reason_emergency`;
   - the day of the access.

   Then clear the resource filter, and filter by that actor for the same window. This shows everything they opened.
2. **Confirm each record opened was needed** for the emergency. Any record that was not needed is a finding: follow "What to do on a finding" in `audit-log-review-procedure.md`.
3. **If the break-glass account was used:**
   - confirm the password and TOTP were rotated and resealed;
   - record both seal numbers.
4. **Record the review in the review log:**
   - date and time;
   - who used it, and why;
   - the orders opened;
   - the outcome;
   - the reviewer.
5. **Tell the affected clinics' admins.** Do this when their patients' records were opened, unless they asked for the access.

Keep the record for 6 years, with the weekly review evidence.

## Design: free-text reason (needs a migration, not built)

```sql
ALTER TABLE phi_access_log
  ADD COLUMN reason text NULL CHECK (char_length(reason) <= 300);
-- Append-only is unchanged (the trigger refuses UPDATE and DELETE).
-- logPhiAccess gains an optional `reason`. The ops detail route stores the
-- code and a short note in ONE row ("emergency: <note>"), replacing the
-- second ops_reason_<code> row.
-- The clinic access log shows the note to that clinic's admin. The UI
-- tells ops not to enter patient details in it.
```

## Related

- `audit-log-review-procedure.md` (B16)
- `technical-safeguards-evidence-2026-10-25.md` (B13, B14)
- Code:
  - `src/lib/audit/ops-access-reason.ts`;
  - `src/app/api/ops/orders/[orderId]/detail/route.ts`;
  - `src/app/(ops-dashboard)/ops/pipeline/_components/order-detail-drawer.tsx`.

## To confirm (Sam)

- That Sam is the Security Officer. Name the backup reviewer.
- The break-glass account's email and the seal method (envelope or vault). Create the account and enrol its TOTP. This is a production action, not done here.
- Where review evidence is stored. This document assumes `Compliance/Access reviews/` in the company document store.
