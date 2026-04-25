'use client'

// ============================================================
// NavSignOutButton — WO-52
// Shared sign-out button used in clinic-app and ops-dashboard nav headers.
// NB-03: single shared component eliminates duplication across route groups.
// NB-04: includes loading/disabled state to prevent double-submit.
// ============================================================

import { useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { redirectToLogin } from '@/lib/auth/redirect-to-login'

export function NavSignOutButton() {
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
      className="text-sm text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring rounded disabled:opacity-50"
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
