'use client'

// ============================================================
// WO-86: Drug Interaction Alerts
// ============================================================
//
// Checks all medications in the current session for known
// drug interactions. Displays warnings inline in the review page.

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { findInteractions } from '@/lib/interactions/match'

interface Interaction {
  interaction_id: string
  severity: 'info' | 'warning' | 'critical'
  description: string
  clinical_note: string | null
  source: string | null
  ingredient_a: { ingredient_id: string; common_name: string } | null
  ingredient_b: { ingredient_id: string; common_name: string } | null
}

interface DrugInteractionAlertsProps {
  medicationNames: string[]
  /**
   * Called with true when the check could not run, so Review can block
   * sending: "we could not check" must not pass as "we checked".
   */
  onCheckUnavailable?: (unavailable: boolean) => void
}

async function fetchAllInteractions(): Promise<Interaction[]> {
  // Batch 1, finding 4: this used to return [] on a failed request, and
  // an empty list renders as nothing — byte for byte what "no
  // interactions found" looks like. Throwing puts the query into its
  // error state, which the component shows and the Review gate blocks on.
  const res = await fetch('/api/interactions')
  if (!res.ok) throw new Error(`interactions lookup failed: ${res.status}`)
  const json = await res.json()
  return json.data ?? []
}

const SEVERITY_STYLES = {
  critical: {
    border: 'border-red-300 dark:border-red-800',
    bg: 'bg-red-50 dark:bg-red-950/20',
    badge: 'bg-red-100 text-red-800',
    text: 'text-red-800 dark:text-red-200',
    subtext: 'text-red-700 dark:text-red-300',
  },
  warning: {
    border: 'border-amber-300 dark:border-amber-800',
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    badge: 'bg-amber-100 text-amber-800',
    text: 'text-amber-800 dark:text-amber-200',
    subtext: 'text-amber-700 dark:text-amber-300',
  },
  info: {
    border: 'border-blue-200 dark:border-blue-800',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    badge: 'bg-blue-100 text-blue-800',
    text: 'text-blue-800 dark:text-blue-200',
    subtext: 'text-blue-700 dark:text-blue-300',
  },
}

export function DrugInteractionAlerts({ medicationNames, onCheckUnavailable }: DrugInteractionAlertsProps) {
  const { data: allInteractions = [], isError, isFetching, refetch } = useQuery({
    queryKey: ['drug-interactions'],
    queryFn: fetchAllInteractions,
  })

  // With fewer than two medications nothing can interact, so a failed
  // lookup changes nothing and must not block.
  const checkMatters = medicationNames.length >= 2
  const unavailable  = isError && checkMatters
  useEffect(() => { onCheckUnavailable?.(unavailable) }, [unavailable, onCheckUnavailable])

  if (unavailable) {
    return (
      <div
        role="alert"
        data-testid="drug-interactions-error"
        className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200"
      >
        <p className="font-semibold">Drug interaction check could not run.</p>
        <p className="mt-0.5 text-xs">
          This is an error, not a clear result — these medications have not been checked against each other.
          You can still save a draft.
        </p>
        {/* Re-runs this one check in place. The query stays in its error
            state while the retry is in flight, so the send block holds
            until a check actually succeeds. */}
        <button
          type="button"
          onClick={() => { void refetch() }}
          disabled={isFetching}
          className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-transparent dark:text-red-200"
        >
          {isFetching ? 'Retrying…' : 'Retry'}
        </button>
      </div>
    )
  }

  if (allInteractions.length === 0 || !checkMatters) return null

  // Same match sign-and-send re-runs at send time (lib/interactions).
  const relevant = findInteractions(allInteractions, medicationNames)

  if (relevant.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Drug Interaction Alerts ({relevant.length})
      </h3>
      {relevant.map(int => {
        const styles = SEVERITY_STYLES[int.severity]
        return (
          <div
            key={int.interaction_id}
            className={`rounded-lg border ${styles.border} ${styles.bg} p-3`}
          >
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles.badge}`}>
                {int.severity.toUpperCase()}
              </span>
              <div className="flex-1">
                <p className={`text-sm font-medium ${styles.text}`}>
                  {int.ingredient_a?.common_name} + {int.ingredient_b?.common_name}
                </p>
                <p className={`mt-0.5 text-xs ${styles.subtext}`}>
                  {int.description}
                </p>
                {int.clinical_note && (
                  <p className={`mt-1 text-xs italic ${styles.subtext}`}>
                    {int.clinical_note}
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
