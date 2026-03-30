// ============================================================
// Clinic Settings — WO-30
// /settings
// ============================================================
//
// Server Component: fetches clinic data and renders the settings form
// and Stripe status section.
//
// REQ-CAD-001: Stripe Connect Express onboarding UI.
// REQ-CAD-006: Clinic logo management.
// REQ-CAD-007: Default markup percentage configuration.

import { redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ClinicSettingsForm } from './_components/clinic-settings-form'
import { StripeStatusSection } from './_components/stripe-status-section'

export const metadata = {
  title: 'Clinic Settings',
}

export default async function SettingsPage() {
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) redirect('/login')

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : undefined

  if (!clinicId) redirect('/login')

  const supabase = createServiceClient()

  const { data: clinic } = await supabase
    .from('clinics')
    .select('clinic_id, name, logo_url, default_markup_pct, stripe_connect_status, stripe_connect_account_id')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!clinic) redirect('/login')

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Clinic Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your clinic profile, Stripe payout account, and default pricing.
        </p>
      </div>

      {/* Two-column layout: nav left, content right */}
      <div className="flex gap-8 items-start">

        {/* ── Section navigation — sticky on desktop ── */}
        <nav
          className="hidden md:block w-44 flex-shrink-0 sticky top-6"
          aria-label="Settings sections"
        >
          <ul className="space-y-1">
            {[
              { href: '#stripe-connect',  label: 'Stripe Connect'  },
              { href: '#clinic-profile',  label: 'Clinic Profile'  },
              { href: '#notifications',   label: 'Notifications'   },
            ].map(({ href, label }) => (
              <li key={href}>
                <a
                  href={href}
                  className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ── Sections ── */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Stripe Connect status + onboarding — REQ-CAD-001/002 */}
          <div id="stripe-connect" className="scroll-mt-6">
            <StripeStatusSection
              stripeConnectStatus={clinic.stripe_connect_status}
              stripeAccountId={clinic.stripe_connect_account_id ?? null}
            />
          </div>

          {/* Clinic settings form — REQ-CAD-006/007 */}
          <div id="clinic-profile" className="scroll-mt-6">
            <ClinicSettingsForm
              clinicName={clinic.name}
              logoUrl={clinic.logo_url ?? null}
              defaultMarkupPct={clinic.default_markup_pct ?? null}
            />
          </div>

          {/* Notifications — placeholder section */}
          <div id="notifications" className="scroll-mt-6">
            <section className="rounded-lg border border-border bg-card p-6 space-y-3">
              <h2 className="text-base font-semibold text-foreground">Notifications</h2>
              <p className="text-sm text-muted-foreground">
                Email and SMS notification preferences are not yet configurable.
                Order status updates are sent automatically based on your clinic&apos;s
                registered contact email.
              </p>
              <p className="inline-flex items-center rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                Coming soon — configurable preferences
              </p>
            </section>
          </div>

        </div>
      </div>
    </main>
  )
}
