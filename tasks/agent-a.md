task-id: A-2026-10-26-02
status: ready
---
Thanks for A-2026-10-26-01 (signed-order-freeze 000010, 798508a).

Next: fix B's independent review of order-transmission-integrity (origin/review-hipaa-fixes, docs/qa/review-2026-10-26-hipaa-fixes.md, findings T1-T7). Read it first.

`git checkout order-transmission-integrity && git pull`.
1. T1 High: replace the unkeyed SHA-256 with an HMAC-SHA256 keyed by a server secret (new env var name, e.g. RX_BINDING_SECRET; read via the repo's env helper; never logged). "Legacy" (unbound) is allowed ONLY for orders signed before this deploys: decide by a fixed cutoff the code can prove (e.g. a matching batch-sign status-history row older than the binding version marker, or an explicit allowlist computed at deploy), never by "any 64-hex value". Document in the report that B4 (migration 000004) must be applied for the clinic write path to be closed, and that until then the guard + HMAC still refuse forged orders.
   If RX_BINDING_SECRET is missing in production, signing and sending must fail closed with a clear ops-facing error (and the health check should report it like the PHI secret does, name only). List the env var for Sam.
2. T2 High: bind what the pharmacy receives: destination pharmacy (compare orders.pharmacy_id with pharmacy_snapshot at send; a pharmacy change is allowed only through the ops reroute, which re-binds with an audited history row), patient name and DOB, prescriber name, DEA and license as sent. Prefer snapshots taken at signing; send from the snapshot, not live rows.
3. T3 Medium: one read of the order for both the guard and the payload.
4. T4 Medium: Tier 1 fetch with redirect: 'error' (or manual with an https re-check).
5. T5 Medium: Tier 2 browser: abort any non-https request via context.route, and check page.url() before typing anything.
6. T6 Low: an allergy edit after signing strands paid orders. Do not unfreeze; surface a clear ops failure reason and a documented path (cancel and re-prescribe). Say what the clinic sees.
7. T7 Low: portal-status-poll: https check before typing credentials.
Then `git checkout signed-order-freeze && git merge origin/order-transmission-integrity` and update the freeze's column list (shared with the binding list) so the migration 000010 covers the newly bound snapshot columns; keep the static test asserting the two lists match. Push both branches.
Tests: jest for each fix (forged hash refused, legacy only by the rule, missing secret fails closed, pharmacy mismatch refused, reroute re-binds, redirect refused, Tier 2 abort).
Gates: lint (0 warnings), tsc, jest, next build. Report in the commit bodies, including the full updated 000010 SQL.

Do not touch the production database, Vercel, Stripe or secrets.
