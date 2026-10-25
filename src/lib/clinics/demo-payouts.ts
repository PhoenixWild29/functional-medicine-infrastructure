// ============================================================
// Ordering opens on approval: the demo payout path
// ============================================================
//
// When ops approves a clinic (invited or self sign-up) that has no Stripe
// Connect account, the approval write also gives it a demo payout
// placeholder like Sunrise's: stripe_connect_account_id
// 'poc_placeholder_<clinic_id>' (the column is UNIQUE and Sunrise holds the
// bare 'poc_placeholder', so each clinic gets its own; checkout treats both
// forms as the platform's own account, lib/stripe/demo-account) and status
// ACTIVE. A real Connect account id is never overwritten: the write is made
// conditional on there being none (NULL or empty).
//
// DEMO_PAYOUTS_ON_APPROVAL: on unless it is exactly "false", and always
// off with a live Stripe key (sk_live_ / rk_live_): checkout charges a
// placeholder clinic's patients with no Connect routing, so with live keys
// the money would stay on the platform (security review, Oct 24).
//
// Payout state lives here, with the other clinic payout checks
// (portal-clinic), so the onboarding code itself never handles Stripe
// Connect state (lib/onboarding/__tests__/no-stripe-in-onboarding).

type Db = { from: (table: string) => unknown }
type Q = {
  select: (cols: string) => Q
  eq: (col: string, v: unknown) => Q
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>
}

/** The bare placeholder Sunrise holds; an approved clinic gets this plus `_<clinic_id>`. */
export const DEMO_PAYOUT_ACCOUNT_PREFIX = 'poc_placeholder'
export const DEMO_PAYOUT_NOTE = 'Demo payout account set on approval.'

export function demoPayoutsOnApproval(): boolean {
  if (/^(sk|rk)_live_/.test(process.env['STRIPE_SECRET_KEY'] ?? '')) return false
  return process.env['DEMO_PAYOUTS_ON_APPROVAL'] !== 'false'
}

/**
 * Should this clinic's approval set the demo payout account? True when the
 * flag is on and the clinic has no Connect account (null or empty); false
 * when it has one or the flag is off; null when the clinic cannot be read.
 */
export async function needsDemoPayouts(db: Db, clinicId: string): Promise<boolean | null> {
  if (!demoPayoutsOnApproval()) return false
  const { data, error } = await (db.from('clinics') as Q).select('stripe_connect_account_id').eq('clinic_id', clinicId).maybeSingle()
  if (error) {
    console.error(`[demo-payouts] payout account could not be read | clinic=${clinicId}: ${error.message}`)
    return null
  }
  const account = (data as { stripe_connect_account_id?: string | null } | null)?.stripe_connect_account_id
  return !account || account.trim() === ''
}

/** The fields the approval write adds when needsDemoPayouts is true. */
export function demoPayoutFields(clinicId: string): { stripe_connect_account_id: string; stripe_connect_status: 'ACTIVE' } {
  return { stripe_connect_account_id: `${DEMO_PAYOUT_ACCOUNT_PREFIX}_${clinicId}`, stripe_connect_status: 'ACTIVE' }
}

/** Makes an update apply only while the clinic still has no Connect account (NULL or empty). */
export function onlyWithoutPayoutAccount<T extends { or: (filters: string) => T }>(write: T): T {
  return write.or('stripe_connect_account_id.is.null,stripe_connect_account_id.eq.')
}
