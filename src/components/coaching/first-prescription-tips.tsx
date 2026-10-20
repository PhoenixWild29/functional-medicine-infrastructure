'use client'

// ============================================================
// Guided first prescription (first-run coaching)
// ============================================================
//
// On a user's first New Prescription: short tips, one line each, with
// Next and Skip tips. Finishing or skipping stores rx_tips_seen in the
// user's own user_metadata (POST /api/coaching/prefs), so they are shown
// once. The page passes `seen` from the user it already read.

import { useState } from 'react'

export const RX_TIPS: ReadonlyArray<string> = [
  'Choose the patient (and the prescriber, if that is not you), then Continue.',
  'Search for a medication, or open Favorites or Protocols to load a saved one.',
  'Set the dose and how often; the directions are written for you.',
  'Set the price, check every line on Review, then sign and send the payment link.',
]

export function FirstPrescriptionTips({ seen }: { seen: boolean }) {
  const [open, setOpen] = useState(!seen)
  const [index, setIndex] = useState(0)

  if (!open) return null
  const last = index === RX_TIPS.length - 1

  function finish() {
    setOpen(false)
    void fetch('/api/coaching/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rxTipsSeen: true }),
    }).catch(() => {})
  }

  return (
    <section aria-labelledby="rx-tips-title" className="mb-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rx-tips-title" className="text-sm font-semibold text-foreground">Tips for your first prescription</h2>
        <p className="text-xs text-foreground">Tip {index + 1} of {RX_TIPS.length}</p>
      </div>
      <p className="mt-1 text-sm text-foreground" aria-live="polite">{RX_TIPS[index]}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {last ? (
          <button type="button" onClick={finish} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Done
          </button>
        ) : (
          <button type="button" onClick={() => setIndex(i => i + 1)} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Next
          </button>
        )}
        {!last && (
          <button type="button" onClick={finish} className="text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Skip tips
          </button>
        )}
      </div>
    </section>
  )
}
