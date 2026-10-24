# PGlite check for `2026-10-24-test-data-cleanup.sql`

Runs the cleanup script against every repo migration on PGlite, with no
network and no Supabase project. PGlite is not a repo dependency, so install
it in a scratch directory (outside the repo), copy these files there, and run:

```bash
npm init -y && npm pkg set type=module && npm install @electric-sql/pglite@0.3.15
node migrate.mjs <path-to-repo> ./data
node run.mjs ./data ./work <path-to-repo>/scripts/cleanup/2026-10-24-test-data-cleanup.sql
node refuse.mjs ./data ./work2 <path-to-repo>/scripts/cleanup/2026-10-24-test-data-cleanup.sql
```

- `bootstrap.sql`: a minimal stand-in for Supabase's roles and its `auth`,
  `storage` and `vault` schemas. Only the columns the app and the script use
  are included.
- `migrate.mjs`: applies every file in `supabase/migrations` in order. The
  `supabase_vault` extension line is skipped (`vault` is stubbed).
- `seed.sql`: copies of the prod test data, with every child table filled,
  plus the Sunrise and demo rows that must survive.
- `run.mjs`: seeds, runs the script twice, and prints the preview and
  verification. It also checks that fingerprints of Sunrise, the demo rows,
  `phi_access_log` and storage are unchanged, and that every guard trigger is
  enabled again.
- `refuse.mjs`: 12 dangerous variations of the data. Each must make the script
  raise without changing anything.

Expected output:
- `run 1: 0 mismatches`
- `run 2: 0 mismatches`
- `fingerprints: 0 changed`
- `12 refusal cases, 0 failed`
