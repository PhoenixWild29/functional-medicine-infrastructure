/**
 * @jest-environment node
 *
 * Order status texts read their context (getOrderSmsContext) from orders
 * and its patient, clinic, provider and pharmacy. It selected
 * orders.tracking_url, a column that does not exist (orders has
 * tracking_number and carrier), so Postgres answered "column
 * orders.tracking_url does not exist" and every text that needs the
 * context (payment link, reminders, shipped, delivered) was skipped as
 * order_not_found.
 *
 * The fake database here rejects any column that is not in the generated
 * schema types (src/types/database.types.ts), exactly as PostgREST does
 * (42703). The shipped text now builds the carrier's tracking link from
 * carrier + tracking_number, and sends without a link when the carrier
 * is unknown.
 *
 * Twilio is mocked; nothing is sent.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scriptedDb, type Script } from '@/__tests__/helpers/scripted-db'

// ── Columns per table, from the generated schema types ─────────────
const TYPES = readFileSync(join(process.cwd(), 'src', 'types', 'database.types.ts'), 'utf8')
function columnsOf(table: string): Set<string> {
  const start = TYPES.indexOf(`      ${table}: {\n        Row: {`.replace(/\n/g, TYPES.includes('\r\n') ? '\r\n' : '\n'))
  if (start < 0) throw new Error(`table ${table} not in database.types.ts`)
  const body = TYPES.slice(start).split(/\r?\n        \}/)[0]!
  return new Set([...body.matchAll(/^\s{10}(\w+)\??:/gm)].map(m => m[1]!))
}

/** Columns a PostgREST select names, with embedded tables checked too. */
function unknownColumns(table: string, select: string): string[] {
  const s = select.replace(/\s+/g, '')
  const out: string[] = []
  let depth = 0, token = ''
  const parts: string[] = []
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(token); token = '' } else token += ch
  }
  if (token) parts.push(token)
  const cols = columnsOf(table)
  for (const p of parts) {
    const embed = /^(\w+)(?:!\w+)?\((.*)\)$/.exec(p)
    if (embed) out.push(...unknownColumns(embed[1]!, embed[2]!).map(c => `${embed[1]}.${c}`))
    else if (p !== '*' && !cols.has(p)) out.push(p)
  }
  return out
}

/** scriptedDb, but a select naming a missing column fails like Postgres. */
function strictDb(script: Script) {
  const selects = new Map<object, { table: string; cols: string }>()
  const base = scriptedDb(call => {
    const sel = [...selects.values()].find(v => v.table === call.table)
    if (sel && call.op === 'select') {
      const bad = unknownColumns(sel.table, sel.cols)
      if (bad.length) return { data: null, error: { message: `column ${sel.table}.${bad[0]} does not exist`, code: '42703' } }
    }
    return script(call)
  })
  const from = (base.client as { from: (t: string) => Record<string, unknown> }).from
  ;(base.client as Record<string, unknown>)['from'] = (table: string) => {
    const q = from(table)
    const select = q['select'] as (c?: string, o?: unknown) => unknown
    q['select'] = (cols?: string, opts?: unknown) => {
      if (typeof cols === 'string' && !(opts as { head?: boolean } | undefined)?.head) selects.set(q, { table, cols })
      return select(cols, opts)
    }
    return q
  }
  return base
}

let db = strictDb(() => undefined)
const createMock = jest.fn()

jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => db.client }))
jest.mock('@/lib/twilio/client', () => ({ createTwilioClient: () => ({ messages: { create: (p: unknown) => createMock(p) } }) }))
jest.mock('@/lib/env', () => ({ serverEnv: { twilioPhoneNumber: () => '+15005550006', appBaseUrl: () => 'https://app.test' } }))
jest.mock('@/lib/slack/client', () => ({ sendSlackMessage: async () => undefined }))
jest.mock('@/lib/auth/checkout-token', () => ({ generateCheckoutToken: async () => 'tok' }))

import { sendPaymentLinkSms, sendShippingNotificationSms, sendDeliveredSms } from '../triggers'
import { carrierTrackingUrl } from '@/lib/shipping/tracking-url'

const SHIPPING_TEMPLATE = 'Hi {{patientFirstName}}, your order has shipped! Track your package: {{trackingUrl}}'
const TEMPLATES: Record<string, string> = {
  shipping_notification: SHIPPING_TEMPLATE,
  payment_link:          'Hi {{patientFirstName}}, your payment link: {{checkoutUrl}}',
  delivered:             'Hi {{patientFirstName}}, your order was delivered.',
}

