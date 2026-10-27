/**
 * @jest-environment node
 *
 * The Tier 3 OpenAPI documents what quantity means and the unit that
 * travels with it (C's review, rx-quantity-shipping): counted forms send
 * the units dispensed, measured forms the containers.
 */

import { GET } from '../route'

interface Prop { type?: string; description?: string; enum?: string[] }

async function orderSchema(): Promise<{ required: string[]; properties: Record<string, Prop> }> {
  const spec = await (await GET()).json() as { components: { schemas: { OrderSubmitRequest: { required: string[]; properties: Record<string, Prop> } } } }
  return spec.components.schemas.OrderSubmitRequest
}

describe('OpenAPI OrderSubmitRequest: quantity and quantityUnit', () => {
  it('quantity says what it counts', async () => {
    const s = await orderSchema()
    expect(s.properties['quantity']!.type).toBe('number')
    expect(s.properties['quantity']!.description).toMatch(/units dispensed/i)
    expect(s.properties['quantity']!.description).toMatch(/containers/i)
  })

  it('quantityUnit is documented and required, with the unit names', async () => {
    const s = await orderSchema()
    expect(s.required).toContain('quantityUnit')
    expect(s.properties['quantityUnit']!.type).toBe('string')
    expect(s.properties['quantityUnit']!.description).toMatch(/capsule/)
    expect(s.properties['quantityUnit']!.description).toMatch(/vial/)
  })
})
