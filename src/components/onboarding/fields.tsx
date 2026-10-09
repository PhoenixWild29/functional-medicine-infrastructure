'use client'

// ============================================================
// Onboarding form primitives (WCAG 2.1 AA)
// ============================================================
//
// Every control has a visible <label> (required ones carry aria-required;
// optional ones say so in their hint). A hint and an error are tied to
// the control with aria-describedby; an error also sets aria-invalid and
// is phrased as what to do. Errors are text, never colour alone. Touch
// targets are at least 44px tall; inputs use 16px text (no iOS zoom).

import type { ReactNode } from 'react'

const control = 'mt-1 block w-full min-h-[44px] rounded-md border bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60'

function describedBy(id: string, hint?: ReactNode | undefined, error?: string | null | undefined): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

function Help({ id, hint, error }: { id: string; hint?: ReactNode | undefined; error?: string | null | undefined }) {
  return (
    <>
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-sm font-medium text-destructive">{error}</p>}
    </>
  )
}

export function TextField(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | null | undefined
  hint?: ReactNode | undefined
  type?: 'text' | 'email' | 'tel' | 'password' | 'date' | 'time' | 'url' | undefined
  required?: boolean | undefined
  autoComplete?: string | undefined
  inputMode?: 'text' | 'numeric' | 'tel' | 'email' | 'url' | undefined
  maxLength?: number | undefined
  disabled?: boolean | undefined
}) {
  const { id, label, value, onChange, error, hint, type = 'text', required, autoComplete, inputMode, maxLength, disabled } = props
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        className={`${control} ${error ? 'border-destructive' : 'border-input'}`}
      />
      <Help id={id} hint={hint} error={error} />
    </div>
  )
}

export function SelectField(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  error?: string | null | undefined
  hint?: ReactNode | undefined
  required?: boolean | undefined
  placeholder?: string | undefined
}) {
  const { id, label, value, onChange, options, error, hint, required, placeholder } = props
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <select
        id={id}
        name={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${control} ${error ? 'border-destructive' : 'border-input'}`}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Help id={id} hint={hint} error={error} />
    </div>
  )
}

/** A yes/no or one-of-n choice as a fieldset of radios. */
export function RadioGroup(props: {
  id: string
  legend: string
  value: string | null
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string; description?: string }>
  error?: string | null | undefined
  hint?: ReactNode | undefined
}) {
  const { id, legend, value, onChange, options, error, hint } = props
  return (
    <fieldset aria-describedby={describedBy(id, hint, error)} aria-invalid={error ? true : undefined}>
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map(o => (
          <label key={o.value} htmlFor={`${id}-${o.value}`} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border p-3 ${value === o.value ? 'border-primary bg-primary/5' : 'border-input'}`}>
            <input
              id={`${id}-${o.value}`}
              type="radio"
              name={id}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">{o.label}</span>
              {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
      <Help id={id} hint={hint} error={error} />
    </fieldset>
  )
}

/** The form-level message: role="alert" so it is announced when it appears. */
export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </div>
  )
}

export function PrimaryButton(props: { children: ReactNode; type?: 'submit' | 'button' | undefined; onClick?: (() => void) | undefined; disabled?: boolean | undefined; busy?: boolean | undefined }) {
  const { children, type = 'submit', onClick, disabled, busy } = props
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function SecondaryButton(props: { children: ReactNode; onClick?: (() => void) | undefined; disabled?: boolean | undefined; type?: 'button' | 'submit' | undefined; ariaLabel?: string | undefined }) {
  const { children, onClick, disabled, type = 'button', ariaLabel } = props
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  )
}

/** POST/PUT JSON; the body of a refusal as { error, errors }. */
export async function sendJson(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'The connection failed. Check your network and try again.' } }
  }
}

export function fieldErrors(data: Record<string, unknown>): Record<string, string> {
  const e = data['errors']
  return e && typeof e === 'object' ? e as Record<string, string> : {}
}
