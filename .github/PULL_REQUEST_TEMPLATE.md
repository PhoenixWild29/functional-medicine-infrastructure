## Work Order

**WO-#:** <!-- Link to work order e.g. WO-5 -->
**Type:** <!-- build | fix | blueprint | other -->

## Summary

<!-- What does this PR do? 1-3 bullet points -->

-

## Changes

<!-- List files changed and why -->

-

## Migration Notes

<!-- If this includes a DB migration, note any risks, dependencies, or rollback steps -->

- [ ] Migration is idempotent / safe to re-run
- [ ] No breaking changes to existing columns
- [ ] RLS policies updated if new tables added

## HIPAA Checklist

- [ ] No PHI in logs, comments, or test fixtures
- [ ] Soft deletes used on PHI tables (no hard DELETE)
- [ ] Vault used for any new credentials (no plaintext secrets)
- [ ] RLS enabled on any new tables

## Third-Party API Parameters

Required for Stripe, Supabase, Twilio, Documo, and any other external service.

- [ ] **N/A** — this PR does not add a new third-party API parameter, OR
- [ ] The new parameter IS exposed in the SDK's TypeScript types (no cast required), OR
- [ ] The parameter is NOT exposed in the SDK types and **I have pasted the API doc URL + quoted the parameter name and accepted values in the PR description below**, AND I have either upgraded the SDK to a version that exposes the field natively OR added a live test-mode CI smoke that confirms the live API accepts the parameter.

> Why this matters: PR #44 commit 3/3 added a Stripe parameter via `as Record<string, unknown>` cast based on confidence-without-citation. Live API rejected it; CI E2E broke. See [CONTRIBUTING.md](../CONTRIBUTING.md#third-party-api-parameter-rule) for the full rule.

**API doc URL + quoted parameter (if applicable):**

<!-- Paste the link to the third-party API docs and the relevant parameter text quote here. -->

## Test Plan

<!-- How was this tested? -->

- [ ] Migration runs cleanly on local Supabase (`supabase db reset`)
- [ ] TypeScript types regenerated and compile clean
