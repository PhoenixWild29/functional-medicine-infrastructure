'use client'

// ============================================================
// Protocol quick-load notices — review step
// ============================================================
//
// Renders the NON-blocking reports produced by a partial protocol
// quick-load (see quick-actions-panel.tsx → loadProtocolToSession).
//
// Why this lives on the review page: when a protocol contains items
// pinned to a pharmacy that is not licensed in the patient's shipping
// state, the licensed items DO load and the unlicensed ones are
// skipped. That is a partial success, so the flow advances — but the
// provider still has to be told, by name, what did not come along.
// Keeping the report on the review step means it is visible next to
// the lines that actually loaded.
//
// Amber, not red, and role="status", not role="alert": nothing here
// blocks signing. The red blocking states (nothing loadable, missing
// price, un-sendable line) live elsewhere and are unchanged.

import { usePrescriptionSession } from '../../_context/prescription-session'

export function ProtocolLoadNotices() {
  const session = usePrescriptionSession()

  if (session.notices.length === 0) return null

  return (
    <div className="mb-6 space-y-3">
      {session.notices.map(notice => (
        <div
          key={notice.id}
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Loaded {notice.loadedCount} of {notice.totalCount} medication
              {notice.totalCount !== 1 ? 's' : ''}
              {notice.protocolName ? ` from ${notice.protocolName}` : ''}
            </p>
            <button
              type="button"
              onClick={() => session.dismissNotice(notice.id)}
              className="shrink-0 rounded text-xs font-medium text-amber-800 underline hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-300"
            >
              Dismiss
            </button>
          </div>

          {notice.skipped.length > 0 && (
            <>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                {notice.skipped.length} skipped because the pinned pharmacy is not licensed
                {notice.patientState ? ` in ${notice.patientState}` : ' in this patient’s state'}:
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-800 dark:text-amber-300">
                {notice.skipped.map(message => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </>
          )}

          {notice.alreadyPresent.length > 0 && (
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              Already in this session, so not added again:{' '}
              {notice.alreadyPresent.join(', ')}.
            </p>
          )}

          <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
            The prescriptions below are ready to review and send. To prescribe a skipped
            medication, add it from search using a pharmacy licensed in{' '}
            {notice.patientState ?? 'the patient’s state'}.
          </p>
        </div>
      ))}
    </div>
  )
}
