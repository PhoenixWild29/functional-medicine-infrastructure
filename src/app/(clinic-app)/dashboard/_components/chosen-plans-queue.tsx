// ============================================================
// Plans ready to sign (patient protocol choice, PR 4)
// ============================================================
//
// The signature queue's entry for a plan the patient chose: "<first name>
// chose <option label> (<n> of <m> items)", above the dashboard's orders.
// Review and sign opens the sign page with exactly the chosen lines
// (/new-prescription/sign?proposal=<id>). Offered to the plan's provider,
// and to a clinic admin, whom the sign page then checks (a clinic admin
// signs only as their own linked provider). Others see that it waits for
// the provider. No medication is named here.

import Link from 'next/link'
import { choiceSummary } from '@/lib/proposals/queue'

export interface QueuePlan {
  proposalId:       string
  providerId:       string
  patientFirstName: string
  optionLabel:      string
  chosenCount:      number
  optionCount:      number
  chosenAt:         string | null
}

export function ChosenPlansQueue({ plans, viewerProviderId, isClinicAdmin }: {
  plans:            QueuePlan[]
  viewerProviderId: string | null
  isClinicAdmin:    boolean
}) {
  if (plans.length === 0) return null
  return (
    <section aria-labelledby="plans-ready-heading" className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
      <h2 id="plans-ready-heading" className="text-sm font-semibold">Plans ready to sign</h2>
      <ul className="mt-2 space-y-2">
        {plans.map(plan => {
          const summary = choiceSummary(plan)
          const canSign = isClinicAdmin || (viewerProviderId !== null && viewerProviderId === plan.providerId)
          return (
            <li key={plan.proposalId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{summary}</span>
              {canSign ? (
                <Link
                  href={`/new-prescription/sign?proposal=${plan.proposalId}`}
                  aria-label={`Review and sign: ${summary}`}
                  className="inline-flex min-h-[44px] items-center rounded-md bg-emerald-800 px-3 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Review and sign
                </Link>
              ) : (
                <span className="text-xs">Waiting for their provider to sign.</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
