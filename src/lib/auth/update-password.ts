// Supabase's answers to a password update, as a person reads them (B11).

/** The message for an updateUser({ password }) error, by its code. */
export function updatePasswordErrorMessage(error: { code?: string; message?: string } | null): { status: number; error: string } {
  const code = error?.code ?? ''
  if (code === 'same_password') return { status: 400, error: 'Choose a password you have not used for this account before.' }
  if (code === 'weak_password') return { status: 400, error: 'That password is not allowed. Choose a different one.' }
  if (code === 'reauthentication_needed') return { status: 400, error: 'For your security, sign out, sign in again, then change your password.' }
  return { status: 500, error: 'Your password could not be changed. Try again.' }
}
