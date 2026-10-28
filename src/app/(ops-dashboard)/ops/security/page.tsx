// ============================================================
// Failed sign-in alerts (security B12)
// /ops/security
// ============================================================
//
// Read-only: the last 7 days of failed sign-in alerts (lib/auth/
// sign-in-monitor), with the account as its keyed-hash prefix and the
// client IP, which Slack never carries. Plus how many failed sign-ins
// were recorded in the last 24 hours.
//
// Auth: ops_admin only, enforced OUTSIDE this component (src/proxy.ts
// and (ops-dashboard)/layout.tsx), as on every ops page.

import { createServiceClient } from '@/lib/supabase/service'
import { ACCOUNT_ALERT_AT, ALERT_WINDOW_MINUTES, IP_ALERT_AT, listSignInAlerts } from '@/lib/auth/sign-in-monitor'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Security | Ops Dashboard',
}

const RULE_LABEL: Record<string, string> = {
  account:    `${ACCOUNT_ALERT_AT} failures on one account`,
  ip:         `${IP_ALERT_AT} failures from one IP address`,
  privileged: 'Failure on an admin account',
}

export default async function OpsSecurityPage() {
  const r = await listSignInAlerts(createServiceClient())
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground dark:text-slate-300">
          Failed sign-in alerts from the last 7 days. An alert fires at {ACCOUNT_ALERT_AT} failures on one account or {IP_ALERT_AT} from one IP address within {ALERT_WINDOW_MINUTES} minutes, and on any failure on an ops or pharmacy admin account. The account is shown as the start of its keyed hash.
        </p>
      </div>
      {!r.ok ? (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-red-700 dark:text-red-300">{r.error}</div>
      ) : (
        <>
          <p className="text-sm text-foreground" data-testid="failures-24h">
            Failed sign-ins recorded in the last 24 hours: <span className="font-semibold">{r.failures24h}</span>
          </p>
          {r.alerts.length === 0 ? (
            <p className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">No failed sign-in alerts in the last 7 days.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">Failed sign-in alerts, newest first</caption>
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">When (UTC)</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Alert</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Step</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Reason</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Failures</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Role</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Account</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">IP address</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Slack</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {r.alerts.map(a => (
                    <tr key={a.alertId}>
                      <td className="px-3 py-2 font-mono text-xs">{a.createdAt.replace('T', ' ').slice(0, 19)}</td>
                      <td className="px-3 py-2">{RULE_LABEL[a.rule] ?? a.rule}</td>
                      <td className="px-3 py-2">{a.step === 'mfa' ? 'Two-step code' : 'Password'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.reason}</td>
                      <td className="px-3 py-2">{a.count ?? ''}</td>
                      <td className="px-3 py-2">{a.role ?? ''}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.accountRef ?? ''}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.ip ?? ''}</td>
                      <td className="px-3 py-2">{a.sent ? 'Sent' : 'Queued'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
