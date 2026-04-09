'use client'

// ============================================================
// WO-86: Drug Interaction Alerts
// ============================================================
//
// Checks all medications in the current session for known
// drug interactions. Displays warnings inline in the review page.

import { useQuery } from '@tanstack/react-query'

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
}

async function fetchAllInteractions(): Promise<Interaction[]> {
  const res = await fetch('/api/interactions')
  if (!res.ok) return []
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

export function DrugInteractionAlerts({ medicationNames }: DrugInteractionAlertsProps) {
  const { data: allInteractions = [] } = useQuery({
    queryKey: ['drug-interactions'],
    queryFn: fetchAllInteractions,
  })

  if (allInteractions.length === 0 || medicationNames.length < 2) return null

  // Fuzzy match: check if both ingredient names appear in the session's medication names
  const namesLower = medicationNames.map(n => n.toLowerCase())

  const relevant = allInteractions.filter(int => {
    const nameA = int.ingredient_a?.common_name?.toLowerCase() ?? ''
    const nameB = int.ingredient_b?.common_name?.toLowerCase() ?? ''
    const hasA = namesLower.some(n => n.includes(nameA) || nameA.includes(n.split(' ')[0] ?? ''))
    const hasB = namesLower.some(n => n.includes(nameB) || nameB.includes(n.split(' ')[0] ?? ''))
    return hasA && hasB
  })

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
