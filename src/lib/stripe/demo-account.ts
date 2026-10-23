// A demo clinic's Stripe Connect account id is a placeholder, not a Stripe
// account: "poc_placeholder" (the POC clinic; the payment routes skip
// Connect routing for it) or the demo seed's "acct_poc_…" ids. Settings
// shows those as "Demo payout account" rather than the raw id. Display
// only: the stored id is never changed, and a real account id is shown
// as it is.

const DEMO_ACCOUNT = /^(poc_placeholder$|acct_poc_)/

export function isDemoPayoutAccount(accountId: string | null | undefined): boolean {
  return typeof accountId === 'string' && DEMO_ACCOUNT.test(accountId)
}

export function payoutAccountLabel(accountId: string): string {
  return isDemoPayoutAccount(accountId) ? 'Demo payout account' : accountId
}
