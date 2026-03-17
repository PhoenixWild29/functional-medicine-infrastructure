# WO-4 Review Context — Supabase Vault Configuration for Credentials

## Work Order Summary

**WO:** 4
**Title:** Supabase Vault Configuration for Credentials
**Status:** in_review
**Phase:** 1
**Assignee:** Samuel Shamber

## Files Created

| File | Description |
|------|-------------|
| `supabase/migrations/20260317000005_vault_setup.sql` | Vault helper functions (service_role only) |
| `supabase/seed.sql` | Local dev test seed data — gitignored, never in production |
| `docs/vault-credential-guide.md` | Credential insertion, retrieval, rotation documentation |

## Dependencies
Requires WO-1, WO-2, WO-3 migrations to run first.

## Scope

### In Scope
- `create_vault_secret()` helper function
- `rotate_vault_secret()` helper function
- `delete_vault_secret()` helper function
- Test seed data for 8 pharmacies (3 Tier 1, 2 Tier 2, 1 Tier 3, 2 Tier 4)
- Credential architecture documentation

### Out of Scope
- Production credential insertion (manual ops process)
- Application-level Vault query code (adapter work orders)
- Credential rotation automation

## Acceptance Criteria Checklist

### Helper Functions
- [ ] `create_vault_secret(name, secret)` inserts into `vault.secrets` and returns UUID
- [ ] `rotate_vault_secret(id, new_secret)` updates existing secret by UUID
- [ ] `delete_vault_secret(id)` hard-deletes by UUID with NOT FOUND error handling
- [ ] All three functions marked `SECURITY DEFINER`
- [ ] All three functions have `SET search_path = vault, public`
- [ ] `REVOKE ALL` on all three functions from `PUBLIC`
- [ ] `REVOKE ALL` on all three functions from `authenticated`

### Seed Data (Local Dev Only)
- [ ] seed.sql is marked LOCAL DEVELOPMENT ONLY at the top
- [ ] All credentials use `TEST_*_PLACEHOLDER` or `.placeholder.com` values
- [ ] 3 Tier 1 pharmacies with `pharmacy_api_configs` entries
- [ ] 2 Tier 2 pharmacies with `pharmacy_portal_configs` entries
- [ ] 1 Tier 3 (hybrid) pharmacy with both API and portal configs
- [ ] 2 Tier 4 (fax-only) pharmacies — no vault entries needed
- [ ] All DO blocks capture vault UUID before inserting into config tables
- [ ] All 4 vault reference columns used: `vault_secret_id`, `webhook_secret_vault_id`, `username_vault_id`, `password_vault_id`

### Documentation
- [ ] Insertion pattern documented (INSERT INTO vault.secrets + RETURNING id)
- [ ] Retrieval pattern documented (SELECT from vault.decrypted_secrets)
- [ ] Rotation pattern documented (rotate_vault_secret — UUID stays the same)
- [ ] Naming convention documented ({pharmacy-slug}/{credential-type})
- [ ] Credential types per tier documented
- [ ] Security rules documented (never log, never return in response, service_role only)

## Agent Review Result
**PASS** — All 10 checks passed on first review. No fixes required.

## How to Review with Cowork

1. Open Claude Cowork and connect to the `Functional Medicine` folder
2. Ask Cowork to read this file plus the three files listed above
3. Work through every checkbox in the acceptance criteria
4. If all items pass, mark WO-4 as `completed` in the Software Factory