/** A real orders row has tracking_number and carrier; there is no tracking_url. */
function orderRow(carrier: string | null, trackingNumber: string | null) {
  return {
    tracking_number: trackingNumber,
    carrier,
    patients:   { patient_id: 'pt-1', first_name: 'Alex', phone: '+15125550123', sms_opt_in: true },
    clinics:    { clinic_id: 'c-1', name: 'Sunrise' },
    providers:  { last_name: 'Chen' },
    pharmacies: { supports_real_time_status: false },
  }
}

function world(row: ReturnType<typeof orderRow>): Script {
  return c => {
    if (c.table === 'orders') return { data: row }
    if (c.table === 'sms_templates') return { data: { body_template: TEMPLATES[String(c.filters['template_name'])] } }
    if (c.table === 'patients') return { data: { sms_opt_in: true } }
    if (c.table === 'sms_log' && c.head) return { count: 0 }
    return undefined
  }
}

const sentBody = () => (createMock.mock.calls[0]![0] as { body: string }).body

beforeEach(() => {
  delete process.env['TWILIO_ENABLED']
  createMock.mockReset().mockResolvedValue({ sid: 'SM1' })
  for (const level of ['info', 'warn', 'error'] as const) jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('the order context query names only real columns', () => {
  it('the strict fake rejects the old select, as Postgres did', () => {
    expect(unknownColumns('orders', 'tracking_url, patients!inner ( patient_id )')).toEqual(['tracking_url'])
    expect(unknownColumns('orders', 'tracking_number, carrier, patients!inner ( patient_id, first_name )')).toEqual([])
  })

  it('a payment link text is sent (the context loads)', async () => {
    db = strictDb(world(orderRow(null, null)))
    await expect(sendPaymentLinkSms('o-1', 'https://app.test/checkout/tok')).resolves.toEqual({ outcome: 'sent', messageSid: 'SM1' })
    expect(db.to('orders', 'select')[0]!.filters).toEqual(expect.objectContaining({ order_id: 'o-1' }))
  })

  it('a delivered text is sent', async () => {
    db = strictDb(world(orderRow('UPS', '1Z999AA10123456784')))
    await expect(sendDeliveredSms('o-1')).resolves.toEqual(expect.objectContaining({ outcome: 'sent' }))
  })
})

describe('the shipped text', () => {
  it('a known carrier: the link is built from carrier + tracking_number', async () => {
    db = strictDb(world(orderRow('UPS', '1Z999AA10123456784')))
    await expect(sendShippingNotificationSms('o-1')).resolves.toEqual(expect.objectContaining({ outcome: 'sent' }))
    expect(sentBody()).toContain('Track your package: https://www.ups.com/track?tracknum=1Z999AA10123456784')
  })

  it('an unknown carrier: sent without a link', async () => {
    db = strictDb(world(orderRow('Pharmacy courier', 'ABC123')))
    await expect(sendShippingNotificationSms('o-1')).resolves.toEqual(expect.objectContaining({ outcome: 'sent' }))
    expect(sentBody()).not.toMatch(/https?:\/\//)
    expect(sentBody()).toContain('Alex')
  })

  it('no tracking number: sent without a link', async () => {
    db = strictDb(world(orderRow('FedEx', null)))
    await expect(sendShippingNotificationSms('o-1')).resolves.toEqual(expect.objectContaining({ outcome: 'sent' }))
    expect(sentBody()).not.toMatch(/https?:\/\//)
  })
})

describe('carrierTrackingUrl', () => {
  it.each([
    ['UPS',          '1Z999AA10123456784', 'https://www.ups.com/track?tracknum=1Z999AA10123456784'],
    ['ups',          '1Z999AA10123456784', 'https://www.ups.com/track?tracknum=1Z999AA10123456784'],
    ['FedEx',        '123456789012',       'https://www.fedex.com/fedextrack/?trknbr=123456789012'],
    ['Fed Ex',       '123456789012',       'https://www.fedex.com/fedextrack/?trknbr=123456789012'],
    ['USPS',         '9400111899223817276541', 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223817276541'],
    ['DHL',          '1234567890',         'https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=1234567890'],
    [' ups ',        ' 1z999 ',            'https://www.ups.com/track?tracknum=1z999'],
  ])('%s %s', (carrier, number, url) => {
    expect(carrierTrackingUrl(carrier, number)).toBe(url)
  })

  it.each([
    ['unknown carrier', 'OnTrac2', 'X1'],
    ['no carrier',      null,      'X1'],
    ['no number',       'UPS',     null],
    ['blank number',    'UPS',     '  '],
    ['not a tracking number', 'UPS', 'call me <b>'],
  ])('%s: null', (_n, carrier, number) => {
    expect(carrierTrackingUrl(carrier, number)).toBeNull()
  })
})
