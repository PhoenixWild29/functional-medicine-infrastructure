// ============================================================
// Sig recovery — WO-98 edit-at-review only
// ============================================================
//
// A session line or draft carries its dose + frequency as structured
// values, but not its timing or duration. When such a line is reopened
// in the builder, those two are recovered from the sig it was generated
// with so re-editing the dose keeps the same "in the morning for 30
// days" tail.
//
// WO-104: favorites never come through here. A favorite's dose presets
// carry timing and duration as structured values and are handed to the
// sig builder as `initialStructured` (see favorite-presets.ts). Moved out
// of structured-sig-builder.tsx so tests can prove that.

import { DURATION_OPTIONS, TIMING_OPTIONS } from '../_components/structured-sig-builder.types'

export interface SigTimingAndDuration {
  timing:             string
  duration:           string
  customDurationDays: string
}

/** Recover the timing + duration codes from a previously generated sig. */
export function timingAndDurationFromSig(sig: string | null | undefined): SigTimingAndDuration {
  const lower = (sig ?? '').toLowerCase()
  if (!lower) return { timing: '', duration: '', customDurationDays: '' }
  // Longest fragment first so "30 minutes before meals" beats "with food" style overlaps.
  const timing = [...TIMING_OPTIONS]
    .filter(t => t.sig)
    .sort((a, b) => b.sig.length - a.sig.length)
    .find(t => lower.includes(t.sig.toLowerCase()))
  let duration = ''
  let customDurationDays = ''
  if (lower.includes(', ongoing')) {
    duration = 'ONGOING'
  } else {
    const m = /for (\d+) days/.exec(lower)
    if (m?.[1]) {
      const known = DURATION_OPTIONS.find(d => d.code === m[1])
      if (known) duration = known.code
      else { duration = 'CUSTOM'; customDurationDays = m[1] }
    }
  }
  return { timing: timing?.code ?? '', duration, customDurationDays }
}
