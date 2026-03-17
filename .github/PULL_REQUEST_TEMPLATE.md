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

## Test Plan

<!-- How was this tested? -->

- [ ] Migration runs cleanly on local Supabase (`supabase db reset`)
- [ ] TypeScript types regenerated and compile clean
