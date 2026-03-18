// ============================================================
// Tier 3 OpenAPI 3.1 Specification — WO-21
// GET /api/spec/v1/openapi
// ============================================================
//
// REQ-SPC-001: Publishes the versioned CompoundIQ Pharmacy API spec
// that Tier 3 pharmacies implement to achieve Tier 1-equivalent
// integration quality without bespoke adapter development.
//
// AC-SPC-001.1: Defines 5 canonical endpoints:
//   POST /v1/orders            — submit new order (pharmacy-side)
//   GET  /v1/orders/{orderId}  — order status    (pharmacy-side)
//   POST /v1/orders/{orderId}/cancel — cancel    (pharmacy-side)
//   GET  /v1/catalog           — catalog sync    (pharmacy-side)
//   POST /v1/webhooks/register — webhook reg     (CompoundIQ-side)
//
// AC-SPC-001.4: Documents 7 canonical webhook event types.
// AC-SPC-001.5: Documents OAuth 2.0 and API key auth schemes.
//
// Public endpoint — no auth required (read-only spec document).
// Cache-Control set to allow CDN caching (spec rarely changes).

import { NextResponse } from 'next/server'

// Current published spec version (AC-SPC-003.1: major.minor scheme)
const SPEC_VERSION = 'v1.0'
const SPEC_PUBLISHED_DATE = '2026-03-18'

