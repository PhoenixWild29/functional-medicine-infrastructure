'use client'

// ============================================================
// Setup checklist card (first-run coaching)
// ============================================================
//
// Lauren, 18 Oct: providers will not read a guide; the product walks them
// through setup. A card at the top of the clinic dashboard (and the
// pharmacy portal) lists the steps for the user's role, each a link to
// where it is done and ticked from real data (GET /api/coaching/checklist).
// "Hide checklist" stores the choice in the user's own user_metadata
// (POST /api/coaching/prefs); "Show setup checklist" in the user menu
// brings it back (the 'coaching:show-checklist' event). Nothing shows
// when the role has none, it is hidden or done, or the read failed.

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Step { id: string; label: string; href: string; done: boolean }
interface Checklist { notice: string | null; steps: Step[] }

export const SHOW_CHECKLIST_EVENT = 'coaching:show-checklist'

// The checklist to show, or null (hidden, done, or it cannot be read).
async function readChecklist(): Promise<Checklist | null> {
  try {
    const res = await fetch('/api/coaching/checklist', { cache: 'no-store' })
    if (!res.ok) return null
    const body = await res.json() as { show?: boolean; notice?: string | null; steps?: Step[] }
    return body.show && Array.isArray(body.steps) ? { notice: body.notice ?? null, steps: body.steps } : null
  } catch {
    return null
  }
}

export function SetupChecklistCard() {
  const router = useRouter()
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [hiding, setHiding] = useState(false)

  // Reads can answer out of order: the read made on load (while hidden) can
  // land after the read "Show setup checklist" triggers, and would blank the
  // card it just showed. Only the latest read's answer is applied; hiding
  // also outdates any read in flight.
  const latestRead = useRef(0)
  const load = useCallback(() => {
    const read = ++latestRead.current
    return readChecklist().then(next => {
      if (read === latestRead.current) setChecklist(next)
    })
  }, [])

  useEffect(() => {
    void load()
    const again = () => { void load() }
    window.addEventListener(SHOW_CHECKLIST_EVENT, again)
    return () => window.removeEventListener(SHOW_CHECKLIST_EVENT, again)
  }, [load])

  async function hide() {
    setHiding(true)
    try {
      const res = await fetch('/api/coaching/prefs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checklistHidden: true }),
      })
      if (res.ok) {
        latestRead.current++
        setChecklist(null)
        router.refresh()
      }
    } finally {
      setHiding(false)
    }
  }

  if (!checklist) return null
  const done = checklist.steps.filter(s => s.done).length

  return (
    <section aria-labelledby="setup-checklist-title" className="rounded-xl border border-border bg-card p-5 shadow-sm" data-testid="setup-checklist">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="setup-checklist-title" className="text-base font-semibold text-foreground">Get set up</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{done} of {checklist.steps.length} done</p>
        </div>
        <button
          type="button"
          onClick={() => void hide()}
          disabled={hiding}
          className="rounded-md px-2 py-1 text-sm font-medium text-foreground underline underline-offset-2 hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Hide checklist
        </button>
      </div>

      {checklist.notice && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{checklist.notice}</p>
      )}

      <ol className="mt-3 space-y-2">
        {checklist.steps.map(step => (
          <li key={step.id}>
            <Link
              href={step.href}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={step.done ? 'text-muted-foreground line-through decoration-1' : 'font-medium'}>{step.label}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${step.done ? 'bg-emerald-100 text-emerald-800' : 'bg-muted text-foreground'}`}>
                {step.done ? 'Done' : 'To do'}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
