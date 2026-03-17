import Stripe from 'stripe'
import { serverEnv } from '@/lib/env'

// Stripe Node.js SDK — server-only.
// API Version: 2024-12-18 (pinned — do not bump without auditing all webhook handlers).
// Timeout: 30s aligns with Stripe's webhook processing SLA.
//
// HIPAA: Zero PHI in Stripe metadata, descriptions, or line items.
// Only order_id, clinic_id, and amount are permitted in Stripe objects.
// Never include patient names, medication names, NPI, or clinical data.
export function createStripeClient(): Stripe {
  return new Stripe(serverEnv.stripeSecretKey(), {
    apiVersion: '2024-12-18',
    typescript: true,
    timeout: 30000,
    maxNetworkRetries: 2,
    telemetry: false, // disable Stripe telemetry
  })
}
