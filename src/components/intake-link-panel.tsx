'use client'

// ============================================================
// Intake link panel (Patient Intake PR 2)
// ============================================================
//
// Twilio is not configured on prod, so staff get the link themselves: copy
// it, or "Email this link" (mailto, the same no-PHI wording as the text).
// Says what happened to the text. The link is shown once; resending makes
// a new one and the old one stops working.

import { useState } from 'react'

export type IntakeSmsStatus = 'sent' | 'not_configured' | 'suppressed' | 'failed' | 'not_sent' | string

export interface IntakeLinkInfo {
  url:       string
  expiresAt: string
  smsStatus: IntakeSmsStatus
}

const SMS_MESSAGE: Record<string, string> = {
  sent:           'Texted to the patient’s mobile. You can also copy the link or email it.',
  not_configured: 'Texting is not set up, so nothing was texted. Copy the link or email it to the patient.',
  suppressed:     'The patient has opted out of texts. Copy the link or email it to them.',
  failed:         'The text could not be sent. Copy the link or email it to the patient.',
  not_sent:       'Nothing was texted. Copy the link or email it to the patient.',
}

function expiry(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function IntakeLinkPanel({ link, idPrefix = 'intake-link' }: { link: IntakeLinkInfo; idPrefix?: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle')
  const inputId = `${idPrefix}-url`
  const headingId = `${idPrefix}-heading`

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied('copied')
    } catch {
      setCopied('failed')
    }
  }

  const subject = 'Complete your details'
  const body = `Your clinic has sent you a secure link to complete your details: ${link.url}`
  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  const until = expiry(link.expiresAt)

  return (
    <section aria-labelledby={headingId} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <h3 id={headingId} className="font-semibold text-foreground">Intake link</h3>
      <p className="mt-1 text-xs text-muted-foreground">{SMS_MESSAGE[link.smsStatus] ?? SMS_MESSAGE['not_sent']}</p>
      <label htmlFor={inputId} className="mt-2 block text-xs font-medium text-foreground">Intake link for the patient</label>
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <input
          id={inputId}
          type="text"
          readOnly
          value={link.url}
          onFocus={e => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-slate-500 bg-background px-2 py-1.5 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Copy link
          </button>
          <a
            href={mailto}
            className="rounded-md border border-slate-500 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Email this link
          </a>
        </div>
      </div>
      <p role="status" className="mt-1 min-h-[1rem] text-xs text-foreground">
        {copied === 'copied' ? 'Link copied.' : copied === 'failed' ? 'Could not copy. Select the link and copy it.' : ''}
      </p>
      {until && <p className="text-xs text-muted-foreground">Works once, until {until}.</p>}
    </section>
  )
}
