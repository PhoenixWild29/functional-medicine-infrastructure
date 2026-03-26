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
    <main className="mx-auto max-w-2xl px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Clinic Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your clinic profile, Stripe payout account, and default pricing.
        </p>
      </div>

      {/* Stripe Connect status + onboarding — REQ-CAD-001/002 */}
      <StripeStatusSection
        stripeConnectStatus={clinic.stripe_connect_status}
        stripeAccountId={clinic.stripe_connect_account_id ?? null}
      />

      {/* Clinic settings form — REQ-CAD-006/007 */}
      <ClinicSettingsForm
        clinicName={clinic.name}
        logoUrl={clinic.logo_url ?? null}
        defaultMarkupPct={clinic.default_markup_pct ?? null}
      />
    </main>
  )
}
