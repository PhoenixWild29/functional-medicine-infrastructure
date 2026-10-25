// ============================================================
// Tier 3 webhook event types (AC-SPC-001.4)
// ============================================================
//
// The closed list a Tier 3 pharmacy may subscribe to. The OpenAPI spec
// documents it (GET /api/spec/v1/openapi) and webhook registration
// (POST /api/spec/v1/webhooks/register) accepts only these.

export const WEBHOOK_EVENT_TYPES = [
  'order.acknowledged',
  'order.compounding',
  'order.ready',
  'order.shipped',
  'order.delivered',
  'order.rejected',
  'order.cancelled',
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]
