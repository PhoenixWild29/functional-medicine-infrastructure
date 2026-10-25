'use client'

// ============================================================
// Login Page — WO-71 (redesign from WO-52)
// /login
// ============================================================
//
// Two-column desktop layout: brand panel left, form right.
// Mobile: single column, form only.
// Entry point for all authenticated users (clinic staff + ops admin).

import { useEffect, useRef, useState, FormEvent, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'
import { postLoginDestination } from '@/lib/auth/landing-route'
import { navigateFully } from '@/lib/auth/full-navigation'
import { getUserRole, ACCOUNT_DEACTIVATED_MESSAGE } from '@/lib/auth/claims'
import Link from 'next/link'
import { LegalFooter } from '@/components/legal/legal-footer'

// B11: notices after a password flow, shown as a status (not an error).
const LOGIN_NOTICES: Record<string, string> = {
  password_reset: 'Your password was changed. Sign in with your new password.',
}

const AUTH_CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  auth_callback_failed: 'Email verification failed. Please try signing in again.',
  // Team invites: the middleware signed out a deactivated team member.
  deactivated: ACCOUNT_DEACTIVATED_MESSAGE,
}

// Separated into its own component so that useSearchParams() is inside a Suspense boundary
// (required in Next.js 16 for static page generation of /login).
function LoginForm() {
  const searchParams = useSearchParams()
  const redirectTo   = searchParams.get('redirectTo')

  // NB-01: surface ?error= hint set by /auth/callback on failure
  const errorParam   = searchParams.get('error')
  const initialError = errorParam
    ? (AUTH_CALLBACK_ERROR_MESSAGES[errorParam] ?? 'Something went wrong. Please try again.')
    : null

  const noticeParam = searchParams.get('notice')
  const notice = noticeParam ? LOGIN_NOTICES[noticeParam] ?? null : null

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(initialError)
  // C10: the fields are marked invalid only when the credentials were
  // refused, not for an auth-callback error that is not about them.
  const [credentialsRefused, setCredentialsRefused] = useState(false)

  // The form is server-rendered: an email and password typed or autofilled
  // before React hydrates are in the inputs but not in state, which would
  // leave "Sign in" disabled. Take them from the inputs once hydrated.
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const typedEmail = emailRef.current?.value ?? ''
    const typedPassword = passwordRef.current?.value ?? ''
    // Syncing state from the DOM (an external system) is what this effect is for.
    if (typedEmail) setEmail(prev => prev || typedEmail)
    if (typedPassword) setPassword(prev => prev || typedPassword)
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setCredentialsRefused(false)

    const supabase = createBrowserClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email:    email.trim().toLowerCase(),
      password,
    })

    // Team invites: a deactivated team member's sign-in is banned.
    if ((authError as { code?: string } | null)?.code === 'user_banned') {
      setError(ACCOUNT_DEACTIVATED_MESSAGE)
      setLoading(false)
      return
    }
    if (authError || !data.session || !data.user) {
      setError('Invalid email or password. Please try again.')
      setCredentialsRefused(true)
      setLoading(false)
      return
    }

    // A full navigation, not router.refresh() + router.push(): the destination
    // was usually redirected to /login before sign-in (that is how the user got
    // here), and since Next 16.3 the client router reuses that redirect, so a
    // push would not move. A full load reaches the middleware with the new
    // session (lib/auth/full-navigation).
    //
    // Role-aware redirect: honour ?redirectTo first, then fall back by role
    // (the clinic admin lands on Practice). NB-1 (cowork): absolute and
    // protocol-relative targets (//evil.com) are ignored; see landing-route.ts.
    // The role comes from the user the auth server just returned for this
    // sign-in, not from a decoded session cookie.
    const appRole = getUserRole(data.user)
    navigateFully(postLoginDestination(appRole, redirectTo))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>

      {notice && !error && (
        <p data-testid="login-notice" role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      {/* Error — inline below the heading, not a banner */}
      {error && (
        <div
          id="login-error"
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Email */}
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-foreground">
          Email address
        </label>
        <input
          ref={emailRef}
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={loading}
          aria-invalid={credentialsRefused || undefined}
          aria-describedby={credentialsRefused ? 'login-error' : undefined}
          className="w-full rounded-lg border border-slate-500 bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50"
          placeholder="you@clinic.com"
        />
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="password" className="block text-sm font-medium text-foreground">
            Password
          </label>
          {/* B11: a reset link by email (Supabase Auth) */}
          <Link href="/forgot-password" className="text-xs font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Forgot password?
          </Link>
        </div>
        <input
          ref={passwordRef}
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={loading}
          aria-invalid={credentialsRefused || undefined}
          aria-describedby={credentialsRefused ? 'login-error' : undefined}
          className="w-full rounded-lg border border-slate-500 bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50"
          placeholder="••••••••"
        />
      </div>

      {/* Submit — 48px height per spec */}
      <button
        type="submit"
        disabled={loading || !email || !password}
        className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--duration-fast)]"
        style={{ minHeight: '48px' }}
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Signing in…
          </span>
        ) : (
          'Sign in'
        )}
      </button>

      {/* Trust signal + admin note */}
      <div className="pt-1 space-y-2">
        <p className="text-xs text-muted-foreground text-center">
          <span aria-hidden>🔒 </span>HIPAA-compliant authentication
        </p>
        <p className="text-xs text-muted-foreground text-center">
          Contact your administrator if you need access.
        </p>
      </div>

    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex">

      {/* ── Left panel: brand (desktop only) ── */}
      <div
        className="hidden md:flex md:w-1/2 flex-col items-center justify-center px-12 py-16"
        style={{ background: 'linear-gradient(160deg, #0F172A 0%, #1E3A5F 100%)' }}
        aria-hidden="true"
      >
        {/* Logo mark */}
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
              <rect x="4" y="4" width="10" height="10" rx="2" fill="white" fillOpacity="0.9" />
              <rect x="18" y="4" width="10" height="10" rx="2" fill="white" fillOpacity="0.6" />
              <rect x="4" y="18" width="10" height="10" rx="2" fill="white" fillOpacity="0.6" />
              <rect x="18" y="18" width="10" height="10" rx="2" fill="white" fillOpacity="0.3" />
            </svg>
          </div>

          <div>
            <p className="text-3xl font-bold text-white tracking-tight">CompoundIQ</p>
            <p className="mt-2 text-sm text-white/60 max-w-xs leading-relaxed">
              Compounding pharmacy order management
            </p>
          </div>

          {/* Feature list */}
          <ul className="mt-4 space-y-3 text-sm text-white/70 text-left w-full max-w-xs">
            {[
              'Automated pharmacy routing',
              'Real-time order tracking',
              'HIPAA-compliant platform',
            ].map(f => (
              <li key={f} className="flex items-center gap-2">
                <svg className="h-4 w-4 flex-shrink-0 text-blue-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Right panel: form ── */}
      <main className="flex w-full md:w-1/2 flex-col items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-sm">

          {/* Mobile logo (hidden on desktop) */}
          <div className="mb-8 text-center md:hidden">
            <p className="text-2xl font-bold text-foreground tracking-tight">CompoundIQ</p>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Access your clinic dashboard
            </p>
          </div>

          <Suspense>
            <LoginForm />
          </Suspense>

          {/* Self sign-up: no invite needed. */}
          <p className="mt-6 text-center text-sm">
            <Link href="/get-started" className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              New to CompoundIQ? Get started
            </Link>
          </p>

        </div>
        <LegalFooter className="mt-8" />
      </main>

    </div>
  )
}