// ── Webhook event types (AC-SPC-001.4) ──────────────────────
const WEBHOOK_EVENT_TYPES = [
  'order.acknowledged',
  'order.compounding',
  'order.ready',
  'order.shipped',
  'order.delivered',
  'order.rejected',
  'order.cancelled',
] as const

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'CompoundIQ Tier 3 Pharmacy API',
    version: SPEC_VERSION,
    description: [
      'The CompoundIQ Tier 3 Pharmacy API is a published, versioned specification',
      'that pharmacies implement to achieve Tier 1-equivalent integration quality.',
      'Any pharmacy implementing this spec is automatically compatible with the',
      'CompoundIQ adapter layer with no bespoke development required.',
      '',
      `Published: ${SPEC_PUBLISHED_DATE}`,
      `Backward compatibility guaranteed until: 2027-03-18 (12-month window, REQ-SPC-003)`,
      '',
      'Non-breaking additions (new optional fields, new optional endpoints) may be',
      'added at any time. Breaking changes require a major version increment.',
    ].join('\n'),
    contact: {
      name: 'CompoundIQ Integration Team',
      email: 'integrations@compoundiq.com',
    },
  },

  // ── Server placeholder — each pharmacy uses their own base URL ──
  servers: [
    {
      url: 'https://{pharmacyApiHost}',
      description: 'Pharmacy API host (set per-pharmacy in pharmacy_api_configs.base_url)',
      variables: {
        pharmacyApiHost: {
          default: 'api.yourpharmacy.com',
          description: 'The pharmacy\'s API base URL',
        },
      },
    },
    {
      url: 'https://app.compoundiq.com',
      description: 'CompoundIQ host (for CompoundIQ-side endpoints such as /v1/webhooks/register)',
    },
  ],

  // ── Auth schemes (AC-SPC-001.5) ─────────────────────────────
  components: {
    securitySchemes: {
      oauth2ClientCredentials: {
        type: 'oauth2',
        description: 'Primary auth method. CompoundIQ uses client_credentials grant to obtain a bearer token before submitting orders.',
        flows: {
          clientCredentials: {
            tokenUrl: 'https://{pharmacyApiHost}/v1/oauth/token',
            scopes: {
              'order:write': 'Submit and cancel orders',
              'catalog:read': 'Read pharmacy catalog',
            },
          },
        },
      },
      apiKeyBearer: {
        type: 'http',
        scheme: 'bearer',
        description: 'Fallback auth for pharmacies that cannot implement OAuth 2.0. Long-lived API key sent as Bearer token. Stored in pharmacy_api_configs with auth_type = api_key.',
      },
    },

    schemas: {
      // ── Order submission request ─────────────────────────
      OrderSubmitRequest: {
        type: 'object',
        required: [
          'orderId', 'providerFirstName', 'providerLastName', 'providerNpi',
          'providerLicenseState', 'patientFirstName', 'patientLastName',
          'patientDateOfBirth', 'medicationName', 'medicationForm',
          'medicationDose', 'quantity', 'clinicName',
        ],
        properties: {
          orderId:              { type: 'string', format: 'uuid', description: 'CompoundIQ order UUID' },
          orderNumber:          { type: 'string', nullable: true, description: 'Human-readable order reference' },
          providerFirstName:    { type: 'string' },
          providerLastName:     { type: 'string' },
          providerNpi:          { type: 'string', description: 'Provider NPI (frozen at order lock time)' },
          providerDea:          { type: 'string', nullable: true },
          providerLicenseState: { type: 'string', minLength: 2, maxLength: 2 },
          patientFirstName:     { type: 'string' },
          patientLastName:      { type: 'string' },
          patientDateOfBirth:   { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
          patientAddressLine1:  { type: 'string', nullable: true },
          patientAddressLine2:  { type: 'string', nullable: true },
          patientCity:          { type: 'string', nullable: true },
          patientState:         { type: 'string', nullable: true },
          patientZip:           { type: 'string', nullable: true },
          medicationName:       { type: 'string' },
          medicationForm:       { type: 'string' },
          medicationDose:       { type: 'string' },
          quantity:             { type: 'number' },
          sigText:              { type: 'string', nullable: true },
          clinicName:           { type: 'string' },
        },
      },

      // ── Standard success response ────────────────────────
      OrderSubmitResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            required: ['orderId'],
            properties: {
              orderId: {
                type: 'string',
                description: 'Pharmacy\'s internal reference ID for this order',
                example: 'rx-2026-00142',
              },
            },
          },
        },
      },

      // ── Error response ───────────────────────────────────
      ErrorResponse: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code:    { type: 'string', example: 'DRUG_UNAVAILABLE' },
              message: { type: 'string', example: 'Requested compound is not available at this pharmacy' },
            },
          },
        },
      },

      // ── Order status response ────────────────────────────
      OrderStatusResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            required: ['orderId', 'status'],
            properties: {
              orderId: { type: 'string' },
              status: {
                type: 'string',
                enum: ['acknowledged', 'compounding', 'ready', 'shipped', 'delivered', 'rejected', 'cancelled'],
              },
              trackingNumber: { type: 'string', nullable: true },
              estimatedDelivery: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        },
      },

      // ── Catalog item ─────────────────────────────────────
      CatalogItem: {
        type: 'object',
        required: ['itemId', 'name', 'form', 'isAvailable'],
        properties: {
          itemId:       { type: 'string' },
          name:         { type: 'string' },
          form:         { type: 'string' },
          strength:     { type: 'string', nullable: true },
          isAvailable:  { type: 'boolean' },
          leadTimeDays: { type: 'integer', nullable: true },
        },
      },

      // ── Webhook event (AC-SPC-001.4) ─────────────────────
      WebhookEvent: {
        type: 'object',
        required: ['event_id', 'event_type', 'order_id', 'occurred_at'],
        properties: {
          event_id:    { type: 'string', format: 'uuid', description: 'Idempotency key — deduplicate on this field' },
          event_type: {
            type: 'string',
            enum: WEBHOOK_EVENT_TYPES,
          },
          order_id:    { type: 'string', format: 'uuid', description: 'CompoundIQ order UUID' },
          occurred_at: { type: 'string', format: 'date-time' },
          data:        { type: 'object', description: 'Event-specific payload fields' },
        },
      },

      // ── Webhook registration request ─────────────────────
      WebhookRegisterRequest: {
        type: 'object',
        required: ['pharmacy_id', 'callback_url', 'event_types', 'secret'],
        properties: {
          pharmacy_id:  { type: 'string', format: 'uuid', description: 'CompoundIQ pharmacy UUID' },
          callback_url: {
            type: 'string',
            format: 'uri',
            description: 'HTTPS URL where CompoundIQ will POST webhook events. HTTP URLs are rejected.',
            example: 'https://api.yourpharmacy.com/webhooks/compoundiq',
          },
          event_types: {
            type: 'array',
            items: { type: 'string', enum: WEBHOOK_EVENT_TYPES },
            description: 'Subset of canonical event types to receive. Empty array = all events.',
          },
          secret: {
            type: 'string',
            description: 'HMAC-SHA256 signing secret. CompoundIQ will sign outbound webhook payloads with this secret. Store securely.',
            minLength: 32,
          },
        },
      },

      // ── Webhook registration response ────────────────────
      WebhookRegisterResponse: {
        type: 'object',
        required: ['registration_id', 'callback_url', 'event_types', 'registered_at'],
        properties: {
          registration_id: { type: 'string', format: 'uuid' },
          callback_url:    { type: 'string' },
          event_types:     { type: 'array', items: { type: 'string' } },
          registered_at:   { type: 'string', format: 'date-time' },
        },
      },
    },
  },

  // ── Security (applies to all pharmacy-side endpoints) ───────
  security: [
    { oauth2ClientCredentials: ['order:write', 'catalog:read'] },
    { apiKeyBearer: [] },
  ],

  // ── Paths ────────────────────────────────────────────────────
  paths: {

    // ── POST /v1/orders — AC-SPC-001.1 ───────────────────────
    '/v1/orders': {
      post: {
        operationId: 'submitOrder',
        summary: 'Submit a new compounded prescription order',
        description: 'CompoundIQ calls this endpoint to submit a new order to the pharmacy. The pharmacy queues it for compounding and returns its internal reference ID.',
        tags: ['Orders'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OrderSubmitRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Order accepted by pharmacy',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderSubmitResponse' },
              },
            },
          },
          '201': {
            description: 'Order accepted (alternate success status)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderSubmitResponse' },
              },
            },
          },
          '422': {
            description: 'Order rejected by pharmacy (non-retriable — e.g. drug unavailable)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '500': {
            description: 'Transient server error — CompoundIQ will retry with exponential backoff',
          },
        },
      },
    },

    // ── GET /v1/orders/{orderId} — AC-SPC-001.1 ──────────────
    '/v1/orders/{orderId}': {
      get: {
        operationId: 'getOrderStatus',
        summary: 'Retrieve current order status',
        tags: ['Orders'],
        parameters: [
          {
            name: 'orderId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The pharmacy\'s internal order reference ID (returned from submitOrder)',
          },
        ],
        responses: {
          '200': {
            description: 'Order status',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderStatusResponse' },
              },
            },
          },
          '404': {
            description: 'Order not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },

    // ── POST /v1/orders/{orderId}/cancel — AC-SPC-001.1 ──────
    '/v1/orders/{orderId}/cancel': {
      post: {
        operationId: 'cancelOrder',
        summary: 'Cancel a pending order',
        description: 'CompoundIQ calls this to cancel an order before it is dispensed. Orders already in compounding or shipped cannot be cancelled.',
        tags: ['Orders'],
        parameters: [
          {
            name: 'orderId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Order cancelled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
          '409': {
            description: 'Order cannot be cancelled (already compounding, shipped, or delivered)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          '404': {
            description: 'Order not found',
          },
        },
      },
    },

    // ── GET /v1/catalog — AC-SPC-001.1 ───────────────────────
    '/v1/catalog': {
      get: {
        operationId: 'getCatalog',
        summary: 'Retrieve pharmacy catalog for bulk sync',
        description: 'Returns the full list of compoundable medications and their availability. CompoundIQ syncs this periodically to validate orders before submission.',
        tags: ['Catalog'],
        parameters: [
          {
            name: 'updated_after',
            in: 'query',
            required: false,
            schema: { type: 'string', format: 'date-time' },
            description: 'If provided, only return items updated after this timestamp (for incremental sync)',
          },
        ],
        responses: {
          '200': {
            description: 'Catalog items',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['success', 'data'],
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        items:     { type: 'array', items: { $ref: '#/components/schemas/CatalogItem' } },
                        total:     { type: 'integer' },
                        synced_at: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ── POST /v1/webhooks/register — AC-SPC-001.1, REQ-SPC-004 ──
    // NOTE: This endpoint is hosted by CompoundIQ, not the pharmacy.
    // Pharmacies call this to register their webhook callback URL.
    '/v1/webhooks/register': {
      post: {
        operationId: 'registerWebhook',
        summary: 'Register pharmacy webhook callback URL',
        description: [
          'Pharmacies call this CompoundIQ-hosted endpoint to register the callback URL',
          'where CompoundIQ will POST webhook events.',
          '',
          'Server: https://app.compoundiq.com (CompoundIQ-side)',
          '',
          'HMAC signing: CompoundIQ will sign all outbound webhook payloads using',
          'HMAC-SHA256 with the provided secret. Verify the X-CompoundIQ-Signature header',
          'on all incoming webhooks.',
        ].join('\n'),
        tags: ['Webhooks'],
        'x-server': 'https://app.compoundiq.com',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WebhookRegisterRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Webhook registered successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WebhookRegisterResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid request (non-HTTPS callback_url, missing fields)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(spec, {
    status: 200,
    headers: {
      // Allow CDN/browser caching for 1 hour; spec rarely changes
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      'Content-Type': 'application/json',
    },
  })
}

// Return 405 for all non-GET methods
export function POST()   { return new NextResponse(null, { status: 405 }) }
export function PUT()    { return new NextResponse(null, { status: 405 }) }
export function PATCH()  { return new NextResponse(null, { status: 405 }) }
export function DELETE() { return new NextResponse(null, { status: 405 }) }
