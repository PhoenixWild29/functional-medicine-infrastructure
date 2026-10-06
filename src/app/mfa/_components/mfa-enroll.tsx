'use client'

// ============================================================
// Two-step sign-in: set up an authenticator app (compliance C3)
// ============================================================
//
// Supabase Auth creates a TOTP factor and returns its QR code and secret;
// the user scans one or types the other into an authenticator app, then
// proves it with a code. challengeAndVerify() verifies the factor AND
// raises this session to AAL2, so the user goes straight on to where they
// were going.
//
// An earlier attempt that was never verified leaves an unverified factor
// behind; it is removed first, so a retry never trips over it.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { CodeForm, MfaCard, SignOutLink } from './mfa-shared'

interface Props {
  /** Where to continue once verified (already made safe by the page). */
  destination: string
}

type Enrollment = { factorId: string; qrCode: string; secret: string }

export function MfaEnroll({ destination }: Props) {
  const router = useRouter()
  const [supabase] = useState(() => createBrowserClient())
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const listed = await supabase.auth.mfa.listFactors()
      for (const f of listed.data?.all ?? []) {
        if (f.factor_type === 'totp' && f.status === 'unverified') {
          await supabase.auth.mfa.unenroll({ factorId: f.id })
        }
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType:   'totp',
        friendlyName: `CompoundIQ ${new Date().toISOString().slice(0, 10)}`,
      })
      if (cancelled) return
      if (enrollError || !data || data.type !== 'totp') {
        console.error('[mfa] enroll failed:', enrollError?.message ?? 'no TOTP factor returned')
        setError('Two-step sign-in could not start. Reload the page to try again.')
        return
      }
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
    })()
    return () => { cancelled = true }
  }, [supabase])

  async function verify(code: string) {
    if (!enrollment) return
    setVerifying(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code })
    setVerifying(false)
    if (verifyError) {
      setError('That code did not match. Check the time on your device and try the newest code.')
      return
    }
    router.refresh()
    router.replace(destination)
  }

  return (
    <MfaCard title="Set up two-step sign-in">
      <p className="text-sm text-muted-foreground">
        Your clinic requires a second step when you sign in. Scan this code with an authenticator
        app (Google Authenticator, 1Password, Authy or similar), then enter the 6-digit code it shows.
      </p>
      {enrollment && (
        <div className="space-y-3">
          {/* Supabase returns the QR code as an SVG data URI. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrollment.qrCode} alt="QR code for your authenticator app" className="mx-auto h-48 w-48 rounded-md border border-border bg-white p-2" />
          <div className="text-xs text-muted-foreground">
            Cannot scan it? Enter this key in the app instead:
            <code data-testid="mfa-manual-key" className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-sm text-foreground">
              {enrollment.secret}
            </code>
          </div>
          <CodeForm onSubmit={verify} busy={verifying} submitLabel="Verify and continue" />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <SignOutLink />
    </MfaCard>
  )
}
