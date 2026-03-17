# CompoundIQ — Functional Medicine Infrastructure

A HIPAA-compliant compounding pharmacy order management platform built on Supabase (PostgreSQL 15+) and Next.js 14.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | Supabase (PostgreSQL 15+) |
| Frontend | Next.js 14 (App Router) |
| Auth | Supabase Auth (JWT) |
| Secrets | Supabase Vault (AES-256-GCM) |
| Payments | Stripe Connect |
| Fax | Documo |
| SMS | Twilio |
| Hosting | Vercel |

## Repository Structure

```
├── supabase/
│   └── migrations/        # Versioned SQL migration files
├── src/
│   ├── app/               # Next.js App Router pages
│   ├── components/        # React components
│   ├── lib/               # Supabase client, utilities
│   └── types/             # Auto-generated database types
└── .github/
    ├── PULL_REQUEST_TEMPLATE.md
    └── ISSUE_TEMPLATE/
```

## Database Migrations

All schema changes are versioned SQL files in `/supabase/migrations/`.

```bash
# Apply migrations locally
supabase db reset

# Generate TypeScript types
supabase gen types typescript --project-id <ref> > src/types/database.types.ts
```

## Migration History

| File | Description | WO |
|------|-------------|-----|
| `20260317000001_create_enums.sql` | 10 enum types (7 V1.0 + 3 V2.0) | WO-1 |
| `20260317000002_create_v1_tables.sql` | 12 V1.0 core tables | WO-1 |
| `20260317000003_create_v2_adapter_tables.sql` | 9 V2.0 adapter & supporting tables | WO-2 |

## Development Workflow

1. Pick up a work order from the Software Factory
2. Create migration file following naming convention: `YYYYMMDDHHMMSS_description.sql`
3. Run review pass before committing
4. Push to `master` — CI validates SQL syntax
5. Update work order status in Software Factory

## HIPAA Notes

- RLS is enabled on all tables (policies in `*_rls.sql` migrations)
- PHI tables use soft deletes (`deleted_at`) — no physical DELETE on patients, providers, orders
- All pharmacy credentials stored in Supabase Vault (never in plaintext columns)
- Snapshot fields on `orders` are immutable once `locked_at` is set
