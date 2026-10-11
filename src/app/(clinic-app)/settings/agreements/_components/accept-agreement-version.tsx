'use client'

// ============================================================
// Review and accept the current version of an agreement
// ============================================================
//
// Shown to the clinic admin on /settings/agreements when the current BAA
// or terms are newer than the clinic's latest acceptance (or none was
// recorded). The same form as the onboarding wizard: the full text, the
// signer's name and title, and an "I have read and agree" box. The server
// records the version and the SHA-256 of its own copy of the text.

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { LegalMarkdown } from '@/components/onboarding/legal-markdown'
import { TextField, CheckboxField, FormAlert, BUTTON_PRIMARY } from '@/components/onboarding/fields'
import { DRAFT_BANNER, type AgreementKey } from '@/lib/onboarding/agreement-texts'

type Errors = Record<string, string>

export function AcceptAgreementVersion({ agreement, title, version, text }: { agreement: AgreementKey; title: string; version: string; text: string }) {
  const router = useRouter()
  const [signerName, setSignerName] = useState('')
  const [signerTitle, setSignerTitle] = useState('')
  const [agree, setAgree] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const id = `accept-${agreement}`

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const local: Errors = {}
    if (!signerName.trim()) local['signerName'] = 'Enter your full name.'
    if (!signerTitle.trim()) local['signerTitle'] = 'Enter your title.'
    if (!agree) local['agree'] = 'Confirm that you have read and agree.'
    setErrors(local)
    setMsg(null)
    if (Object.keys(local).length > 0) return
    setBusy(true)
    let ok = false
    let data: Record<string, unknown> = {}
    try {
      const res = await fetch('/api/settings/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agreement, version, signerName: signerName.trim(), signerTitle: signerTitle.trim() }),
      })
      ok = res.ok
      data = await res.json().catch(() => ({})) as Record<string, unknown>
    } catch {
      data = { error: 'Network error. Try again.' }
    }
    setBusy(false)
    if (!ok) {
      setErrors((data['errors'] as Errors | undefined) ?? {})
      setMsg({ tone: 'error', text: (data['error'] as string | undefined) ?? 'Your acceptance could not be recorded.' })
      return
    }
    setMsg({ tone: 'success', text: `${title} ${version} accepted. Your acceptance has been recorded.` })
    router.refresh()
  }

  if (msg?.tone === 'success') return <FormAlert tone="success">{msg.text}</FormAlert>

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong className="font-semibold">{DRAFT_BANNER}.</strong> This {title} is a draft template and will be replaced by the final version.
      </p>
      <div
        tabIndex={0}
        role="region"
        aria-label={`${title} ${version} text`}
        className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-slate-500 bg-background p-4 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LegalMarkdown text={text} headingLevel={3} />
      </div>
      {msg && <FormAlert>{msg.text}</FormAlert>}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Accept the {title} {version}</legend>
          <TextField id={`${id}-name`} label="Signer name" autoComplete="name" value={signerName} onChange={e => setSignerName(e.target.value)} error={errors['signerName']} required />
          <TextField id={`${id}-title`} label="Title" autoComplete="organization-title" value={signerTitle} onChange={e => setSignerTitle(e.target.value)} error={errors['signerTitle']} required />
          <div className="sm:col-span-2 space-y-1">
            <CheckboxField
              id={`${id}-agree`}
              label={`I have read the ${title} and agree to it on behalf of the practice.`}
              checked={agree}
              onChange={e => setAgree(e.target.checked)}
              aria-invalid={errors['agree'] ? true : undefined}
              aria-describedby={errors['agree'] ? `${id}-agree-error` : undefined}
            />
            {errors['agree'] && <p id={`${id}-agree-error`} role="alert" className="text-sm text-red-700 dark:text-red-300">{errors['agree']}</p>}
          </div>
        </fieldset>
        <button type="submit" className={BUTTON_PRIMARY} disabled={busy}>{busy ? 'Recording…' : `Accept the ${title} ${version}`}</button>
      </form>
    </div>
  )
}
