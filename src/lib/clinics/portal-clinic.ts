// ============================================================
// Was this clinic onboarded through the portal?
// ============================================================
//
// A portal clinic has an onboarding status (clinics.onboarding_status,
// migration 20261013000001) and came through an onboarding invite: a
// clinic_admin row in onboarding_invites. Its payouts are set up at
// launch, so the dashboard and Settings say so instead of asking for
// Stripe onboarding.
//
// Existing clinics (onboarded before the portal) have the default status
// and no invite. If the check cannot run, the clinic is treated as
// existing: today's screens, which are always safe to show.
//
// Server only: called with the service-role client (only ops and the
// clinic admin can read onboarding_invites under RLS) and the clinic id
// from the caller's claims (claims.ts).

type Db = { from: (table: string) => unknown }
type Result = { data: unknown; error: { message: string } | null; count?: number | null }
type Q = {
  select: (cols: string, opts?: { count?: 'exact'; head?: boolean }) => Q
  eq: (col: string, v: unknown) => Q
  maybeSingle: () => Promise<Result>
  then: Promise<Result>['then']
}

export async function isPortalOnboardedClinic(db: Db, clinicId: string): Promise<boolean> {
  const [clinicRes, invitesRes] = await Promise.all([
    (db.from('clinics') as Q).select('onboarding_status').eq('clinic_id', clinicId).maybeSingle(),
    (db.from('onboarding_invites') as Q)
      .select('invite_id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('kind', 'clinic_admin'),
  ])
  if (clinicRes.error || invitesRes.error) {
    console.error('[portal-clinic] check could not run; showing the standard payout screens | clinic=', clinicId)
    return false
  }
  const status = (clinicRes.data as { onboarding_status?: string | null } | null)?.onboarding_status
  return !!status && (invitesRes.count ?? 0) > 0
}
