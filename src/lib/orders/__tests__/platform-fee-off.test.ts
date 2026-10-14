/**
 * @jest-environment node
 *
 * Decision (Sam, 2026-10): CompoundIQ charges each clinic a flat monthly
 * fee under a signed order form, billed outside the app. The app takes and
 * shows no percentage of margin:
 *
 *   - one config value, PLATFORM_FEE_PCT, is 0; every fee calculation goes
 *     through platformFeeCents(), never a literal 15
 *   - the clinic's payout is the patient price less wholesale and shipping
 *   - the Stripe application fee is only what the platform pays on to the
 *     pharmacy (wholesale + shipping), never a platform share
 *   - new ledger payments write no platform_fee line; a refund of an order
 *     paid under the old fee is split as it was actually recorded
 *   - the Practice numbers and CSV carry no platform fee
 *   - no clinic-facing copy mentions a platform fee or "15%"
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { PLATFORM_FEE_PCT, platformFeeCents, stripeSplit, bundleTotals } from '../shipping'
import { computeOrderSplit } from '@/lib/payments/split'
import { practiceTotals, breakdown, breakdownCsv, type PracticeOrder } from '@/lib/practice/metrics'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '__type-checks__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}
const rel = (p: string) => relative(ROOT, p).split(sep).join('/')
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('one config value, 0', () => {
  it('PLATFORM_FEE_PCT is 0 and platformFeeCents is 0 for any margin', () => {
    expect(PLATFORM_FEE_PCT).toBe(0)
    for (const m of [0, 1, 9500, 1_000_000, -500]) expect(platformFeeCents(m)).toBe(0)
  })

  it('no fee is computed from a literal percentage anywhere in src', () => {
    const offenders: string[] = []
    for (const f of walk(join(ROOT, 'src'))) {
      const code = strip(readFileSync(f, 'utf8'))
      if (/\*\s*15\s*\/\s*100|\*\s*0\.15\b|PLATFORM_FEE_PCT\s*=\s*[1-9]/.test(code)) offenders.push(rel(f))
    }
    expect(offenders).toEqual([])
  })
})

describe('money', () => {
  it('the Stripe application fee is wholesale + shipping only; the clinic keeps the rest', () => {
    expect(stripeSplit({ retailCents: 20000, wholesaleCents: 10000, shippingCents: 900 })).toEqual({ amountCents: 20900, applicationFeeCents: 10900 })
    // The clinic absorbs shipping: the patient is not charged it, the pharmacy is still paid it.
    expect(stripeSplit({ retailCents: 20000, wholesaleCents: 10000, shippingCents: 900, absorbShipping: true })).toEqual({ amountCents: 20000, applicationFeeCents: 10900 })
  })

  it('review / checkout totals: no platform fee; payout = price − wholesale (− shipping when absorbed)', () => {
    const t = bundleTotals([{ retailCents: 19000, wholesaleCents: 9500 }, { retailCents: 13000, wholesaleCents: 6500 }], 2200)
    expect(t.platformFeeCents).toBe(0)
    expect(t.clinicPayoutCents).toBe(32000 - 16000)
    expect(bundleTotals([{ retailCents: 19000, wholesaleCents: 9500 }], 2200, { absorbShipping: true }).clinicPayoutCents).toBe(19000 - 9500 - 2200)
  })

  it('the ledger split for a new payment: no platform share, the parts still sum to the charge', () => {
    const s = computeOrderSplit({ retail_price_snapshot: 200, wholesale_price_snapshot: 100, shipping_fee: 9 }, false)
    expect(s).toEqual({ chargeCents: 20900, platformFeeCents: 0, pharmacyPayableCents: 10900, clinicTransferCents: 10000, wholesaleCents: 10000, shippingCents: 900 })
  })
})

describe('the Practice numbers', () => {
  const order = (over: Partial<PracticeOrder>): PracticeOrder => ({
    orderId: 'a', status: 'DELIVERED', createdAt: '2026-10-01T00:00:00Z', retailCents: 19000, wholesaleCents: 9500, shippingFeeCents: 2200,
    paymentGroupId: null, providerId: 'p1', providerName: 'Sarah Chen', pharmacyId: 'ph', pharmacyName: 'Strive', medicationName: 'Semaglutide', ...over,
  })

  it('payout is revenue less wholesale (and absorbed shipping); no fee is taken', () => {
    const t = practiceTotals([order({})], [], { absorbShipping: false })
    expect(t.platformFeeCents).toBe(0)
    expect(t.clinicPayoutCents).toBe(19000 - 9500)
  })

  it('the CSV has no platform fee column', () => {
    const csv = breakdownCsv(breakdown([order({})], 'provider'), 'provider')
    expect(csv.split('\n')[0]).toBe('Provider,Scripts,Revenue,Wholesale,Margin')
    expect(csv.split('\n')[1]).toBe('Sarah Chen,1,190.00,95.00,95.00')
  })
})

describe('clinic-facing copy', () => {
  it('no clinic page or component mentions a platform fee or a percentage of margin', () => {
    const offenders: string[] = []
    const dirs = [join(ROOT, 'src', 'app', '(clinic-app)'), join(ROOT, 'src', 'components'), join(ROOT, 'src', 'app', 'checkout')]
    for (const d of dirs) {
      for (const f of walk(d).filter(p => p.endsWith('.tsx'))) {
        const code = strip(readFileSync(f, 'utf8'))
        if (/platform fee|15%|% of margin|of margin\)/i.test(code)) offenders.push(rel(f))
      }
    }
    expect(offenders).toEqual([])
  })
})
