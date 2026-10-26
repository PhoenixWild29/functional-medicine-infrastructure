'use client'

// ============================================================
// Sign-Out Button — WO-52
// Used by /unauthorized to let the user sign out and try again.
// NB-04: includes loading/disabled state to prevent double-submit.
// ============================================================

import { useState } from 'react'
import { signOutInBrowser } from '@/lib/supabase/sign-out'
import { redirectToLogin } from '@/lib/auth/redirect-to-login'

export function SignOutButton() {
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    await signOutInBrowser()
    redirectToLogin()
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs hover:bg-primary-hover focus:outline-hidden focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
