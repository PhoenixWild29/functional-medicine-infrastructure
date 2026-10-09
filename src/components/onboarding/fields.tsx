'use client'

// ============================================================
// Onboarding form controls (WCAG 2.1 AA, as #206)
// ============================================================
//
// Every control has a visible <label>; an error is rendered under its
// field, announced, and tied to it with aria-describedby + aria-invalid;
// hints are tied the same way. Borders meet 3:1 non-text contrast
// (slate-500 on white), text meets 4.5:1, and every control shows a
// focus ring (focus-visible). Shared by the invite pages, the wizard and
// the ops onboarding screen.

import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from 'react'

const INPUT = 'w-full rounded-lg border border-slate-500 bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-50 aria-[invalid=true]:border-red-700'

export const BUTTON_PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
export const BUTTON_SECONDARY = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-500 bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
export const BUTTON_DANGER = 'inline-flex min-h-[44px] items-center justify-center rounded-lg border border-red-700 bg-background px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'

function describedBy(...ids: Array<string | null | undefined | false>): string | undefined {
  const s = ids.filter(Boolean).join(' ')
  return s || undefined
}

interface FieldBase {
  id:     string
  label:  string
  error?: string | undefined
  hint?:  string | undefined
}

export function TextField({ id, label, error, hint, ...input }: FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  const errorId = error ? `${id}-error` : null
  const hintId = hint ? `${id}-hint` : null
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      <input
        id={id}
        className={INPUT}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(errorId, hintId)}
        {...input}
      />
      {hint && <p id={hintId!} className="text-xs text-slate-600">{hint}</p>}
      {error && <p id={errorId!} role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  )
}

export function SelectField({ id, label, error, hint, children, ...select }: FieldBase & { children: ReactNode } & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>) {
  const errorId = error ? `${id}-error` : null
  const hintId = hint ? `${id}-hint` : null
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      <select
        id={id}
        className={INPUT}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(errorId, hintId)}
        {...select}
      >
        {children}
      </select>
      {hint && <p id={hintId!} className="text-xs text-slate-600">{hint}</p>}
      {error && <p id={errorId!} role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  )
}

export function CheckboxField({ id, label, hint, ...input }: Omit<FieldBase, 'error'> & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'>) {
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-5 w-5 rounded border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        aria-describedby={hintId}
        {...input}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
        {hint && <p id={hintId} className="text-xs text-slate-600">{hint}</p>}
      </div>
    </div>
  )
}

export function FormAlert({ tone = 'error', children, id }: { tone?: 'error' | 'success' | 'info' | 'warning'; children: ReactNode; id?: string }) {
  const styles = {
    error:   'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    info:    'border-sky-300 bg-sky-50 text-sky-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
  }[tone]
  return (
    <div id={id} role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  )
}

/** A copyable invite link, with a mailto: to send it from the user's own email. */
export function InviteLink({ link, email, subject, idPrefix }: { link: string; email: string; subject: string; idPrefix: string }) {
  const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Here is your CompoundIQ invite link (it works once and expires in 7 days):\n\n${link}\n`)}`
  return (
    <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3" role="status">
      <label htmlFor={`${idPrefix}-link`} className="block text-sm font-medium text-emerald-900">
        Invite link for {email} (shown once; it works once and expires in 7 days)
      </label>
      <input id={`${idPrefix}-link`} readOnly value={link} className={`${INPUT} font-mono text-xs`} onFocus={e => e.currentTarget.select()} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BUTTON_SECONDARY}
          onClick={() => { void navigator.clipboard?.writeText(link) }}
        >
          Copy link
        </button>
        <a className={BUTTON_SECONDARY} href={mailto}>Email this invite</a>
      </div>
    </div>
  )
}
