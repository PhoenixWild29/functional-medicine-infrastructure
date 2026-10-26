// ============================================================
// Password policy for a password a person chooses (B11)
// ============================================================
//
// Used wherever a person sets their own password: the reset page
// (/reset-password), Settings > Account "Change password", clinic and
// provider invite accept, pharmacy invite accept and self sign-up (review
// P4). passwordProblem (lib/auth/create-login) is only its first step.
//
//   - 12 to 72 bytes (passwordProblem: bcrypt's limit and the app minimum);
//   - not on a short list of the most common passwords of that length,
//     compared without case;
//   - not one character repeated;
//   - not the account's email address, or the part before the @.
//
// Hosted Supabase may also refuse a leaked password (its "leaked password
// protection" setting); that answer is passed through as a plain message.

import { passwordProblem } from './create-login'

/** The commonest passwords of 12+ characters (lowercase). Small on purpose. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password1234', 'password12345', 'password123456', 'passw0rd1234', 'p@ssword1234', 'password!234',
  'passwordpassword', '123456789012', '1234567890123', '12345678901234', '111111111111', '000000000000',
  'qwertyuiop12', 'qwertyuiopas', 'qwerty123456', 'qwertyqwerty', 'qazwsxedcrfv', '1q2w3e4r5t6y',
  'zaq12wsxcde3', 'abcdefghijkl', 'abc123456789', 'abcd12345678', 'iloveyou1234', 'letmein12345',
  'welcome12345', 'welcome123456', 'changeme1234', 'administrator', 'administrator1', 'trustno1trustno1',
  'football1234', 'baseball1234', 'sunshine1234', 'princess1234', 'dragon123456', 'monkey123456',
  'master123456', 'superman1234', 'starwars1234', 'whatever1234', 'compoundiq123', 'compoundiq1234',
  'compoundiq2026',
])

export const COMMON_PASSWORD_MESSAGE = 'That password is too common. Choose one that is harder to guess.'
export const EMAIL_PASSWORD_MESSAGE = 'Do not use your email address as your password.'
export const REPEATED_PASSWORD_MESSAGE = 'Use more than one repeated character.'

/** The problem with a new password for this account, or null. */
export function newPasswordProblem(password: string, email: string | null | undefined): string | null {
  const basic = passwordProblem(password)
  if (basic) return basic
  const lower = password.trim().toLowerCase()
  if (/^(.)\1+$/.test(lower)) return REPEATED_PASSWORD_MESSAGE
  if (COMMON_PASSWORDS.has(lower)) return COMMON_PASSWORD_MESSAGE
  const mail = (email ?? '').trim().toLowerCase()
  if (mail && (lower === mail || lower === mail.split('@')[0])) return EMAIL_PASSWORD_MESSAGE
  return null
}
