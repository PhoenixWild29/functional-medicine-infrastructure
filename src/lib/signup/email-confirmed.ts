// ============================================================
// "Submit for review" waits for a confirmed email (decision 5)
// ============================================================
//
// A self sign-up's login is created with its email not confirmed; an
// invited login is created confirmed (the invite link proved the address).
// Both submit routes (clinic and pharmacy) refuse until
// auth.users.email_confirmed_at is set, read from the verified user
// (getUser()). Everything else in the wizard still saves.
//
// The words promise no email: none is sent by CompoundIQ itself.

import { NextResponse } from 'next/server'

export const EMAIL_NOT_CONFIRMED_CODE = 'EMAIL_NOT_CONFIRMED'
export const EMAIL_NOT_CONFIRMED_MESSAGE = 'Your email address is not confirmed yet, so this cannot be submitted for review. You can keep filling in your setup. Contact CompoundIQ if you need help.'

export function emailConfirmed(user: { email_confirmed_at?: string | null } | null | undefined): boolean {
  return typeof user?.email_confirmed_at === 'string' && user.email_confirmed_at !== ''
}

/** null when the email is confirmed; otherwise the 403 to return. */
export function refuseUnlessEmailConfirmed(user: { email_confirmed_at?: string | null } | null | undefined): NextResponse | null {
  if (emailConfirmed(user)) return null
  return NextResponse.json(
    { error: EMAIL_NOT_CONFIRMED_MESSAGE, code: EMAIL_NOT_CONFIRMED_CODE },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )
}
