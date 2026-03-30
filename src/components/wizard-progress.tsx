// ============================================================
// Wizard Progress Indicator — WO-71
// ============================================================
//
// Visual step progress for multi-step wizards.
// Completed steps: filled primary circle + checkmark, clickable if href provided.
// Active step: filled primary circle + ring, aria-current="step".
// Pending steps: outlined gray circle.

import Link from 'next/link'

export interface WizardStep {
  number: number
  label:  string
  href?:  string  // if set + step is completed, renders as a back-navigation link
}

interface Props {
  steps:       WizardStep[]
  currentStep: number  // 1-based
}

function StepCircle({
  number,
  isCompleted,
  isActive,
}: {
  number:      number
  isCompleted: boolean
  isActive:    boolean
}) {
  const base = 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors'
  const variant = isCompleted || isActive
    ? 'bg-primary text-primary-foreground'
    : 'border-2 border-muted-foreground/30 bg-background text-muted-foreground'
  const ring = isActive ? ' ring-2 ring-primary ring-offset-2' : ''

  return (
    <span className={`${base} ${variant}${ring}`}>
      {isCompleted ? (
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        number
      )}
    </span>
  )
}

export function WizardProgress({ steps, currentStep }: Props) {
  return (
    <nav aria-label="Prescription wizard steps">
      <ol className="flex flex-wrap items-center gap-y-2">
        {steps.map((step, idx) => {
          const isCompleted = step.number < currentStep
          const isActive    = step.number === currentStep
          const isLast      = idx === steps.length - 1
          const labelCls    = isActive
            ? 'text-primary font-medium'
            : isCompleted
              ? 'text-foreground'
              : 'text-muted-foreground'

          const inner = (
            <span className="flex items-center gap-2">
              <StepCircle number={step.number} isCompleted={isCompleted} isActive={isActive} />
              <span className={`text-sm ${labelCls}`}>{step.label}</span>
            </span>
          )

          return (
            <li key={step.number} className="flex items-center">
              {isCompleted && step.href ? (
                <Link
                  href={step.href}
                  aria-label={`Go back to step ${step.number}: ${step.label}`}
                  className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {inner}
                </Link>
              ) : (
                <span aria-current={isActive ? 'step' : undefined}>
                  {inner}
                </span>
              )}
              {!isLast && (
                <span className="mx-3 select-none text-muted-foreground/30" aria-hidden>
                  ›
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
