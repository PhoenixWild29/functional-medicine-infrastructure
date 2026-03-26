'use client'

// ============================================================
// NavSignOutButton — WO-52
// Shared sign-out button used in clinic-app and ops-dashboard nav headers.
// NB-03: single shared component eliminates duplication across route groups.
// NB-04: includes loading/disabled state to prevent double-submit.
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@/lib/supabase/client'

export function NavSignOutButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    const supabase = createBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
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
