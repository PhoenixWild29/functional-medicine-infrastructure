# PGlite check for migration 20261024000005 (L12)

Runs `set_clinic_member_active` against every repo migration on PGlite, with
no network and no Supabase project. PGlite is not a repo dependency, so
install it in a scratch directory outside the repo, copy these files there,
and run:

```bash
npm init -y && npm pkg set type=module && npm install @electric-sql/pglite@0.3.15
node migrate.mjs <path-to-repo> ./data
node member-ban.mjs ./data ./work
```

- `bootstrap.sql` is a minimal stand-in for Supabase's roles and its `auth`,
  `storage` and `vault` schemas.
- `migrate.mjs` applies every file in `supabase/migrations` in order.
- `member-ban.mjs` runs 15 checks. The output should end with
  `member-ban: 0 failed`.

Without 20261024000005, the same checks report `member-ban: 6 failed`.