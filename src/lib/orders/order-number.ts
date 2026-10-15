// ============================================================
// A short, readable order number for lists (display only)
// ============================================================
//
// The first 8 characters of an order's UUID ("d1000000…") did not tell
// seeded orders apart: they share a prefix. Lists show the first 4 and
// the last 4 characters instead ("d100…0001"), with the full ID beside it
// as a tooltip. The ID itself, in URLs and APIs, is unchanged.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function orderDisplayNumber(orderId: string): string {
  if (!UUID.test(orderId)) return orderId
  return `${orderId.slice(0, 4)}…${orderId.slice(-4)}`
}
