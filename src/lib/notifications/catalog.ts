// ============================================================
// What CompoundIQ sends today, and to whom
// ============================================================
//
// The one list behind Settings > Notifications. Each entry names the code
// that sends it, so the page cannot drift from what really goes out
// (src/lib/notifications/__tests__/catalog.test.ts checks every `sender`
// still calls `call`).
//
// Nothing here can be turned off yet: a per-clinic preference needs a new
// column (see the B-2026-10-25-07 report for the design). Until then the
// page is read only.

export type NotificationChannel = 'text' | 'in_app' | 'none'

export interface NotificationEntry {
  id: string
  title: string
  /** When it is sent, in the clinic's words */
  when: string
  /** Who receives it */
  to: string
  channel: NotificationChannel
  /** Extra condition a clinic should know (opt-in, texting set up) */
  note?: string
  /** The code that sends it: file and the call that sends */
  sender: { file: string; call: string }
}

export interface NotificationGroup {
  id: string
  title: string
  intro: string
  entries: NotificationEntry[]
}

const OPTED_IN = 'Only to patients who agreed to receive texts.'

export const NOTIFICATION_GROUPS: NotificationGroup[] = [
  {
    id: 'patient-texts',
    title: 'Texts to your patients',
    intro: 'Sent by text message, only when texting is set up for CompoundIQ. They never include the medication or other health details.',
    entries: [
      {
        id: 'payment_link',
        title: 'Payment link',
        when: 'When a provider signs a prescription.',
        to: 'The patient',
        channel: 'text',
        note: OPTED_IN,
        sender: { file: 'src/lib/orders/batch-sign.ts', call: 'sendPaymentLinkSms(' },
      },
      {
        id: 'payment_reminders',
        title: 'Payment reminders',
        when: '24 and 48 hours after the payment link, if the patient has not paid.',
        to: 'The patient',
        channel: 'text',
        note: OPTED_IN,
        sender: { file: 'src/app/api/cron/sla-check/route.ts', call: 'sendReminder24hSms(' },
      },
      {
        id: 'payment_confirmation',
        title: 'Payment confirmation',
        when: 'When the patient’s payment goes through.',
        to: 'The patient',
        channel: 'text',
        note: OPTED_IN,
        sender: { file: 'src/app/api/webhooks/stripe/route.ts', call: 'sendPaymentConfirmationSms(' },
      },
      {
        id: 'plan_link',
        title: 'Treatment plan link',
        when: 'When a provider sends a plan for the patient to choose.',
        to: 'The patient',
        channel: 'text',
        note: `${OPTED_IN} You can always copy the link or show its QR code instead.`,
        sender: { file: 'src/lib/proposals/sms.ts', call: 'messages.create(' },
      },
      {
        id: 'intake_link',
        title: 'Intake link',
        when: 'When you add a patient by mobile number and send them the intake link.',
        to: 'The new patient',
        channel: 'text',
        note: 'Never to a patient who replied STOP. You can always copy the link instead.',
        sender: { file: 'src/lib/intake/sms.ts', call: 'messages.create(' },
      },
    ],
  },
  {
    id: 'clinic-team',
    title: 'For your clinic team',
    intro: 'CompoundIQ does not send email to your team. These appear in the app.',
    entries: [
      {
        id: 'plans_ready_to_sign',
        title: 'Plans ready to sign',
        when: 'When a patient chooses their treatment plan.',
        to: 'Your clinic team, in "Plans ready to sign" on the dashboard',
        channel: 'in_app',
        sender: { file: 'src/app/(clinic-app)/dashboard/page.tsx', call: '<ChosenPlansQueue' },
      },
      {
        id: 'team_invites',
        title: 'Team invitations',
        when: 'When a clinic admin invites someone.',
        to: 'You copy the invite link and send it yourself',
        channel: 'none',
        note: 'CompoundIQ does not email the invitation.',
        sender: { file: 'src/app/api/team/invites/route.ts', call: 'link: invite.link' },
      },
      {
        id: 'text_delivery_problems',
        title: 'A text that could not be delivered',
        when: 'When a text to a patient fails.',
        to: 'CompoundIQ’s operations team, who follow up with your clinic',
        channel: 'none',
        note: 'If a patient says they did not get their payment link, copy it from the order and send it yourself.',
        sender: { file: 'src/app/api/webhooks/twilio/route.ts', call: 'sendSlackAlert(' },
      },
    ],
  },
]

export const NOT_SENT_TODAY: ReadonlyArray<string> = [
  'Shipping and delivery updates to patients',
  'Email of any kind, to patients or to your team',
]
