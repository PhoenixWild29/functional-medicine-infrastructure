// A demo clinic's Stripe Connect account id is a placeholder, not a Stripe
// account: "poc_placeholder" (the POC clinic, Sunrise), the per-clinic
// "poc_placeholder_<clinic_id>" an approved clinic gets on the demo payout
// path (the column is UNIQUE, so each clinic needs its own), or the demo
// seed's "acct_poc_…" ids. The payment routes skip Connect routing for the
// placeholders (isDemoPayoutPlaceholder). Settings shows all of them as
// "Demo payout account" rather than the raw id. Display only: the stored id
// is never changed, and a real account id is shown as it is.

const DEMO_ACCOUNT = /^(poc_placeholder(_.+)?$|acct_poc_)/
const PLACEHOLDER = /^poc_placeholder(_.+)?$/

/**
 * A demo payout placeholder, not a Stripe account: the exact
 * "poc_placeholder" or "poc_placeholder_<clinic_id>". Checkout and payment
 * groups create the PaymentIntent without Connect routing for it.
 */
export function isDemoPayoutPlaceholder(accountId: string | null | undefined): boolean {
  return typeof accountId === 'string' && PLACEHOLDER.test(accountId)
}

export function isDemoPayoutAccount(accountId: string | null | undefined): boolean {
  return typeof accountId === 'string' && DEMO_ACCOUNT.test(accountId)
}

export function payoutAccountLabel(accountId: string): string {
  return isDemoPayoutAccount(accountId) ? 'Demo payout account' : accountId
}
