// ============================================================
// Controlled substances: never signed or sent through CompoundIQ (C6)
// ============================================================
//
// Testosterone, ketamine and other compounded drugs can be DEA Schedule
// II-V. Several states (PA and TX among them) require a controlled
// substance to be prescribed through certified EPCS: audited electronic
// prescribing with two-factor signing. CompoundIQ is not certified EPCS,
// so a controlled product is shown with CONTROLLED_LABEL and cannot be
// added to a signable order, signed, or sent to a pharmacy.
//
// Where the schedule lives: ingredients.dea_schedule (V3 catalog; null =
// not controlled) and catalog.dea_schedule (legacy; 0 = not controlled).
// A single-ingredient formulation reaches its ingredient through
// salt_forms; a combination through formulation_ingredients. Both are
// read: reading only the second recorded plain Testosterone Cypionate as
// schedule 0. The catalog decides; an order's snapshot can only add to it.
//
// Plain module (no 'use client'): the builder, Review and the server use it.

export const CONTROLLED_LABEL = 'Controlled substance: prescribe through your EPCS system'

/** The PostgREST embed that brings a formulation's ingredient schedules. */
export const FORMULATION_SCHEDULE_SELECT =
  'salt_forms(ingredients(dea_schedule)), formulation_ingredients(ingredients(dea_schedule))'

/** DEA schedules I-V are controlled; 0 and null (none) are not. */
export function isControlledSchedule(schedule: number | null | undefined): boolean {
  return typeof schedule === 'number' && schedule >= 1
}

type IngredientRef = { dea_schedule?: number | null } | null | undefined
type Embedded<T> = T | T[] | null | undefined
const first = <T>(v: Embedded<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

/** A formulation row (with FORMULATION_SCHEDULE_SELECT) → its highest schedule, or null. */
export function scheduleFromFormulationRow(row: {
  salt_forms?: Embedded<{ ingredients?: Embedded<NonNullable<IngredientRef>> }>
  formulation_ingredients?: Array<{ ingredients?: Embedded<NonNullable<IngredientRef>> }> | null
}): number | null {
  const schedules: Array<number | null | undefined> = [first(first(row.salt_forms)?.ingredients)?.dea_schedule]
  for (const fi of row.formulation_ingredients ?? []) schedules.push(first(fi.ingredients)?.dea_schedule)
  let max: number | null = null
  for (const s of schedules) if (typeof s === 'number' && (max === null || s > max)) max = s
  return max
}

/** The message a refused line carries. */
export function controlledRefusal(medicationName: string): string {
  return `${medicationName}: ${CONTROLLED_LABEL}. CompoundIQ cannot sign or send a controlled substance.`
}

export class ControlledSubstanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ControlledSubstanceError'
  }
}

interface QueryClient {
  // Structural: the service client, a scripted test client.
  from: (table: string) => unknown
}

type OrderLine = {
  formulation_id?:      string | null
  catalog_item_id?:     string | null
  medication_snapshot?: unknown
}

/**
 * Is this order's medication controlled? From the catalog (formulation or
 * legacy catalog item) and the snapshot; the higher wins. 'unknown' when
 * the schedule cannot be determined (a read failed, or nothing says):
 * callers refuse that too, never treat it as 0.
 */
export async function orderControlStatus(
  supabase: QueryClient,
  order: OrderLine,
): Promise<'controlled' | 'not_controlled' | 'unknown'> {
  const snap = order.medication_snapshot as { dea_schedule?: unknown } | null | undefined
  const snapshotSchedule = typeof snap?.dea_schedule === 'number' ? snap.dea_schedule : null
  if (isControlledSchedule(snapshotSchedule)) return 'controlled'

  let catalogSchedule: number | null = null
  let catalogKnown = false
  const db = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }> } }
    }
  }
  if (order.formulation_id) {
    const { data, error } = await db.from('formulations')
      .select(`formulation_id, ${FORMULATION_SCHEDULE_SELECT}`)
      .eq('formulation_id', order.formulation_id)
      .maybeSingle()
    if (error) {
      console.error('[controlled-substance] formulation schedule read failed:', error.message, '| formulation=', order.formulation_id)
      return 'unknown'
    }
    if (data) {
      catalogSchedule = scheduleFromFormulationRow(data as Parameters<typeof scheduleFromFormulationRow>[0])
      catalogKnown = true
    }
  } else if (order.catalog_item_id) {
    const { data, error } = await db.from('catalog')
      .select('item_id, dea_schedule')
      .eq('item_id', order.catalog_item_id)
      .maybeSingle()
    if (error) {
      console.error('[controlled-substance] catalog schedule read failed:', error.message, '| item=', order.catalog_item_id)
      return 'unknown'
    }
    if (data) {
      catalogSchedule = (data as { dea_schedule: number | null }).dea_schedule ?? null
      catalogKnown = true
    }
  }

  if (isControlledSchedule(catalogSchedule)) return 'controlled'
  if (catalogKnown || snapshotSchedule !== null) return 'not_controlled'
  return 'unknown'
}

/** Throws ControlledSubstanceError unless the order is known not to be controlled. */
export async function assertNotControlled(supabase: QueryClient, orderId: string, order: OrderLine): Promise<void> {
  const status = await orderControlStatus(supabase, order)
  if (status === 'controlled') {
    throw new ControlledSubstanceError(`Order ${orderId} is a controlled substance; CompoundIQ does not send controlled substances (prescribe through EPCS).`)
  }
  if (status === 'unknown') {
    throw new ControlledSubstanceError(`Order ${orderId}: whether it is a controlled substance could not be determined, so it was not sent.`)
  }
}

/**
 * Adapter-level defence (Tier 1, 2 and 4): read the order's line, then
 * assertNotControlled. A path that reaches an adapter without routeOrder
 * still sends nothing controlled, or nothing it cannot classify.
 */
export async function assertOrderNotControlled(supabase: QueryClient, orderId: string): Promise<void> {
  const db = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: OrderLine | null; error: { message: string } | null }> } }
    }
  }
  const { data, error } = await db.from('orders')
    .select('order_id, formulation_id, catalog_item_id, medication_snapshot')
    .eq('order_id', orderId)
    .maybeSingle()
  if (error || !data) {
    throw new ControlledSubstanceError(`Order ${orderId} could not be read to check for a controlled substance, so it was not sent: ${error?.message ?? 'not found'}`)
  }
  await assertNotControlled(supabase, orderId, data)
}
