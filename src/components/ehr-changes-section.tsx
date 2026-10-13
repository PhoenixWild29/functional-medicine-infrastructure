'use client'

// ============================================================
// "Changes from EHR" on the patient record
// ============================================================
//
// Patient Intake PR 5b. What EHR sync changed on this patient, or kept
// because the patient entered it at self-intake: the field (plain label),
// the value we kept, the EHR's value, applied or kept, and when. Nothing
// is shown when there are none. Loaded from
// /api/patients/[patientId]/ehr-changes (session client, RLS; the view is
// written to the PHI access log there).

import { useEffect, useState } from 'react'
import { FIELD_LABEL, fieldValueText } from '@/lib/integrations/keragon/labels'

interface Change {
  changeId:  string
  field:     string
  ourValue:  string | null
  ehrValue:  string | null
  applied:   boolean
  changedAt: string
}

export function EhrChangesSection({ patientId, className = '' }: { patientId: string; className?: string }) {
  const [changes, setChanges] = useState<Change[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/ehr-changes`, { headers: { Accept: 'application/json' } })
        const body = await res.json().catch(() => ({})) as { changes?: Change[] }
        if (!live) return
        if (!res.ok || !Array.isArray(body.changes)) { setFailed(true); return }
        setChanges(body.changes)
      } catch {
        if (live) setFailed(true)
      }
    })()
    return () => { live = false }
  }, [patientId])

  if (failed) {
    return (
      <p role="alert" className={`rounded-md border border-red-700/40 bg-red-50 p-3 text-sm text-red-700 ${className}`}>
        The changes from your EHR could not be loaded. Reopen this record to try again.
      </p>
    )
  }
  if (!changes || changes.length === 0) return null

  const kept = changes.filter(c => !c.applied).length
  return (
    <section aria-labelledby={`ehr-changes-${patientId}`} className={`space-y-2 rounded-lg border border-border p-4 ${className}`}>
      <h3 id={`ehr-changes-${patientId}`} className="text-sm font-semibold text-foreground">Changes from EHR</h3>
      <p className="text-xs text-muted-foreground">
        {kept > 0
          ? `${kept} value${kept === 1 ? '' : 's'} the patient entered at intake ${kept === 1 ? 'was' : 'were'} kept; the EHR's value is shown for review. Applied changes replaced the value we had.`
          : 'Values your EHR changed on this patient.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">Field</th>
              <th scope="col" className="py-1 pr-3 font-medium">Value we kept</th>
              <th scope="col" className="py-1 pr-3 font-medium">EHR value</th>
              <th scope="col" className="py-1 pr-3 font-medium">Outcome</th>
              <th scope="col" className="py-1 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {changes.map(c => (
              <tr key={c.changeId} className="border-t border-border align-top">
                <th scope="row" className="py-1.5 pr-3 font-medium text-foreground">{FIELD_LABEL[c.field] ?? c.field}</th>
                <td className="break-words py-1.5 pr-3 text-foreground">{fieldValueText(c.field, c.ourValue)}</td>
                <td className="break-words py-1.5 pr-3 text-foreground">{fieldValueText(c.field, c.ehrValue)}</td>
                <td className="py-1.5 pr-3 text-foreground">{c.applied ? 'Applied' : 'Kept (patient entered)'}</td>
                <td className="py-1.5 text-foreground"><time dateTime={c.changedAt}>{new Date(c.changedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</time></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
