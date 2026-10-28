// ============================================================
// Notifications — /settings/notifications
// ============================================================
//
// What CompoundIQ sends today and to whom, from one list
// (lib/notifications/catalog), read only. Turning a notification off needs
// a per-clinic preference column that does not exist yet (see the
// B-2026-10-25-07 report), so nothing here is a switch. The texting line
// says whether texts actually go out in this environment
// (lib/twilio/config).
//
// getUser(), never getSession(); clinic from app_metadata (claims.ts).
// No redirect() from this streamed page body (see
// @/components/session-guard-notice).

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'
import { SessionGuardNotice } from '@/components/session-guard-notice'
import { getUserClinicId } from '@/lib/auth/claims'
import { isTwilioConfigured } from '@/lib/twilio/config'
import { NOTIFICATION_GROUPS, NOT_SENT_TODAY } from '@/lib/notifications/catalog'

export const metadata = {
  title: 'Notifications',
}

const MUTED = 'text-slate-700 dark:text-slate-300'
const LINK = 'text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'

export default async function NotificationsPage() {
  const supabaseAuth = await createServerClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return <SessionGuardNotice />
  if (!getUserClinicId(user)) {
    return <SessionGuardNotice title="No clinic linked" message="Your account is not linked to a clinic. Contact your administrator." />
  }

  const textingOn = isTwilioConfigured()

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <Link href="/settings" className={LINK}>Back to Settings</Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Notifications</h1>
        <p className={`mt-1 text-sm ${MUTED}`}>
          Notification settings are coming. This is what CompoundIQ sends today, and to whom.
        </p>
      </div>

      <p
        data-testid="texting-status"
        className={textingOn
          ? 'rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900'
          : 'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900'}
      >
        {textingOn
          ? 'Texting is on: the texts below are sent.'
          : 'Texting is not set up yet, so no texts are sent today. Share payment, plan and intake links with your patients by copying them or showing their QR code.'}
      </p>

      {NOTIFICATION_GROUPS.map(group => {
        const headingId = `notifications-${group.id}`
        return (
          <section key={group.id} aria-labelledby={headingId} className="rounded-lg border border-border bg-card p-6 space-y-3">
            <h2 id={headingId} className="text-lg font-semibold text-foreground">{group.title}</h2>
            <p className={`text-sm ${MUTED}`}>{group.intro}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" aria-labelledby={headingId}>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-4 font-semibold text-foreground">Notification</th>
                    <th scope="col" className="py-2 pr-4 font-semibold text-foreground">When</th>
                    <th scope="col" className="py-2 font-semibold text-foreground">Who receives it</th>
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map(e => (
                    <tr key={e.id} data-testid={`notification-${e.id}`} className="border-b border-border last:border-0 align-top">
                      <th scope="row" className="py-2 pr-4 font-medium text-foreground">{e.title}</th>
                      <td className={`py-2 pr-4 ${MUTED}`}>
                        {e.when}
                        {e.note && <span className="mt-1 block text-xs">{e.note}</span>}
                      </td>
                      <td className={`py-2 ${MUTED}`}>{e.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <section aria-labelledby="notifications-not-sent" className="rounded-lg border border-border bg-card p-6 space-y-3">
        <h2 id="notifications-not-sent" className="text-lg font-semibold text-foreground">Not sent today</h2>
        <ul className={`list-disc space-y-1 pl-5 text-sm ${MUTED}`}>
          {NOT_SENT_TODAY.map(item => <li key={item}>{item}</li>)}
        </ul>
      </section>
    </main>
  )
}
