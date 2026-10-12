// Patient Intake PR 2: "Awaiting patient details", for a patient added
// with only a mobile number who has not finished intake. Words, not colour
// alone; nothing for a complete patient. A plain span: it may sit inside a
// button (the Select Patient list).

import { intakeStatusLabel } from '@/lib/patients/display'

export function IntakeChip({ intakeStatus, className = '' }: { intakeStatus: string | null | undefined; className?: string }) {
  if (intakeStatus !== 'pending') return null
  return (
    <span
      data-testid="intake-chip"
      className={`inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 ${className}`}
    >
      {intakeStatusLabel('pending')}
    </span>
  )
}
