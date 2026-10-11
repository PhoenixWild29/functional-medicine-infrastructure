// ============================================================
// Stripe PHI guard — compliance item C7
// ============================================================
//
// Stripe does not sign a HIPAA BAA, so nothing we send it may identify a
// patient's health information: no drug, dose, patient name, DOB,
// address, phone, email, diagnosis, clinic specialty, and not the word
// "prescription". Every Stripe write goes through guardStripeParams(),
// applied by createStripeClient() in ./client.ts, which is the only place
// the SDK is constructed (pinned by src/__tests__/stripe-phi-static-guard).
//
// Allow-lists, not deny-lists:
//   - top-level fields: per call, exactly what that call needs;
//   - metadata: opaque ids (UUIDs) and the platform tag, nothing else;
//   - description: a fixed set of neutral strings.
//
// A violation THROWS outside production (dev, tests, CI) so it can never
// ship. In production it is logged with key names only (never values,
// which may be the PHI itself) and stripped, so a payment is never
// blocked by a stray field.

export const NEUTRAL_DESCRIPTION = 'CompoundIQ order'

export function bundleDescription(itemCount: number): string {
  return `CompoundIQ order bundle (${itemCount} items)`
}

const BUNDLE_DESCRIPTION_RE = /^CompoundIQ order bundle \(\d{1,3} items\)$/

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const METADATA_ALLOWED: Record<string, (value: unknown) => boolean> = {
  order_id:         v => typeof v === 'string' && UUID_RE.test(v),
  payment_group_id: v => typeof v === 'string' && UUID_RE.test(v),
  clinic_id:        v => typeof v === 'string' && UUID_RE.test(v),
  platform:         v => v === '8090ai',
}

interface OpRule {
  /** Position of the params object in the SDK method's arguments. */
  paramIndex: number
  /** Top-level fields this call may send. */
  fields: readonly string[]
  /** Allowed keys inside nested objects that are themselves allowed. */
  nested?: Readonly<Record<string, readonly string[]>>
}

// Every Stripe write this app makes, plus the customer and charge writes
// it must never make (empty allow-list: any field is a violation).
export const GUARDED_OPS: Readonly<Record<string, OpRule>> = {
  'paymentIntents.create': {
    paramIndex: 0,
    fields: ['amount', 'currency', 'application_fee_amount', 'transfer_data', 'metadata', 'description', 'automatic_payment_methods'],
    nested: { transfer_data: ['destination'], automatic_payment_methods: ['enabled'] },
  },
  'paymentIntents.update': { paramIndex: 1, fields: ['metadata', 'description'] },
  'paymentIntents.cancel': { paramIndex: 1, fields: ['cancellation_reason'] },
  'refunds.create': {
    paramIndex: 0,
    fields: ['payment_intent', 'amount', 'reverse_transfer', 'refund_application_fee', 'metadata'],
  },
  // Payment Flow v1.1: unwinding a refund issued from the Stripe Dashboard
  // without reverse_transfer (the webhook reverses it proportionally).
  'transfers.createReversal':     { paramIndex: 1, fields: ['amount'] },
  'applicationFees.createRefund': { paramIndex: 1, fields: ['amount'] },
  'accounts.create':     { paramIndex: 0, fields: ['type', 'metadata'] },
  'accountLinks.create': { paramIndex: 0, fields: ['account', 'refresh_url', 'return_url', 'type'] },
  'customers.create':    { paramIndex: 0, fields: [] },
  'customers.update':    { paramIndex: 1, fields: [] },
  'charges.update':      { paramIndex: 1, fields: [] },
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isAllowedDescription(v: unknown): boolean {
  return v === NEUTRAL_DESCRIPTION || (typeof v === 'string' && BUNDLE_DESCRIPTION_RE.test(v))
}

/**
 * Check (and in production, clean) the params of one Stripe write.
 * Returns the params to send. Never mutates the input.
 */
export function guardStripeParams<T>(op: string, params: T): T {
  if (params === undefined || params === null) return params

  const rule = GUARDED_OPS[op]
  const violations: string[] = []
  const out: Record<string, unknown> = {}

  if (!rule) {
    violations.push('unguarded operation')
  } else if (!isPlainObject(params)) {
    violations.push('params are not an object')
  } else {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      if (!rule.fields.includes(key)) {
        violations.push(`field "${key}" not allowed`)
        continue
      }

      if (key === 'metadata') {
        const clean: Record<string, unknown> = {}
        if (isPlainObject(value)) {
          for (const [mk, mv] of Object.entries(value)) {
            const check = METADATA_ALLOWED[mk]
            if (!check) violations.push(`metadata key "${mk}" not allowed`)
            else if (!check(mv)) violations.push(`metadata value for "${mk}" is not an opaque id`)
            else clean[mk] = mv
          }
        } else {
          violations.push('metadata is not an object')
        }
        out[key] = clean
        continue
      }

      if (key === 'description') {
        if (isAllowedDescription(value)) {
          out[key] = value
        } else {
          violations.push('description not on the allow-list')
          out[key] = NEUTRAL_DESCRIPTION
        }
        continue
      }

      const nestedAllowed = rule.nested?.[key]
      if (nestedAllowed && isPlainObject(value)) {
        const clean: Record<string, unknown> = {}
        for (const [nk, nv] of Object.entries(value)) {
          if (nestedAllowed.includes(nk)) clean[nk] = nv
          else violations.push(`field "${key}.${nk}" not allowed`)
        }
        out[key] = clean
        continue
      }

      out[key] = value
    }
  }

  if (violations.length === 0) return params

  const message = `[stripe-phi-guard] ${op}: ${violations.join('; ')}`
  if (process.env['NODE_ENV'] !== 'production') {
    throw new Error(message)
  }
  console.error(`${message} (stripped)`)
  if (!rule) throw new Error(message)
  return out as T
}

/**
 * Route every guarded write on a Stripe client through guardStripeParams.
 * Reads (retrieve, list) and webhook verification are untouched.
 */
export function withPhiGuard<S extends object>(stripe: S): S {
  for (const [op, rule] of Object.entries(GUARDED_OPS)) {
    const [resourceName = '', methodName = ''] = op.split('.')
    const resource: unknown = Reflect.get(stripe, resourceName)
    if (typeof resource !== 'object' || resource === null) continue
    const original: unknown = Reflect.get(resource, methodName)
    if (typeof original !== 'function') continue
    Reflect.set(resource, methodName, function guarded(...args: unknown[]) {
      if (rule.paramIndex < args.length) {
        args[rule.paramIndex] = guardStripeParams(op, args[rule.paramIndex])
      }
      return Reflect.apply(original, resource, args)
    })
  }
  return stripe
}
