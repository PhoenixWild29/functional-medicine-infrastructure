// ============================================================
// Pharmacy portal status text -> order status (decision 10, poll fix A)
// ============================================================
//
// The portal status poll (cron/portal-status-poll) reads a status text
// from a Tier 2 pharmacy portal. It used to map that text to
// PHARMACY_READY, which is not a status, and to ask for moves the state
// machine refuses (for example PHARMACY_ACKNOWLEDGED straight to SHIPPED),
// so Tier 2 orders never advanced past PHARMACY_PROCESSING
// (docs/decisions/before-real-patients-2026-10-25.md, item 10).
//
// Now:
//   - portalStatusTarget maps the text to a real status;
//   - portalSteps finds the legal steps to it in VALID_TRANSITIONS,
//     within the pharmacy statuses only and forward only, so the poll can
//     take each with casTransition.
//
// "Delivered" maps to SHIPPED: SHIPPED is terminal and nothing moves an
// order to DELIVERED. "Rejected" and "cancelled" map to PHARMACY_REJECTED:
// a pharmacy cannot cancel an order, and ops then reroute or refund it.
//
// Plain module: no I/O.

import { VALID_TRANSITIONS, type OrderStatus } from '@/lib/orders/state-machine'

/** In order: the first phrase the text contains wins. */
const PORTAL_TEXT: ReadonlyArray<readonly [phrase: string, status: OrderStatus]> = [
  ['rejected',         'PHARMACY_REJECTED'],
  ['cancelled',        'PHARMACY_REJECTED'],
  ['canceled',         'PHARMACY_REJECTED'],
  ['delivered',        'SHIPPED'],
  ['out for delivery', 'SHIPPED'],
  ['shipped',          'SHIPPED'],
  ['ready',            'READY_TO_SHIP'],
  ['compounding',      'PHARMACY_COMPOUNDING'],
  ['processing',       'PHARMACY_PROCESSING'],
  ['order received',   'PHARMACY_ACKNOWLEDGED'],
]

/** The statuses a portal poll may move an order between. */
const PHARMACY_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'PHARMACY_ACKNOWLEDGED', 'PHARMACY_PROCESSING', 'PHARMACY_COMPOUNDING',
  'READY_TO_SHIP', 'SHIPPED', 'PHARMACY_REJECTED',
])

/**
 * When a step must be filled in (the portal skipped it), the generic one:
 * PHARMACY_PROCESSING, not PHARMACY_COMPOUNDING, which only the portal's
 * own "compounding" text claims.
 */
const STEP_PREFERENCE: readonly OrderStatus[] = ['PHARMACY_PROCESSING']
const preferred = (a: OrderStatus, b: OrderStatus) =>
  (STEP_PREFERENCE.includes(a) ? 0 : 1) - (STEP_PREFERENCE.includes(b) ? 0 : 1)

export function portalStatusTarget(rawText: string): OrderStatus | null {
  const text = rawText.toLowerCase().trim()
  if (!text) return null
  for (const [phrase, status] of PORTAL_TEXT) if (text.includes(phrase)) return status
  return null
}

/**
 * The legal steps from `current` to `target` (shortest path through
 * VALID_TRANSITIONS, pharmacy statuses only). Empty when already there,
 * backwards, not reachable, or when either end is not a pharmacy status.
 */
export function portalSteps(current: OrderStatus, target: OrderStatus): OrderStatus[] {
  if (current === target || !PHARMACY_STATUSES.has(current) || !PHARMACY_STATUSES.has(target)) return []
  const previous = new Map<OrderStatus, OrderStatus>()
  const queue: OrderStatus[] = [current]
  const seen = new Set<OrderStatus>([current])
  while (queue.length) {
    const at = queue.shift()!
    for (const next of [...VALID_TRANSITIONS[at]].sort(preferred)) {
      if (!PHARMACY_STATUSES.has(next) || seen.has(next)) continue
      seen.add(next)
      previous.set(next, at)
      if (next === target) {
        const path: OrderStatus[] = [target]
        for (let s = at; s !== current; s = previous.get(s)!) path.unshift(s)
        return path
      }
      queue.push(next)
    }
  }
  return []
}
