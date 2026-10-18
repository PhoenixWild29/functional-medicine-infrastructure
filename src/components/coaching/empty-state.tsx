// ============================================================
// Empty state: what to do next, with a button
// ============================================================
//
// First-run coaching: an empty list says what to do next and offers the
// action (a link, or a button that opens the form on the same page).

import Link from 'next/link'

type Action = { label: string; href: string } | { label: string; onClick: () => void }

const BUTTON = 'inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function EmptyState({ title, body, action, testId }: { title: string; body?: string; action?: Action; testId?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center" data-testid={testId}>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
      {action && ('href' in action
        ? <Link href={action.href} className={BUTTON}>{action.label}</Link>
        : <button type="button" onClick={action.onClick} className={BUTTON}>{action.label}</button>)}
    </div>
  )
}
