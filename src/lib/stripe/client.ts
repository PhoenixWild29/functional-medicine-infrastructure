import Stripe from 'stripe'
import { serverEnv } from '@/lib/env'
import { withPhiGuard } from './phi-guard'

// Stripe Node.js SDK — server-only.
// API Version: 2023-10-16 (pinned — do not bump without auditing all webhook handlers).
// Timeout: 30s aligns with Stripe's webhook processing SLA.
//
// HIPAA / C7: Stripe signs no BAA, so zero PHI in anything we send it.
// Every write goes through the PHI guard (./phi-guard.ts): metadata holds
// only opaque ids, descriptions are neutral, and each call may send only
// its allow-listed fields. This is the only place the SDK is constructed
// (src/__tests__/stripe-phi-static-guard.test.ts).
export function createStripeClient(): Stripe {
  return withPhiGuard(new Stripe(serverEnv.stripeSecretKey(), {
    apiVersion: '2023-10-16',
    typescript: true,
    timeout: 30000,
    maxNetworkRetries: 2,
    telemetry: false, // disable Stripe telemetry
  }))
}
