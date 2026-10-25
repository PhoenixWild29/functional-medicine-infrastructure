/**
 * @jest-environment node
 *
 * Requirement 19 (coverage audit, D-2026-10-25-05): Gina Rooks asked for
 * "a frequently used section ... with the ability to then convert it to a
 * favorite". The section was "Recent", the last 8 formulations by date.
 * It is now the provider's most-ordered formulation + dose combinations
 * over the last 90 days, ranked by count, ties by most recent; with none
 * in the window it falls back to recent, in the same shape.
 */

import {
  FREQUENT_LIMIT,
  FREQUENT_WINDOW_DAYS,
  frequentItemKey,
  frequentlyUsed,
  type RecentOrderRow,
} from '../favorite-presets'

const NOW = new Date('2026-10-25T12:00:00Z')
const daysAgo = (d: number, hour = 12) => new Date(NOW.getTime() - d * 86_400_000 + (hour - 12) * 3_600_000).toISOString()

function row(formulation: string, dose: string | null, created: string, pharmacy: string | null = 'ph-strive', freq = 'QW'): RecentOrderRow {
  return {
    formulation_id: formulation,
    pharmacy_id:    pharmacy,
    created_at:     created,
    medication_snapshot: { medication_name: `Drug ${formulation}`, ...(dose ? { prescribed_dose: dose, frequency_code: freq } : {}) },
  }
}

describe('frequentlyUsed', () => {
  it('ranks formulation + dose combinations in the window by how often they were ordered', () => {
    const rows = [
      row('f-sema', '10 units', daysAgo(1)),
      row('f-bpc', '250 mcg', daysAgo(2), 'ph-strive', 'QD'),
      row('f-sema', '10 units', daysAgo(5)),
      row('f-sema', '20 units', daysAgo(3)),
      row('f-sema', '10 units', daysAgo(30)),
      row('f-bpc', '250 mcg', daysAgo(40), 'ph-strive', 'QD'),
    ]
    const result = frequentlyUsed(rows, NOW)
    expect(result.mode).toBe('frequent')
    expect(result.window_days).toBe(90)
    expect(result.items.map(i => [i.formulation_id, i.preset?.dose, i.use_count])).toEqual([
      ['f-sema', '10', 3],
      ['f-bpc', '250', 2],
      ['f-sema', '20', 1],
    ])
    // The most recent order of the combination dates it.
    expect(result.items[0]!.last_prescribed_at).toBe(daysAgo(1))
    expect(result.items[0]!.medication_name).toBe('Drug f-sema')
  })

  it('a tie is broken by the most recent order', () => {
    const rows = [
      row('f-old', '1 mL', daysAgo(20)),
      row('f-old', '1 mL', daysAgo(10)),
      row('f-new', '2 mL', daysAgo(8)),
      row('f-new', '2 mL', daysAgo(2)),
    ]
    expect(frequentlyUsed(rows, NOW).items.map(i => i.formulation_id)).toEqual(['f-new', 'f-old'])
  })

  it('the same dose at another pharmacy, or another frequency, is its own combination', () => {
    const rows = [
      row('f-sema', '10 units', daysAgo(1), 'ph-strive'),
      row('f-sema', '10 units', daysAgo(2), 'ph-quick'),
      row('f-sema', '10 units', daysAgo(3), 'ph-strive', 'QD'),
    ]
    const items = frequentlyUsed(rows, NOW).items
    expect(items).toHaveLength(3)
    expect(new Set(items.map(frequentItemKey)).size).toBe(3)
  })

  it('only orders in the last 90 days count; older ones do not', () => {
    const rows = [
      row('f-a', '1 mL', daysAgo(89)),
      row('f-b', '1 mL', daysAgo(91)),
      row('f-b', '1 mL', daysAgo(120)),
      row('f-b', '1 mL', daysAgo(200)),
    ]
    const result = frequentlyUsed(rows, NOW)
    expect(FREQUENT_WINDOW_DAYS).toBe(90)
    expect(result.mode).toBe('frequent')
    expect(result.items.map(i => [i.formulation_id, i.use_count])).toEqual([['f-a', 1]])
  })

  it('at most FREQUENT_LIMIT (8) entries', () => {
    const rows = Array.from({ length: 12 }, (_, n) => row(`f-${n}`, '1 mL', daysAgo(n + 1)))
    expect(FREQUENT_LIMIT).toBe(8)
    expect(frequentlyUsed(rows, NOW).items).toHaveLength(8)
  })

  it('an order with no structured dose is its own combination, with no preset', () => {
    const items = frequentlyUsed([row('f-bpc', null, daysAgo(1)), row('f-bpc', null, daysAgo(2))], NOW).items
    expect(items).toEqual([expect.objectContaining({ formulation_id: 'f-bpc', preset: null, use_count: 2 })])
  })

  it('nothing in the window: falls back to recent (newest first), same shape, counted over the scanned orders', () => {
    const rows = [
      row('f-a', '1 mL', daysAgo(100)),
      row('f-b', '2 mL', daysAgo(95)),
      row('f-a', '1 mL', daysAgo(150)),
    ]
    const result = frequentlyUsed(rows, NOW)
    expect(result.mode).toBe('recent')
    expect(result.items.map(i => [i.formulation_id, i.use_count, i.last_prescribed_at])).toEqual([
      ['f-b', 1, daysAgo(95)],
      ['f-a', 2, daysAgo(100)],
    ])
  })

  it('no orders at all: an empty frequent section', () => {
    expect(frequentlyUsed([], NOW)).toEqual({ mode: 'frequent', window_days: 90, items: [] })
  })

  it('rows without a formulation are ignored', () => {
    expect(frequentlyUsed([{ ...row('x', '1 mL', daysAgo(1)), formulation_id: null }], NOW).items).toEqual([])
  })
})
