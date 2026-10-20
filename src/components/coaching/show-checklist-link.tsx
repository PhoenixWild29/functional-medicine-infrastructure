'use client'

// ============================================================
// "Show setup checklist" (user menu)
// ============================================================
//
// Shown while the user has hidden the setup checklist and it is not done.
// Stores the choice (POST /api/coaching/prefs) and brings the card back:
// on the home page by telling the card to reload, elsewhere by going home.

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { SHOW_CHECKLIST_EVENT } from './setup-checklist-card'

export function ShowChecklistLink({ home, className = '' }: { home: string; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)

  async function show() {
    setBusy(true)
    try {
      const res = await fetch('/api/coaching/prefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checklistHidden: false }),
      })
      if (!res.ok) return
      if (pathname === home) window.dispatchEvent(new Event(SHOW_CHECKLIST_EVENT))
      else router.push(home)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void show()}
      disabled={busy}
      className={`text-left text-xs font-medium text-foreground underline underline-offset-2 hover:text-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      Show setup checklist
    </button>
  )
}
