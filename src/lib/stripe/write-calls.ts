// ============================================================
// Stripe write-call scanner (#194)
// ============================================================
//
// Used by the static test src/__tests__/stripe-write-guard.test.ts to
// prove every Stripe write in the source is one withPhiGuard wraps
// (GUARDED_OPS in ./phi-guard.ts). Pure text scan, no runtime use.
//
// A call is a Stripe call when its receiver is createStripeClient() or an
// identifier that names Stripe (contains "stripe", any case) or was
// assigned from createStripeClient() in the same file. It is a write
// unless the method is a read (retrieve*, list*, search*) or the resource
// is webhooks (signature checks run locally). Returns "resource.method"
// keys as GUARDED_OPS spells them, e.g. "paymentIntents.create".

const READ_METHOD = /^(retrieve|list|search)/

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

export function findStripeWriteCalls(source: string): string[] {
  // Join chains split across lines: "stripe\n  .refunds\n  .create(".
  const src = stripComments(source).replace(/\s*\.\s*(?=[A-Za-z_$])/g, '.')

  const stripeNames = new Set<string>()
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:await\s+)?createStripeClient\(\)/g)) {
    stripeNames.add(m[1]!)
  }
  const isStripe = (receiver: string) =>
    receiver === 'createStripeClient()' || /stripe/i.test(receiver) || stripeNames.has(receiver)

  const found: string[] = []
  for (const m of src.matchAll(/(createStripeClient\(\)|\b[A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*){2,3})\s*\(/g)) {
    const receiver = m[1]!
    if (!isStripe(receiver)) continue
    const path = m[2]!.slice(1).split('.')
    const method = path[path.length - 1]!
    if (path[0] === 'webhooks' || READ_METHOD.test(method)) continue
    found.push(path.join('.'))
  }
  return found
}
