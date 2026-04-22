// ============================================================
// Demo Tools — /ops/demo-tools
// ============================================================
//
// Self-service utilities for keeping the POC demo environment
// healthy. Today this hosts the "Reset Demo Credentials" button
// (the recovery path for credential drift). Future demo helpers
// belong here too.
//
// Auth: ops_admin only — enforced by the parent (ops-dashboard)
// layout via session role check.

import { POC_CANONICAL_USERS } from '@/lib/poc/canonical-users'
import { ResetCredentialsCard }   from './_components/reset-credentials-card'
import { RefreshDemoDataCard }    from './_components/refresh-demo-data-card'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Demo Tools | Ops Dashboard',
}

export default function DemoToolsPage() {
  const users = POC_CANONICAL_USERS.map(u => ({
    label:    u.label,
    email:    u.email,
    password: u.password,
  }))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Demo Tools</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Self-service utilities for keeping the POC demo environment healthy.
        </p>
      </header>

      <ResetCredentialsCard users={users} />

      <RefreshDemoDataCard />

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-medium">Recovery path (no terminal required)</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          If no one can log in as ops_admin, trigger
          {' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/cron/poc-credential-sync</code>
          {' '}
          from the Vercel dashboard&apos;s Crons tab via the &ldquo;Run Now&rdquo; button.
          That endpoint is gated by <code className="rounded bg-muted px-1 py-0.5 text-xs">CRON_SECRET</code>,
          not session auth, so it works even when every account is locked out. The daily cron
          (5 AM UTC) also keeps drift from persisting more than 24 hours unattended.
        </p>
      </section>
    </div>
  )
}
