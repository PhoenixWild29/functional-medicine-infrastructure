# Audit log review procedure

HIPAA 164.308(a)(1)(ii)(D) (information system activity review) and 164.312(b) (audit controls). This closes gap B16 in `technical-safeguards-evidence-2026-10-25.md`, together with the ops screen `/ops/access-review`.

## What is reviewed

`phi_access_log`: one row each time a signed-in user views, creates, changes, exports, prints or signs patient data. It records who (user id, role), when (UTC), which clinic, patient and order, the action, the resource and the route. It is append-only, and it is kept for 6 years (`src/lib/retention/policies.ts` never purges it).

Two known limits, tracked as gap B14:

- Some reads are not logged. Examples: browser reads that go straight to Supabase, and most ops service-role reads.
- Supabase's own logs (logins, API) are separate. Supabase keeps those.

## Who reviews

- **Reviewer:** the Security Officer (Sam, to confirm) or an ops_admin they name in writing. The reviewer must not review their own access. Another ops_admin reviews the Security Officer's rows. With only one ops_admin, those rows go to an outside reviewer each quarter.
- **Backup:** if the reviewer is away for more than one review period, the Security Officer names a backup for that period.

## How often

- **Weekly.** Each Monday, the reviewer reviews the previous 7 days. With no dates set, the screen opens on the last 7 days.
- **Also after:**
  - an emergency access (within 24 hours; see `emergency-access-procedure.md`);
  - a reported incident;
  - a user deactivation (that user's last 30 days).

## How to review

Open **Ops > Access review** (`/ops/access-review`). Only ops_admin can see it. Opening it is logged as a view of the access log. Exporting is logged as an export.

1. **Set the range.** Use the review week. One request reads up to 92 days and up to 5,000 rows. When the screen says the rows were cut off, narrow the filters.
2. **Read the flag counts, then turn on "Flagged rows only".** Each flag is a prompt to check the row, not a finding:

   | Flag | Meaning | What to check |
   |---|---|---|
   | Outside 6am to 10pm (UTC) | Access before 06:00 or from 22:00. Times are UTC because clinics have no time zone recorded yet. For a US clinic, 22:00 UTC is mid-afternoon to early evening. | Does it fit the clinic's hours and the person's role? |
   | More than 30 patients in an hour | One person viewed more than 30 different patients within 60 minutes. | Was it a list review, a batch task, or browsing? |
   | Deactivated user | The login is deactivated, or no longer exists. | Any access after the deactivation date is a finding. |
   | No order or proposal in that clinic | The patient has no order and no treatment proposal in that clinic. | A new patient being set up is normal. Otherwise, why was the record opened? |

3. **Check the ops rows.** Filter by Actor role = CompoundIQ operations. Each time ops opens an order, a second row records the reason they gave ("Reason given by CompoundIQ operations: ..."). Every **emergency** reason needs a completed post-event review (see `emergency-access-procedure.md`).
4. **Spot-check 5 unflagged rows.** Pick them from different clinics and roles, to confirm the log matches real work.
5. **Export the CSV.** Save it as evidence (see Evidence below).

## Recording the review (sign-off)

The screen has no "Mark reviewed" button yet. No existing table can hold the sign-off, and this change adds no migration. Until it exists:

- Record each review in the review log, `Compliance/Access reviews/<year>.xlsx` in the company document store (location to confirm). One row per review: period (from, to), reviewer, date reviewed, rows, flagged rows, findings (none, or the incident numbers), and the CSV file name.
- Sign-off for the week is that row, entered by the reviewer.

The design for in-app sign-off is at the end of this document.

## What to do on a finding

A finding is access with no business reason, or access by someone who should not have it.

1. **Same day:**
   - Contain the risk: deactivate the user (Settings > Team, or ops for a clinic admin) or rotate the credential.
   - Do not delete or edit log rows. The log cannot be changed anyway.
2. **Within 1 business day:** open an incident in the incident log. Record:
   - the rows (export them);
   - who was involved;
   - what was seen.
3. **Investigate:** ask the user and the clinic admin. If access was improper, the Security Officer runs the breach risk assessment in 164.402 (four factors). Breach notification follows the incident response procedure. Notice is due without unreasonable delay, and no later than 60 days after discovery.
4. **Sanctions:** the Security Officer applies the sanctions policy (164.308(a)(1)(ii)(C)) and records what was done.
5. **Fix the cause:** remove access the role does not need, train the person, or change code. Then note the fix in the incident.

## Evidence and retention

Keep all of these for **6 years** from the date of the review (164.316(b)(2)):

- each weekly review row and CSV export;
- each incident and its outcome;
- each emergency-access post-event review.

Store them in the company's document store, under `Compliance/Access reviews/`, with access limited to the Security Officer and ops_admin.

The CSV holds patient and user ids, not names, but it is still PHI-adjacent. Do not email it or put it in chat tools.

## Design: in-app sign-off (needs a migration, not built)

```sql
CREATE TABLE access_reviews (
  review_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  period_from    date        NOT NULL,
  period_to      date        NOT NULL CHECK (period_to >= period_from),
  clinic_id      uuid        NULL REFERENCES clinics(clinic_id),  -- null: all clinics
  reviewed_by    uuid        NOT NULL,                            -- auth user id (ops_admin)
  reviewed_at    timestamptz NOT NULL DEFAULT now(),
  rows_reviewed  integer     NOT NULL CHECK (rows_reviewed >= 0),
  rows_flagged   integer     NOT NULL CHECK (rows_flagged >= 0),
  outcome        text        NOT NULL CHECK (outcome IN ('no_findings', 'findings')),
  notes          text        NULL CHECK (char_length(notes) <= 2000),
  csv_sha256     text        NULL CHECK (csv_sha256 ~ '^[0-9a-f]{64}$')
);
-- Append-only, as phi_access_log: a trigger refuses UPDATE and DELETE.
-- RLS on, no policies: read and written only by the service role behind
-- the ops_admin check in /api/ops/access-review/sign-off.
-- Retention: 6 years (add to the retention policy list as never purged
-- before 6 years).
```

How the screen would use it:

- "Mark reviewed" on the range shown records one row.
- The screen lists past reviews, and warns when last week has no row.
- A second sign-off for the same period adds a row; it never changes the first.

## Related

- `emergency-access-procedure.md` (B13)
- `technical-safeguards-evidence-2026-10-25.md` (B14, B16)
- Code:
  - `src/lib/audit/access-review.ts` (flags);
  - `src/app/api/ops/access-review/route.ts`;
  - `src/app/(ops-dashboard)/ops/access-review/`.

## To confirm (Sam)

- That Sam is the Security Officer and reviewer. Name the backup and the outside reviewer.
- Where the review log and the CSVs are stored (assumed above: `Compliance/Access reviews/`).
- That the incident log, the incident response procedure and the sanctions policy exist. This document refers to them but does not write them.
