'use client'

// ============================================================
// Sign-Out Button — WO-52
// Used by /unauthorized to let the user sign out and try again.
// NB-04: includes loading/disabled state to prevent double-submit.
// ============================================================

import { useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { redirectToLogin } from '@/lib/auth/redirect-to-login'

export function SignOutButton() {
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    redirectToLogin()
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
