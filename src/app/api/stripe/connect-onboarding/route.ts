// ============================================================
// Stripe Connect Onboarding — WO-30
// POST /api/stripe/connect-onboarding
// ============================================================
//
// REQ-CAD-001: Stripe Connect EXPRESS onboarding (HC-02/PF-01).
//   Creates a Stripe Express account if the clinic has none,
//   then generates and returns a hosted onboarding account link.
//   Re-onboarding (RESTRICTED/ONBOARDING) reuses the existing account ID.
//
// HC-02/PF-01: EXPRESS account type ONLY. Platform never handles KYC.
//
// Auth: Requires active Clinic App session (clinic_id in JWT).
//
// Response: { url: string }  — redirect the browser to this URL.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createStripeClient } from '@/lib/stripe/client'
import { serverEnv } from '@/lib/env'

export async function POST(_request: NextRequest): Promise<NextResponse> {
  // Auth gate
  const supabaseAuth = await createServerClient()
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const clinicId = typeof session.user.user_metadata['clinic_id'] === 'string'
    ? session.user.user_metadata['clinic_id'] as string
    : null

  if (!clinicId) {
    return NextResponse.json({ error: 'Session missing clinic_id' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch clinic — need stripe_connect_account_id to determine if re-onboarding
  const { data: clinic, error: clinicError } = await supabase
    .from('clinics')
    .select('clinic_id, stripe_connect_account_id, stripe_connect_status')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
    .maybeSingle()

  if (clinicError || !clinic) {
    console.error('[connect-onboarding] clinic fetch failed:', clinicError?.message)
    return NextResponse.json({ error: 'Clinic not found' }, { status: 404 })
  }

  // Disallow re-onboarding from ACTIVE accounts (no action needed)
  if (clinic.stripe_connect_status === 'ACTIVE') {
    return NextResponse.json({ error: 'Stripe account is already active' }, { status: 409 })
  }

  // Disallow DEACTIVATED accounts — requires platform legal review
  if (clinic.stripe_connect_status === 'DEACTIVATED') {
    return NextResponse.json(
      { error: 'Account deactivated — contact platform support' },
      { status: 403 }
    )
  }

  const stripe = createStripeClient()
  const baseUrl = serverEnv.appBaseUrl()

  let stripeAccountId = clinic.stripe_connect_account_id

  // HC-02/PF-01: Create Express account only if clinic has none
  if (!stripeAccountId) {
    let account: { id: string }
    try {
      account = await stripe.accounts.create({
        type: 'express',
        // HC-REQ-OAS-008: Zero PHI — no clinic name, email, or personal data here
        metadata: { clinic_id: clinicId },
      })
    } catch (err) {
      console.error('[connect-onboarding] stripe.accounts.create failed:', err)
      return NextResponse.json({ error: 'Failed to create Stripe account' }, { status: 502 })
    }

    stripeAccountId = account.id

    // BLK-01: CAS update — only write if account_id is still NULL.
    // If two concurrent requests both created accounts, the first one to
    // reach this UPDATE wins; the second sees 0 rows affected and falls back
    // to re-fetching the winning account ID. The losing Stripe account is
    // orphaned (not ideal) but the data layer stays consistent.
    const { data: casRows, error: updateError } = await supabase
      .from('clinics')
      .update({
        stripe_connect_account_id: stripeAccountId,
        stripe_connect_status: 'ONBOARDING',
      })
      .eq('clinic_id', clinicId)
      .is('stripe_connect_account_id', null)  // CAS predicate
      .select('stripe_connect_account_id')

    if (updateError) {
      console.error('[connect-onboarding] clinic update failed:', updateError.message)
      return NextResponse.json({ error: 'Failed to save Stripe account' }, { status: 500 })
    }

    if (!casRows || casRows.length === 0) {
      // Lost the race — another request already saved an account ID.
      // Fetch the winning account ID and proceed with that.
      const { data: refetched, error: refetchError } = await supabase
        .from('clinics')
        .select('stripe_connect_account_id')
        .eq('clinic_id', clinicId)
        .maybeSingle()

      if (refetchError || !refetched?.stripe_connect_account_id) {
        console.error('[connect-onboarding] refetch after CAS loss failed:', refetchError?.message)
        return NextResponse.json({ error: 'Failed to resolve Stripe account' }, { status: 500 })
      }

      stripeAccountId = refetched.stripe_connect_account_id
      console.info(`[connect-onboarding] CAS lost race — using winning account | clinic=${clinicId}`)
    }
  }

  // Generate hosted onboarding account link
  let accountLink: { url: string }
  try {
    accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${baseUrl}/settings?stripe=refresh`,
      return_url:  `${baseUrl}/settings?stripe=return`,
      type: 'account_onboarding',
    })
  } catch (err) {
    console.error('[connect-onboarding] stripe.accountLinks.create failed:', err)
    return NextResponse.json({ error: 'Failed to create onboarding link' }, { status: 502 })
  }

  console.info(
    `[connect-onboarding] account link created | clinic=${clinicId} | account=${stripeAccountId}`
  )

  return NextResponse.json({ url: accountLink.url })
}
