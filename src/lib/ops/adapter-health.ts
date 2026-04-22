// ============================================================
// Adapter health utility — WO-35
// ============================================================
// Shared between:
//   src/app/(ops-dashboard)/ops/adapters/page.tsx  (server component)
//   src/app/api/ops/adapters/route.ts              (API route)

import type { CircuitBreakerState } from '@/app/api/ops/adapters/route'

// ── Health status computation ────────────────────────────────
// Idle:   totalCount === 0 — no submissions in the window, nothing to grade
// Green:  success rate >= 95%, no CB OPEN, last success < 15 min
// Yellow: success rate 80-95%, or CB HALF_OPEN, or last success 15-60 min
// Red:    success rate < 80%, or CB OPEN, or last success > 60 min
//
// The 'idle' branch is a demo-readiness fix (cowork review B1): a fresh
// environment with zero submissions in the 24h window previously rendered
// every pharmacy as Critical because `lastSuccessMs === Infinity` fell
// through the red branch. That reads as "all integrations are broken"
// during an investor Ops tour. Idle is the truthful state — nothing has
// been sent, so nothing can be failing.
export function computeAdapterStatus(
  successRate: number,
  cbState: CircuitBreakerState | null,
  lastSuccessAt: string | null,
  totalCount: number,
): 'green' | 'yellow' | 'red' | 'idle' {
  if (totalCount === 0) return 'idle'

  const now = Date.now()
  const lastSuccessMs = lastSuccessAt ? now - new Date(lastSuccessAt).getTime() : Infinity

  if (cbState === 'OPEN') return 'red'
  if (successRate < 80 || lastSuccessMs > 60 * 60_000) return 'red'
  if (cbState === 'HALF_OPEN' || successRate < 95 || lastSuccessMs > 15 * 60_000) return 'yellow'
  return 'green'
}

// ── Percentile helper ────────────────────────────────────────
// Returns null if fewer than 5 samples (not statistically meaningful).
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length < 5) return null
  const idx = Math.floor((p / 100) * (sortedAsc.length - 1))
  return sortedAsc[idx] ?? null
}
