// ============================================================
// Creating a login: the one place, for invites and self sign-up
// ============================================================
//
// Every account is created with the service role (auth.admin.createUser):
// role, clinic and pharmacy go in app_metadata (claims.ts), never
// user_metadata, which the user could rewrite.
//
// emailConfirmed: an invite proves the address (its link was sent there),
// so invited accounts are created confirmed. A self sign-up is not, and
// "Submit for review" waits until it is (lib/signup/email-confirmed).
//
// Passwords: 12 or more characters, at most 72 bytes (bcrypt's limit).

import type { SupabaseClient } from '@supabase/supabase-js'

export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_BYTES = 72

/** The problem with a password, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return `Use at most ${MAX_PASSWORD_BYTES} characters.`
  return null
}

export type CreateLoginResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'exists' | 'weak_password' | 'failed'; message: string }

export async function createLogin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  input: { email: string; password: string; fullName: string; appMetadata: Record<string, unknown>; emailConfirmed: boolean },
): Promise<CreateLoginResult> {
  const { data, error } = await db.auth.admin.createUser({
    email:         input.email,
    password:      input.password,
    email_confirm: input.emailConfirmed,
    app_metadata:  input.appMetadata,
    user_metadata: { full_name: input.fullName },
  })
  if (error || !data?.user) {
    const message = error?.message ?? 'no user'
    const code = (error as { code?: string } | null)?.code
    if (code === 'email_exists' || /already/i.test(message)) return { ok: false, reason: 'exists', message }
    if (code === 'weak_password' || /password/i.test(message)) return { ok: false, reason: 'weak_password', message }
    return { ok: false, reason: 'failed', message: code ?? message }
  }
  return { ok: true, userId: data.user.id }
}

/** Remove a login made moments ago, after a later step failed. */
export async function removeLogin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any>,
  userId: string,
  where: string,
): Promise<void> {
  const { error } = await db.auth.admin.deleteUser(userId)
  if (error) console.error(`[${where}] CRITICAL: login not removed after a failed setup | user=${userId}: ${error.message}`)
}
