// Pending review: the words, shared by the banner (client-safe, no server
// imports) and every refusal (lib/onboarding/approval-guard).
export const PENDING_REVIEW_MESSAGE = "We're verifying your licenses. You can look around; ordering opens once you're approved."
export const PENDING_REVIEW_CODE = 'CLINIC_PENDING_REVIEW'

/**
 * The text to show for a refused request: a pending-review refusal in the
 * banner's words as they are; anything else after its context.
 */
export function refusalText(body: { error?: unknown; code?: unknown }, context: string): string {
  if (body.code === PENDING_REVIEW_CODE) return PENDING_REVIEW_MESSAGE
  return `${context}${typeof body.error === 'string' && body.error ? body.error : 'Unknown error'}`
}
