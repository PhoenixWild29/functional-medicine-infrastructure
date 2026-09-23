'use client'

// ============================================================
// WO-86: EPCS TOTP Verification Gate
// ============================================================
//
// Modal that requires TOTP 2FA before signing controlled substances.
// DEA 21 CFR 1311 requires 2FA at the point of signing.
//
// Flow:
// 1. If provider has TOTP set up → show code entry
// 2. If not → show QR code setup, then code entry
// 3. On valid code → call onVerified(code) to proceed with signing
//
// WO-99: the code is handed to the caller, which sends it with the signing
// request. The server checks it again there (lib/epcs/totp) — this modal
// is the provider's feedback, not the gate.

import { useState, useEffect, useRef } from 'react'

interface EpcsTotpGateProps {
  providerId: string
  providerName: string
  medicationNames: string[]
  deaSchedules: (number | null)[]
  /** Called with the code the provider entered; the signing request carries it. */
  onVerified: (code: string) => void
  onCancel: () => void
}

export function EpcsTotpGate({
  providerId,
  providerName,
  medicationNames,
  deaSchedules,
  onVerified,
  onCancel,
}: EpcsTotpGateProps) {
  const [step, setStep] = useState<'loading' | 'setup' | 'verify' | 'status_error'>('loading')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Check if provider already has TOTP set up
  useEffect(() => {
    // Batch 1, finding 6: there was no res.ok check here, so any failure
    // read as "not enrolled" and fell through to action=setup — which
    // replaced the provider's TOTP secret and broke the authenticator
    // they were about to sign with. Enrolment now happens only when the
    // server actually says they are not enrolled.
    async function checkStatus() {
      try {
        const res = await fetch(`/api/epcs?action=status&provider_id=${providerId}`)
        if (!res.ok) {
          console.error('[epcs] status check failed:', res.status, '| provider=', providerId)
          setStep('status_error')
          return
        }
        const data = await res.json() as { totp_enabled?: boolean }
        if (data.totp_enabled === true) {
          setStep('verify')
          return
        }
        if (data.totp_enabled !== false) {
          console.error('[epcs] status check returned no enrolment state | provider=', providerId)
          setStep('status_error')
          return
        }

        const setupRes = await fetch('/api/epcs?action=setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider_id: providerId }),
        })
        if (!setupRes.ok) {
          console.error('[epcs] enrolment failed:', setupRes.status, '| provider=', providerId)
          setStep('status_error')
          return
        }
        const setupData = await setupRes.json() as { qr_code?: string; secret?: string }
        if (!setupData.qr_code) {
          console.error('[epcs] enrolment returned no QR code | provider=', providerId)
          setStep('status_error')
          return
        }
        setQrCode(setupData.qr_code)
        setSecret(setupData.secret ?? '')
        setStep('setup')
      } catch (err) {
        console.error('[epcs] status check failed:', err instanceof Error ? err.message : err, '| provider=', providerId)
        setStep('status_error')
      }
    }
    void checkStatus()
  }, [providerId])

  // Auto-focus code input
  useEffect(() => {
    if ((step === 'verify' || step === 'setup') && inputRef.current) {
      inputRef.current.focus()
    }
  }, [step])

  async function handleVerify() {
    if (code.length !== 6) {
      setError('Enter a 6-digit code')
      return
    }
    setVerifying(true)
    setError('')

    // Log TOTP challenge
    await fetch('/api/epcs?action=audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider_id: providerId,
        event_type: 'TOTP_CHALLENGE_SENT',
        dea_schedule: deaSchedules.find(s => s && s >= 2) ?? 3,
        medication_name: medicationNames.join(', '),
      }),
    }).catch(() => {})

    const res = await fetch('/api/epcs?action=verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider_id: providerId, code }),
    })

    const data = await res.json()
    setVerifying(false)

    if (data.verified) {
      // Log successful verification
      await fetch('/api/epcs?action=audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: providerId,
          event_type: 'TOTP_VERIFIED',
          dea_schedule: deaSchedules.find(s => s && s >= 2) ?? 3,
          medication_name: medicationNames.join(', '),
        }),
      }).catch(() => {})

      onVerified(code)
    } else {
      // Log failed attempt
      await fetch('/api/epcs?action=audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: providerId,
          event_type: 'TOTP_FAILED',
          dea_schedule: deaSchedules.find(s => s && s >= 2) ?? 3,
          medication_name: medicationNames.join(', '),
        }),
      }).catch(() => {})

      setError('Invalid code. Please try again.')
      setCode('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/20">
          <p className="text-sm font-semibold text-red-800 dark:text-red-200">
            EPCS Two-Factor Authentication Required
          </p>
          <p className="mt-1 text-xs text-red-700 dark:text-red-300">
            DEA 21 CFR 1311 — Controlled substance prescription requires two-factor authentication
            at the point of signing.
          </p>
        </div>

        {/* Controlled substance list */}
        <div className="mb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Controlled Substances in This Prescription
          </p>
          <ul className="mt-1 space-y-0.5">
            {medicationNames.map((name, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-foreground">
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                  Schedule {deaSchedules[i] ?? 'III'}
                </span>
                {name}
              </li>
            ))}
          </ul>
        </div>

        <p className="mb-4 text-sm text-foreground">
          Signing as <strong>{providerName}</strong>
        </p>

        {/* The check could not run — never silently enrol over an
            existing authenticator (Batch 1, finding 6). */}
        {step === 'status_error' && (
          <div role="alert" data-testid="epcs-status-error" className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/20">
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">
              Authenticator status could not be checked.
            </p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-300">
              Nothing has been changed and your authenticator is untouched. Close this and try again; if it
              persists, report it rather than re-enrolling.
            </p>
          </div>
        )}

        {/* Loading */}
        {step === 'loading' && (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">Checking authenticator status...</p>
          </div>
        )}

        {/* Setup: Show QR code */}
        {step === 'setup' && (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, or similar):
            </p>
            {qrCode && (
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrCode} alt="TOTP QR Code" className="h-48 w-48 rounded-md border" />
              </div>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Manual entry code</summary>
              <code className="mt-1 block rounded bg-muted p-2 font-mono text-xs break-all">
                {secret}
              </code>
            </details>
            <p className="text-xs text-muted-foreground">
              After scanning, enter the 6-digit code from your authenticator:
            </p>
          </div>
        )}

        {/* Verify: Code entry */}
        {(step === 'setup' || step === 'verify') && (
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                6-Digit Authenticator Code
              </label>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && handleVerify()}
                placeholder="000000"
                className="w-full rounded-md border border-input bg-background px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {error && (
              <p className="text-xs font-medium text-red-600">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleVerify}
                disabled={code.length !== 6 || verifying}
                className="flex-1 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifying ? 'Verifying...' : 'Verify & Sign'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
