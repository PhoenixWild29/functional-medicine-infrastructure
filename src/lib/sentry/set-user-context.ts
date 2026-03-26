import * as Sentry from '@sentry/nextjs'

// ============================================================
// Sentry User Context — WO-40
// ============================================================
//
// Sets non-PHI user context on Sentry events for error grouping
// and debugging. Call from server-side API routes and server
// components after authentication is verified.
//
// PHI Boundary: NEVER include patient names, patient IDs, NPI,
// medication names, phone, email, or any clinical data.
// Only operational identifiers permitted.

export interface SentryUserContext {
  /** Supabase auth.uid() — links error to a specific session */
  userId: string
  /** UUID of the clinic this user belongs to */
  clinicId?: string
  /** Role from JWT user_metadata.app_role */
  appRole?: string
}

/**
 * Sets user context on the current Sentry scope.
 * Call once per request after auth is verified.
 *
 * @example
 * // In a server component or API route:
 * const { data: { user } } = await supabase.auth.getUser()
 * if (user) {
 *   setSentryUserContext({
 *     userId: user.id,
 *     clinicId: user.user_metadata?.clinic_id,
 *     appRole: user.user_metadata?.app_role,
 *   })
 * }
 */
export function setSentryUserContext(ctx: SentryUserContext): void {
  Sentry.setUser({
    id: ctx.userId,
    // Non-PHI operational fields
    ...(ctx.clinicId  && { clinic_id:  ctx.clinicId  }),
    ...(ctx.appRole   && { app_role:   ctx.appRole   }),
  })
}

/**
 * Clears the Sentry user context at the end of a request.
 * Call from route teardown or error boundaries when the user
 * logs out or the request completes.
 */
export function clearSentryUserContext(): void {
  Sentry.setUser(null)
}
