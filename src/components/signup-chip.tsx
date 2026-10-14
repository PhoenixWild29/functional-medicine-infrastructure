// Patient Intake PR 3: "From sign-up link", for a patient who signed up
// from the clinic's standing link (or its QR code). Words, not colour
// alone; nothing for any other source. A plain span: it may sit inside a
// button (the Select Patient list).

export function SignupChip({ source, className = '' }: { source: string | null | undefined; className?: string }) {
  if (source !== 'signup_link') return null
  return (
    <span
      data-testid="signup-chip"
      className={`inline-flex items-center rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-900 ${className}`}
    >
      From sign-up link
    </span>
  )
}
