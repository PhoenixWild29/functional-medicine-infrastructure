// ============================================================
// Provider review copy (ops onboarding)
// ============================================================
//
// The labels and messages of the provider review, with no imports, so the
// ops onboarding client component can use them without pulling in
// provider-review.ts's server code (its ./tokens import is node:crypto,
// which would ship crypto polyfills to the browser).

export const ACCOUNT_HOLDER_LABEL = 'Account holder (signed up on their own)'
export const LICENSE_CHECK_LABEL = 'I checked this provider’s license with the state board'
export const LICENSE_CHECK_REQUIRED_MESSAGE = 'A provider’s NPI is not verified in the national registry. Check their license with the state board and confirm it before approving.'

export function unverifiedWarning(name: string): string {
  return `${name}’s NPI was not found in the national registry. Check their license with the state board before approving.`
}

/** The approval event's note when ops approved with unverified providers. */
export function licenseCheckNote(names: ReadonlyArray<string>): string {
  return `Ops confirmed: ${LICENSE_CHECK_LABEL}. NPI not verified in the national registry for: ${names.join(', ')}.`
}
