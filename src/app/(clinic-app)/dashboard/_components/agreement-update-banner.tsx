'use client'

// ============================================================
// Dashboard: a new BAA / terms version is available
// ============================================================
//
// For the clinic admin, when the current BAA or terms are newer than the
// clinic's latest acceptance (lib/agreements/clinic-agreements). Links to
// /settings/agreements to review and accept. Dismissible: dismissing hides
// it for these versions in this browser (a later version shows it again).
// Never blocks ordering.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { AgreementNotice } from '@/lib/agreements/clinic-agreements'

const keyFor = (notice: AgreementNotice) =>
  `agreement-notice-dismissed:${notice.agreements.map(a => `${a.key}@${a.version}`).join(',')}`

function readDismissed(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1' } catch { return false }
}

export function AgreementUpdateBanner({ notice }: { notice: AgreementNotice | null }) {
  const storageKey = notice ? keyFor(notice) : ''
  const [dismissed, setDismissed] = useState(() => (notice && typeof window !== 'undefined' ? readDismissed(storageKey) : false))
  useEffect(() => { if (notice) setDismissed(readDismissed(storageKey)) }, [notice, storageKey])

  if (!notice || dismissed) return null

  function dismiss() {
    setDismissed(true)
    try { window.localStorage.setItem(storageKey, '1') } catch { /* private mode: dismissed for this view only */ }
  }

  const list = notice.agreements.map(a => `${a.title} (${a.version})`).join(' and ')
  return (
    <section
      aria-labelledby="agreement-notice-title"
      className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-sky-300 bg-sky-50 p-4 dark:border-sky-700 dark:bg-sky-950/30"
      data-testid="agreement-update-banner"
    >
      <div className="space-y-1">
        <h2 id="agreement-notice-title" className="text-sm font-semibold text-sky-900 dark:text-sky-200">A new version is available</h2>
        <p className="text-sm text-sky-900 dark:text-sky-200">
          A new version of the {list} is ready for you to review and accept. Ordering is not affected.
        </p>
        <Link href="/settings/agreements" className="inline-block text-sm font-medium text-sky-900 underline underline-offset-2 dark:text-sky-200">
          Review in Settings, Agreements
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md border border-sky-700 px-3 py-1.5 text-sm font-medium text-sky-900 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-sky-400 dark:text-sky-200 dark:hover:bg-sky-900/40"
      >
        Dismiss
      </button>
    </section>
  )
}
