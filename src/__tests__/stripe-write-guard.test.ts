/**
 * @jest-environment node
 *
 * #194: every Stripe write goes through the PHI guard. withPhiGuard only
 * wraps the operations named in GUARDED_OPS; a write on any other
 * resource or method (stripe.transfers.create, stripe.paymentIntents.capture)
 * would reach Stripe unchecked. This scans every source file for Stripe
 * write calls and fails on any whose "resource.method" is not guarded.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { findStripeWriteCalls } from '@/lib/stripe/write-calls'
import { GUARDED_OPS } from '@/lib/stripe/phi-guard'

const ROOT = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '__type-checks__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full)
  }
  return out
}

describe('the scanner', () => {
  it('finds writes on a stripe variable and on createStripeClient(), across lines', () => {
    const src = `
      const stripe = createStripeClient()
      await stripe.transfers.create({ amount: 1 })
      await stripe
        .paymentIntents
        .capture(id)
      await createStripeClient().payouts.create({ amount: 1 })
      const sc = createStripeClient()
      await sc.subscriptions.update(id, {})
      await stripe.checkout.sessions.create({})
    `
    expect(findStripeWriteCalls(src).sort()).toEqual([
      'checkout.sessions.create', 'paymentIntents.capture', 'payouts.create', 'subscriptions.update', 'transfers.create',
    ])
  })

  it('ignores reads, webhook verification and comments', () => {
    const src = `
      await stripe.paymentIntents.retrieve(id)
      await stripe.refunds.list({})
      await stripe.charges.search({ query: '' })
      stripe.webhooks.constructEvent(body, sig, secret)
      // stripe.transfers.create({})
      /* stripe.payouts.create({}) */
    `
    expect(findStripeWriteCalls(src)).toEqual([])
  })

  it('does not treat unrelated objects as Stripe', () => {
    expect(findStripeWriteCalls(`await supabase.storage.from('x').upload(a)\nawait db.orders.update({})`)).toEqual([])
  })
})

it('every Stripe write in src is in GUARDED_OPS', () => {
  const unguarded: string[] = []
  for (const file of walk(join(ROOT, 'src'))) {
    for (const op of findStripeWriteCalls(readFileSync(file, 'utf8'))) {
      if (!(op in GUARDED_OPS)) unguarded.push(`${relative(ROOT, file).split('\\').join('/')}: ${op}`)
    }
  }
  expect(unguarded).toEqual([])
})

it('the scan sees the writes we know about (it is not vacuous)', () => {
  const ops = new Set<string>()
  for (const file of walk(join(ROOT, 'src'))) for (const op of findStripeWriteCalls(readFileSync(file, 'utf8'))) ops.add(op)
  expect([...ops]).toEqual(expect.arrayContaining(['paymentIntents.create', 'paymentIntents.cancel', 'refunds.create', 'accounts.create', 'accountLinks.create']))
})
