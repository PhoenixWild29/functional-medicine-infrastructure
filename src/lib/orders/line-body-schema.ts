// ============================================================
// Order line request body: shape and bounds (zod v4)
// ============================================================
//
// POST /api/orders and PATCH /api/orders/[orderId] take the same line
// body. The rules a prescription has to meet (exactly one of catalog /
// formulation, retail >= wholesale, the sig at least 10 characters, the
// rxDetails fields, the cycling pattern, the package count) stay where
// they were, with their own messages: the route checks and
// validateRxDetailsBody, lineSourceKind, cyclePatternFrom and resolveLine.
//
// This schema adds only what those checks never looked at: every id is an
// id (a bad one reaching Postgres is error 22P02, a 500), free text is
// bounded, the sig mode is one of the three, and the lists are bounded.
// An empty or null id passes here so the route's own "Missing required
// fields" answer still applies. Unknown keys pass through.

import { z } from 'zod'
import { UUID_RE, MAX_NAME } from '@/lib/api/input'

/** A Rx sig, titration schedules included (12 steps is well under this). */
export const MAX_SIG_TEXT = 4000
/** $1,000,000.00 a line: far above any compounded prescription. */
export const MAX_RETAIL_CENTS = 100_000_000
/** Far above MAX_TITRATION_STEPS (12): a longer list is still read as no titration. */
export const MAX_TITRATION_STEP_ITEMS = 100
/** rxDetails numbers the DB stores as integer / numeric. */
export const MAX_DAYS_SUPPLY = 36_500
export const MAX_DISPENSE_QUANTITY = 1_000_000

/** An id, or absent ('' and null read as absent). */
const optionalId = z.union([z.string().regex(UUID_RE, 'must be an id'), z.literal(''), z.null()]).optional()

const shortText = z.union([z.string().max(MAX_NAME), z.null()]).optional()

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const titrationStep = z.unknown().refine(
  step => !isObject(step) || ['dose', 'unit', 'frequency'].every(k => typeof step[k] !== 'string' || (step[k] as string).length <= MAX_NAME),
  'step text is too long',
)

export const lineBodySchema = z.looseObject({
  catalogItemId: optionalId,
  formulationId: optionalId,
  pharmacyId:    optionalId,
  packageId:     optionalId,
  // Type and the positive-integer rule: the route's own message.
  retailCents:   z.unknown().refine(v => typeof v !== 'number' || v <= MAX_RETAIL_CENTS, 'too large').optional(),
  // Type and the 10-character minimum: the route's own message.
  sigText:       z.unknown().refine(v => typeof v !== 'string' || v.length <= MAX_SIG_TEXT, 'too long').optional(),
  dose:          shortText,
  frequencyCode: shortText,
  quantityLabel: shortText,
  sigMode:       z.enum(['standard', 'titration', 'cycling']).nullish(),
  titrationSteps: z.array(titrationStep).max(MAX_TITRATION_STEP_ITEMS).nullish(),
  // Field rules and messages: validateRxDetailsBody. Bounds only.
  rxDetails:     z.unknown().refine(
    v => !isObject(v) || (
      (typeof v['daysSupply'] !== 'number' || v['daysSupply'] <= MAX_DAYS_SUPPLY)
      && (typeof v['dispenseQuantity'] !== 'number' || v['dispenseQuantity'] <= MAX_DISPENSE_QUANTITY)
    ),
    'out of range',
  ).optional(),
})

/** POST /api/orders: the line plus who it is for and where it links. */
export const createOrderBodySchema = lineBodySchema.extend({
  patientId:         optionalId,
  providerId:        optionalId,
  protocolId:        optionalId,
  refillOfOrderId:   z.union([z.string().trim().regex(UUID_RE, 'must be an id'), z.literal(''), z.null()]).optional(),
  appendedToOrderId: optionalId,
  patientState:      z.unknown().refine(v => typeof v !== 'string' || v.length <= 8, 'too long').optional(),
})
