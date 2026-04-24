// ============================================================
// Adapter Health — pure-data constants (PR #16)
// ============================================================
//
// Extracted from adapter-health-monitor.tsx so these maps can be
// imported by node-env jest tests without pulling the full React
// client component (which has 'use client' + react-query imports
// that don't resolve in a node test runtime).
//
// Single source of truth for plain-English circuit-breaker labels
// (WO-72). Both the per-card chip and the filter dropdown read
// label text from this map — change a label here and both surfaces
// update together.

export interface CbBadge {
  label: string
  cls:   string
}

// WO-72: plain-English labels.
// PR #16: CLOSED chip is outlined (border-only) emerald rather than a
// saturated emerald-100 fill. On healthy cards the traffic-light dot +
// "Healthy" status pill + "Online" chip all encode the same signal;
// filling all three with emerald-100 produced visual redundancy.
// Outlined CLOSED keeps the confirmation ("we have telemetry that the
// breaker is closed") while reducing the colour stack. OPEN stays bold
// red (asymmetry by design — alarms should shout); HALF_OPEN stays
// filled amber because it's the rare transitional state the operator
// actually wants to notice.
export const CB_BADGE: Record<string, CbBadge> = {
  CLOSED:    { label: 'Online',   cls: 'border border-emerald-300 text-emerald-700' },
  OPEN:      { label: 'Offline',  cls: 'bg-red-100 text-red-700 font-bold' },
  HALF_OPEN: { label: 'Degraded', cls: 'bg-amber-100 text-amber-700' },
}
