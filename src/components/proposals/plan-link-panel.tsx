'use client'

// ============================================================
// The plan link, after sending (patient protocol choice, PR 2)
// ============================================================
//
// The link never depends on texting (decision 10): Copy link and Show QR
// code are always here, and each is recorded (link_copied, qr_shown). The
// link is shown only now: the server keeps its hash, not the link, so a
// later visit sends a new one instead. When texting is off, or the
// patient cannot be texted, this says so in plain words.

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { TextingOutcome } from '@/lib/proposals/sms'

// The QR code (and the qrcode package) loads when it is first shown, not
// with the dashboard or the review page.
const QrCode = dynamic(() => import('@/app/(clinic-app)/settings/patients/signup-link/_components/qr-code').then(m => m.QrCode))

const TEXTING_COPY: Record<TextingOutcome, string> = {
  sent:         'The link was also texted to the patient.',
  texting_off:  'Texting is not set up, copy the link or show the QR code',
  not_opted_in: 'The patient has not agreed to texts, copy the link or show the QR code',
  no_phone:     'The patient has no mobile number on file, copy the link or show the QR code',
  failed:       'The text could not be sent, copy the link or show the QR code',
}

const button = 'inline-flex min-h-[44px] items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

function recordDelivery(proposalId: string, delivery: 'copied' | 'qr') {
  void fetch(`/api/proposals/${proposalId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delivery }),
  }).catch(() => console.warn('[plan-link] delivery not recorded'))
}

export function PlanLinkPanel({ proposalId, url, expiresAt, texting }: {
  proposalId: string
  url:        string
  expiresAt:  string
  texting:    TextingOutcome
}) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [qrRecorded, setQrRecorded] = useState(false)
  const inputId = `plan-link-${proposalId}`
  const expires = new Date(expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied('yes')
      recordDelivery(proposalId, 'copied')
    } catch {
      setCopied('failed')
    }
  }

  function toggleQr() {
    if (!showQr && !qrRecorded) {
      recordDelivery(proposalId, 'qr')
      setQrRecorded(true)
    }
    setShowQr(v => !v)
  }

  return (
    <section aria-label="Share the plan link" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-foreground">Share this link with the patient. It works until {expires}.</p>
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium text-foreground">Plan link</label>
        <input
          id={inputId}
          readOnly
          value={url}
          onFocus={e => e.currentTarget.select()}
          className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void copy()} className={button}>Copy link</button>
        <button type="button" onClick={toggleQr} aria-expanded={showQr} className={button}>
          {showQr ? 'Hide QR code' : 'Show QR code'}
        </button>
      </div>
      <p role="status" className="text-sm text-foreground">
        {copied === 'yes' ? 'Link copied.' : copied === 'failed' ? 'The link could not be copied. Select it and copy it instead.' : ''}
      </p>
      {showQr && (
        <QrCode text={url} label="QR code for the plan link" className="h-48 w-48 rounded-md border border-border" />
      )}
      <p className="text-sm text-muted-foreground">{TEXTING_COPY[texting]}</p>
    </section>
  )
}
