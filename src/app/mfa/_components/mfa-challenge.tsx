'use client'

// ============================================================
// Two-step sign-in: the code on every new sign-in (compliance C3)
// ============================================================
//
// The user's verified TOTP factor is challenged and verified in one call;
// success raises the session to AAL2 and the user continues. Someone with
// no verified factor (removed, or never finished) is sent to set one up.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { CodeForm, MfaCard, SignOutLink } from './mfa-shared'

interface Props {
  /** Where to continue once verified (already made safe by the page). */
  destination: string
}

export function MfaChallenge({ destination }: Props) {
  const router = useRouter()
  const [supabase] = useState(() => createBrowserClient())
  const [factorId, setFactorId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      if (listError) {
        console.error('[mfa] listFactors failed:', listError.message)
        setError('Your sign-in could not be checked. Reload the page to try again.')
        return
      }
      const factor = (data?.totp ?? []).find(f => f.status === 'verified')
      if (!factor) {
        router.replace(`/mfa/enroll?redirectTo=${encodeURIComponent(destination)}`)
        return
      }
      setFactorId(factor.id)
    })()
    return () => { cancelled = true }
  }, [supabase, router, destination])

  async function verify(code: string) {
    if (!factorId) return
    setVerifying(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
    setVerifying(false)
    if (verifyError) {
      setError('That code did not match. Check the time on your device and try the newest code.')
      return
    }
    router.refresh()
    router.replace(destination)
  }

  return (
    <MfaCard title="Two-step sign-in">
      <p className="text-sm text-muted-foreground">
        Enter the 6-digit code from your authenticator app to finish signing in.
      </p>
      {factorId && <CodeForm onSubmit={verify} busy={verifying} submitLabel="Verify" />}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <SignOutLink />
    </MfaCard>
  )
}
