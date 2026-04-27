// ============================================================
// Stripe PaymentElement options — type-check regression guard
// ============================================================
//
// WO-92: compile-time replacement for the live-Stripe-API CI smoke
// (WO-90) that's wontfix under the project constraint "Stripe live
// key only in CI; no sk_test_* provisioning." See
// project_constraint_stripe_live_key_only.md for the full rationale.
//
// Catches "the SDK doesn't expose this field" at compile time —
// the exact failure mode that broke PR #44 commit 3/3 (cast through
// `Record<string, unknown>` to bypass the type system, asserting a
// parameter that didn't exist in any Stripe API version).
//
// How this works:
//   - Imports the SDK's type for PaymentElement options.
//   - Declares a const typed with that interface, populated with the
//     parameter shapes our app actually uses.
//   - If the SDK ever stops exposing one of these fields (downgrade,
//     migration, or someone misspells a key), `tsc --noEmit` fails.
//   - `void _check` suppresses the no-unused-vars lint without
//     turning off type checking on the value itself.
//
// What this catches:
//   - SDK version downgrade that removes a field we use
//   - Typo in a field name (e.g., `wallets.lnk` instead of `link`)
//   - Removed/renamed enum values (e.g., 'never' renamed to something else)
//
// What this does NOT catch:
//   - Live API rejecting a parameter that the SDK types accept (would
//     have required WO-90's live-API smoke, which is wontfix under
//     the live-key-only constraint)
//   - Behavioral regressions inside Stripe's iframe at runtime
//
// Location matters: this file lives under `src/` to share the
// production tsconfig.json. A standalone `scripts/` dir with its own
// tsconfig would create config-drift risk where the smoke compiles
// against types that aren't what production gets. Cowork specifically
// flagged this gotcha in the Phase 0 audit review.
//
// To add a guard for a new Stripe parameter: extend the typed const
// below with the new field shape. If it compiles, the SDK exposes
// the field; if it doesn't, you need to either upgrade the SDK or
// quote the API doc URL in the PR description (per CONTRIBUTING.md
// Third-Party API Parameter Rule).

import type { StripePaymentElementOptions } from '@stripe/stripe-js'

const _stripePaymentElementOptionsCheck: StripePaymentElementOptions = {
  layout:  'tabs',
  wallets: {
    applePay:  'auto',
    googlePay: 'auto',
    link:      'never',  // WO-87 — must compile against the SDK's PaymentWalletsOption.link field
  },
}

// Suppress @typescript-eslint/no-unused-vars without disabling the
// type check itself. The value's purpose is the type assertion above;
// no runtime caller is needed.
void _stripePaymentElementOptionsCheck
