# Webhook Secret Management — WO-18 (REQ-IEL-008)

## Secret Storage Conventions

CompoundIQ uses two secret storage mechanisms:

| Mechanism | What Goes Here | Access Pattern |
|-----------|---------------|----------------|
| **Vercel Environment Variables** | Platform-wide secrets (Stripe, Documo, Twilio) | `process.env.STRIPE_WEBHOOK_SECRET` via `serverEnv.*()` |
| **Supabase Vault** | Per-pharmacy API keys and webhook secrets | `vault.decrypted_secrets` via service_role client |

### Rule of Thumb
- **One secret per external service** → Vercel env var
- **One secret per pharmacy integration** → Supabase Vault

---

## Webhook Secrets by Source

### Stripe (`STRIPE_WEBHOOK_SECRET`)
- **Storage:** Vercel env var
- **Used in:** `src/app/api/webhooks/stripe/route.ts`
- **Validation:** `stripe.webhooks.constructEvent(rawBody, signature, secret, 300)`
- **Algorithm:** HMAC-SHA256 (Stripe SDK handles this)
- **Header:** `Stripe-Signature`
- **Rotation:** Stripe Dashboard → Developers → Webhooks → Rotate signing secret

### Documo (`DOCUMO_WEBHOOK_SECRET`)
- **Storage:** Vercel env var
- **Used in:** `src/app/api/webhooks/documo/route.ts` + `/documo/inbound/route.ts`
- **Validation:** `validateDocumoWebhook(signature, rawBody)` (HMAC-SHA256 via Web Crypto)
- **Header:** `X-Documo-Signature`
- **Rotation:** Documo Dashboard → Webhook Settings → Regenerate secret → update Vercel env var

### Twilio (`TWILIO_AUTH_TOKEN` / `TWILIO_WEBHOOK_SECRET`)
- **Storage:** Vercel env var
- **Used in:** `src/app/api/webhooks/twilio/route.ts`
- **Validation:** `validateTwilioWebhook(signature, url, params)` (HMAC-SHA1, Twilio SDK)
- **Header:** `X-Twilio-Signature`
- **Rotation:** Twilio Console → Account Settings → Auth Tokens → Rotate → update Vercel env var

### Per-Pharmacy API (`pharmacy_api_configs.webhook_secret_vault_id`)
- **Storage:** Supabase Vault (`vault.secrets`)
- **Used in:** `src/app/api/webhooks/pharmacy/[pharmacySlug]/route.ts`
- **Validation:** HMAC-SHA256 via `crypto.subtle.verify` (timing-safe)
- **Header:** `X-Webhook-Signature`
- **Insert pattern:**
  ```sql
  SELECT create_vault_secret('pharmacy_webhook_secret_{slug}', '{secret}');
  -- Returns UUID → store in pharmacy_api_configs.webhook_secret_vault_id
  ```
- **Rotation:**
  ```sql
  SELECT rotate_vault_secret('{vault_secret_id}', '{new_secret}');
  -- No UUID change — webhook handler reads new secret on next request
  ```

---

## Security Requirements

1. **Never log secrets** — secrets are read into memory only, never printed
2. **Never include secrets in API responses** — Vault access is service_role only
3. **Rotate immediately** if accidentally exposed (commit, log, response body)
4. **Use timing-safe comparison** — all HMAC verifications use `crypto.subtle.verify` or SDK verify functions, never string equality
5. **Reject unknown signatures** — return 400/403, never 200 with a silent skip

---

## Vercel Environment Variable Scopes

| Variable | Production | Preview | Development |
|----------|-----------|---------|-------------|
| `STRIPE_WEBHOOK_SECRET` | Live webhook secret | Test webhook secret | Test webhook secret |
| `DOCUMO_WEBHOOK_SECRET` | Production Documo secret | Test/staging secret | Test/staging secret |
| `TWILIO_AUTH_TOKEN` | Live Twilio auth token | Test credentials | Test credentials |
| `TWILIO_WEBHOOK_SECRET` | Live webhook secret | Test secret | Test secret |
| `CRON_SECRET` | Secure random value | Same value | Same value |

> **Critical:** Never use production (`sk_live_*`, live auth tokens) in preview or development.

---

## Vault Secret Naming Convention

```
pharmacy_api_key_{pharmacy_slug}         — API bearer token
pharmacy_webhook_secret_{pharmacy_slug}  — Webhook HMAC secret
pharmacy_portal_username_{pharmacy_slug} — Portal login username
pharmacy_portal_password_{pharmacy_slug} — Portal login password
```
