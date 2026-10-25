// ============================================================
// The page a user sees instead of a crash or a missing page
// ============================================================
//
// Used by every error.tsx, global-error.tsx and not-found.tsx. Plain, calm
// copy and always a way out. It never renders the error itself: the
// boundary logs that (useReportError) and passes only friendly text here.
// `reference` is the opaque digest Next gives a server error, shown to
// staff so a report can be matched to the log; patient pages leave it out.

import Link from 'next/link'

export type ErrorScreenAction =
  | { label: string; href: string }
  | { label: string; onClick: () => void }

export function ErrorScreen({
  title,
  message,
  actions,
  reference,
  testId,
}: {
  title: string
  message: string
  actions: ErrorScreenAction[]
  reference?: string | undefined
  testId: string
}) {
  return (
    <main
      data-testid={testId}
      className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-12 text-center"
    >
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-base text-muted-foreground">{message}</p>
      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          {actions.map((a, i) => {
            const cls = i === 0
              ? 'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              : 'rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
            return 'href' in a
              ? <Link key={a.label} href={a.href} className={cls}>{a.label}</Link>
              : <button key={a.label} type="button" onClick={a.onClick} className={cls}>{a.label}</button>
          })}
        </div>
      )}
      {reference && <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {reference}</p>}
    </main>
  )
}
