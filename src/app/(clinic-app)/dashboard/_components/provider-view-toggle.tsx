'use client'

// ============================================================
// Provider View Toggle — F-3 follow-up (2026-06-14)
// ============================================================
//
// Audit ref: docs/audits/role-audit-and-data-model.md §F-3.
//
// A two-button segmented control on the provider's dashboard that
// flips between:
//   - "My patients"      → no URL param (default RLS — provider's own
//                          orders only, via migration 20260611000004)
//   - "All clinic orders" → ?view=clinic (activates the additive RLS
//                          policy from migration 20260614000003 by way
//                          of the x-provider-view-mode: clinic header
//                          forwarded from the SSR Supabase client)
//
// Rendered ONLY for providers (the parent server component guards on
// `appRole === 'provider'`). For every other role the toggle is hidden
// because the other roles already see all clinic orders.
//
// We mutate the URL via router.push() with { scroll: false } so the
// page re-renders server-side with the new query string but the user's
// scroll position is preserved.
// ============================================================

import { useRouter, usePathname } from 'next/navigation'
import { useTransition } from 'react'

export type ProviderViewMode = 'mine' | 'clinic'

interface Props {
  viewMode: ProviderViewMode
}

export function ProviderViewToggle({ viewMode }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()

  function setMode(next: ProviderViewMode) {
    if (next === viewMode) return
    const url =
      next === 'clinic'
        ? `${pathname}?view=clinic`
        : pathname
    startTransition(() => {
      router.push(url, { scroll: false })
    })
  }

  return (
    <div
      className="inline-flex rounded-md border border-border overflow-hidden"
      role="group"
      aria-label="Order visibility"
    >
      <button
        type="button"
        onClick={() => setMode('mine')}
        aria-pressed={viewMode === 'mine'}
        disabled={isPending && viewMode !== 'mine'}
        className={`px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
          viewMode === 'mine'
            ? 'bg-primary text-primary-foreground'
            : 'bg-card text-muted-foreground hover:bg-accent'
        }`}
      >
        My patients
      </button>
      <button
        type="button"
        onClick={() => setMode('clinic')}
        aria-pressed={viewMode === 'clinic'}
        disabled={isPending && viewMode !== 'clinic'}
        className={`px-3 py-1.5 text-xs font-medium border-l border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
          viewMode === 'clinic'
            ? 'bg-primary text-primary-foreground'
            : 'bg-card text-muted-foreground hover:bg-accent'
        }`}
      >
        All clinic orders
      </button>
    </div>
  )
}
