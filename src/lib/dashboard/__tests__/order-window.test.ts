/**
 * @jest-environment node
 *
 * B-2026-10-26-08: the dashboard's first render and its 30-second poll show
 * the same bounded window of orders (the newest DASHBOARD_ORDER_LIMIT by
 * last update, or those before a ?before= cursor), and say when the list was
 * cut, with a link to the older orders.
 */

import { DASHBOARD_ORDER_LIMIT, olderOrdersHref, parseBefore, windowOrders } from '../order-window'

const at = (n: number) => `2026-10-${String(10 + Math.floor(n / 24)).padStart(2, '0')}T${String(n % 24).padStart(2, '0')}:00:00.123456+00:00`
// Newest first, as both reads order them.
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, updatedAt: at(400 - i) }))

describe('the bound', () => {
  it('is 1000 orders', () => {
    expect(DASHBOARD_ORDER_LIMIT).toBe(1000)
  })
})

describe('windowOrders', () => {
  it('fewer than the limit: every row, not cut', () => {
    const w = windowOrders(rows(5), null, 10)
    expect(w.rows.map(r => r.id)).toEqual(['o0', 'o1', 'o2', 'o3', 'o4'])
    expect(w.window).toEqual({ limit: 10, truncated: false, before: null, olderBefore: null })
  })

  it('exactly the limit: every row, not cut', () => {
    expect(windowOrders(rows(10), null, 10).window.truncated).toBe(false)
  })

  it('more than the limit: the newest `limit` rows, cut, with the oldest shown as the next cursor', () => {
    const w = windowOrders(rows(12), null, 10)
    expect(w.rows).toHaveLength(10)
    expect(w.rows[0]!.id).toBe('o0')
    expect(w.window).toEqual({ limit: 10, truncated: true, before: null, olderBefore: rows(12)[9]!.updatedAt })
  })

  it('with a cursor: only rows last updated before it', () => {
    const all = rows(12)
    const w = windowOrders(all, all[9]!.updatedAt, 10)
    expect(w.rows.map(r => r.id)).toEqual(['o10', 'o11'])
    expect(w.window).toEqual({ limit: 10, truncated: false, before: all[9]!.updatedAt, olderBefore: null })
  })
})

describe('parseBefore', () => {
  it('keeps a timestamp as given (microseconds and offset included)', () => {
    expect(parseBefore('2026-10-20T08:00:00.123456+00:00')).toBe('2026-10-20T08:00:00.123456+00:00')
    expect(parseBefore('2026-10-20T08:00:00Z')).toBe('2026-10-20T08:00:00Z')
  })

  it('anything else is no cursor', () => {
    for (const v of [undefined, null, '', 'yesterday', '2026-13-45T99:00:00Z', ['2026-10-20T08:00:00Z'], "2026-10-20T08:00:00Z'); drop", 42]) {
      expect(parseBefore(v)).toBeNull()
    }
  })
})

describe('olderOrdersHref', () => {
  it('keeps the view and tab, and sets before', () => {
    const href = olderOrdersHref(new URLSearchParams('view=clinic&tab=shipped&order=x'), '2026-10-20T08:00:00.123456+00:00')
    const u = new URL(href, 'https://app.test')
    expect(u.pathname).toBe('/dashboard')
    expect(u.searchParams.get('view')).toBe('clinic')
    expect(u.searchParams.get('tab')).toBe('shipped')
    expect(u.searchParams.get('before')).toBe('2026-10-20T08:00:00.123456+00:00')
    expect(u.searchParams.has('order')).toBe(false)
  })

  it('null clears the cursor (back to the most recent)', () => {
    const u = new URL(olderOrdersHref(new URLSearchParams('view=clinic&before=x'), null), 'https://app.test')
    expect(u.searchParams.has('before')).toBe(false)
    expect(u.searchParams.get('view')).toBe('clinic')
  })
})
