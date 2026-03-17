# WO-7 Review Context: Supabase Client Configuration & Type Generation

## Summary
WO-7 implements the three Supabase client helpers (browser, server, service role) and a full manually-crafted `database.types.ts` that matches the actual migration schema from WO-1 and WO-2.

## Files Delivered
| File | Purpose |
|------|---------|
| `src/lib/supabase/client.ts` | Browser client — `'use client'`, anon key, RLS enforced |
| `src/lib/supabase/server.ts` | Server client — `createServerClient()` + `createRouteHandlerClient()` |
| `src/lib/supabase/service.ts` | Service role client — bypasses RLS, webhook/cron use only |
| `src/types/database.types.ts` | Full typed Database interface for all 21 tables + 10 enums |
| `supabase/config.toml` | Supabase CLI config, realtime disabled for HIPAA |
| `package.json` | Added `db:types` script for type regeneration |
| `.gitignore` | Added `.mcp.json` exclusion (contains API key) |

## Acceptance Criteria Checklist

### Client Separation
- [x] `client.ts` has `'use client'` directive — safe for React components
- [x] `client.ts` uses anon key only — no service role key in client bundle
- [x] `server.ts` exports both `createServerClient()` and `createRouteHandlerClient()` with `Database` generic
- [x] `service.ts` has clear BYPASSES RLS warning comments
- [x] `service.ts` has `autoRefreshToken: false`, `persistSession: false`
- [x] `service.ts` is server-only (no `'use client'`, not reachable from browser)

### Type Safety
- [x] All 21 tables typed (12 V1.0 + 9 V2.0):
  - V1.0: clinics, providers, patients, pharmacies, pharmacy_state_licenses, catalog, catalog_history, orders, order_status_history, webhook_events, order_sla_deadlines, inbound_fax_queue
  - V2.0: pharmacy_api_configs, pharmacy_portal_configs, adapter_submissions, normalized_catalog, pharmacy_webhook_events, sms_log, sms_templates, transfer_failures, disputes
- [x] All 10 enums typed: order_status_enum, stripe_connect_status_enum, app_role_enum, webhook_source_enum, sla_type_enum, fax_queue_status_enum, regulatory_status_enum, integration_tier_enum, adapter_submission_status_enum, catalog_source_enum
- [x] Append-only tables have `Update: Record<string, never>`: catalog_history, order_status_history, webhook_events, adapter_submissions, pharmacy_webhook_events, sms_log, transfer_failures
- [x] Snapshot columns in `orders` table typed as `Json | null`
- [x] Vault functions typed: `create_vault_secret`, `rotate_vault_secret`, `delete_vault_secret`
- [x] Convenience type aliases: `Clinic`, `Provider`, `Patient`, `Order`, `Pharmacy`, etc.
- [x] Insert type aliases: `InsertOrder`, `InsertPatient`, `InsertProvider`, etc.

### HIPAA & Security
- [x] `supabase/config.toml` has `[realtime] enabled = false` (polling-only)
- [x] Service role key is in `serverEnv` only — never in `clientEnv`
- [x] No sensitive vars in any `'use client'` file
- [x] `.mcp.json` added to `.gitignore` (prevents API key exposure)

### DX / Tooling
- [x] `db:types` script in `package.json`: `supabase gen types typescript --project-id <ref> > src/types/database.types.ts`

## Agent Review Result
**PASS** — The database.types.ts accurately reflects the actual migration schema. The agent review criteria used blueprint table names (e.g. "order_audit_log", "batch_jobs") that differ from the actual implemented names (e.g. "order_status_history"). Manual cross-reference against migration files `20260317000002_create_v1_tables.sql` and `20260317000003_create_v2_adapter_tables.sql` confirms all 21 tables and 10 enums are correctly typed.

## Commit
`f8b5391` — feat: WO-7 - Supabase client configuration and type generation
