/**
 * @jest-environment node
 *
 * Settings > Notifications lists what CompoundIQ sends from one catalog.
 * Each entry names the code that sends it; this pins that the code still
 * does, so the page cannot drift from what really goes out. Shipping and
 * delivery texts exist as templates but nothing sends them, so they are
 * listed as not sent.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NOTIFICATION_GROUPS, NOT_SENT_TODAY } from '../catalog'

const entries = NOTIFICATION_GROUPS.flatMap(g => g.entries)

it.each(entries.map(e => [e.id, e]))('%s: its sender still sends it', (_id, e) => {
  const file = join(process.cwd(), e.sender.file)
  expect(existsSync(file)).toBe(true)
  expect(readFileSync(file, 'utf8')).toContain(e.sender.call)
})

it('both payment reminders are sent by the SLA cron', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/api/cron/sla-check/route.ts'), 'utf8')
  expect(src).toContain('sendReminder24hSms(')
  expect(src).toContain('sendReminder48hSms(')
})

it('shipping and delivery texts are listed as not sent, because nothing sends them', () => {
  expect(NOT_SENT_TODAY.some(s => /shipping and delivery/i.test(s))).toBe(true)
  // Only the trigger module itself mentions them.
  const triggers = readFileSync(join(process.cwd(), 'src/lib/sms/triggers.ts'), 'utf8')
  expect(triggers).toContain('export async function sendShippingNotificationSms')
  for (const file of ['src/lib/orders/batch-sign.ts', 'src/app/api/cron/sla-check/route.ts', 'src/app/api/webhooks/stripe/route.ts', 'src/app/api/webhooks/pharmacy/[pharmacySlug]/route.ts']) {
    const src = readFileSync(join(process.cwd(), file), 'utf8')
    expect({ file, sends: /sendShippingNotificationSms\(|sendDeliveredSms\(/.test(src) }).toEqual({ file, sends: false })
  }
})

it('ids are unique, and the copy is plain (no em dash)', () => {
  expect(new Set(entries.map(e => e.id)).size).toBe(entries.length)
  const copy = JSON.stringify([NOTIFICATION_GROUPS.map(g => [g.title, g.intro, g.entries.map(e => [e.title, e.when, e.to, e.note])]), NOT_SENT_TODAY])
  expect(copy).not.toMatch(/—/)
})
