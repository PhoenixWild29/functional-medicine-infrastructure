'use client'

// ============================================================
// Login Page — WO-52
// /login
// ============================================================
//
// Entry point for all authenticated users (clinic staff + ops admin).
// Uses Supabase email+password auth. Role-aware redirect after sign-in.
// Public route — no session required to render.

import { useState, FormEvent, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'

const AUTH_CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  auth_callback_failed: 'Email verification failed. Please try signing in again.',
}

// Separated into its own component so that useSearchParams() is inside a Suspense boundary
// (required in Next.js 16 for static page generation of /login).
function LoginForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const redirectTo   = searchParams.get('redirectTo')

  // NB-01: surface ?error= hint set by /auth/callback on failure
  const errorParam = searchParams.get('error')
  const initialError = errorParam ? (AUTH_CALLBACK_ERROR_MESSAGES[errorParam] ?? 'Something went wrong. Please try again.') : null

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(initialError)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createBrowserClient()
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email:    email.trim().toLowerCase(),
      password,
    })

    if (authError || !data.session) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }

    // NB-02: router.refresh() ensures the Next.js server cache sees the new session
    // before the protected Server Component renders on the redirect target.
    router.refresh()

    // Role-aware redirect: honour ?redirectTo first, then fall back by role.
    // NB-1 (cowork): exclude protocol-relative URLs (//evil.com) in addition to
    // absolute URLs — startsWith('/') alone allows //foo which some browsers treat
    // as an external redirect. Both checks are needed for belt-and-suspenders.
    if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
      router.push(redirectTo)
      return
    }

    const appRole = data.session.user.user_metadata['app_role'] as string | undefined
    if (appRole === 'ops_admin') {
      router.push('/ops/pipeline')
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>

      {/* Error banner — NB-07: explicit aria-live for screen reader reliability */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Email */}
      <div className="space-y-1">
        <label
          htmlFor="email"
          className="block text-sm font-medium text-foreground"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={loading}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          placeholder="you@example.com"
        />
      </div>

      {/* Password */}
      <div className="space-y-1">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-foreground"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={loading}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          placeholder="••••••••"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || !email || !password}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>

    </form>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">

        {/* Wordmark */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">CompoundIQ</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your account</p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Contact your administrator if you need access.
        </p>

      </div>
    </div>
  )
}
