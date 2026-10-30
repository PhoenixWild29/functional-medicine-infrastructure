// ============================================================
// Setup checklist: per role, ticked from real data
// ============================================================
//
// Lauren, 18 Oct: providers will not read a guide, so the product walks
// them through setup. Each step links to where it is done and ticks
// itself from the data (never a box the user ticks). Server only: read
// with the service role, scoped by the caller's own claims.
//
//   clinic_admin       practice details, BAA and terms at their current
//                      versions, a team (another active member or a
//                      pending invite, read as Settings > Team reads them),
//                      a patient, a prescription
//                      sent (signed); the approval line until approved
//   provider           NPI verified, a protocol created or prescribed
//                      from, a prescription signed (their own)
//   medical_assistant  a patient added and a draft started, from the
//                      PHI access log rows they wrote (action 'create')
//   pharmacy_admin     setup submitted, catalog loaded, an order received

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { getUserClinicId, getUserPharmacyId, getUserRole, type ClaimsUser } from '@/lib/auth/claims'
import { resolveCurrentProvider } from '@/lib/auth/current-provider'
import { AGREEMENT_KEYS, loadClinicAgreements } from '@/lib/agreements/clinic-agreements'
import { listPendingInvites, listTeamMembers } from '@/lib/team/team'

type Db = SupabaseClient<Database>

export type CoachingRole = 'clinic_admin' | 'provider' | 'medical_assistant' | 'pharmacy_admin'

export type ChecklistFacts =
  | { kind: 'clinic_admin'; approved: boolean; solo?: boolean; practiceDetails: boolean; agreementsAccepted: boolean; hasTeam: boolean; hasPatients: boolean; sentPrescription: boolean }
  | { kind: 'provider'; npiVerified: boolean; usedProtocol: boolean; signedPrescription: boolean }
  | { kind: 'medical_assistant'; addedPatient: boolean; startedDraft: boolean }
  | { kind: 'pharmacy_admin'; setupSubmitted: boolean; catalogLoaded: boolean; receivedOrder: boolean }

export interface ChecklistStep {
  id:    string
  label: string
  href:  string
  done:  boolean
}

export interface Checklist {
  /** A line above the steps (the clinic is waiting for approval), or null. */
  notice:  string | null
  steps:   ChecklistStep[]
  allDone: boolean
}

export const WAITING_FOR_APPROVAL = "Waiting for CompoundIQ approval. You can look around and set up; ordering opens once you're approved and payouts are set up."

// Statuses at which a pharmacy has received an order (sent to it, or later).
const RECEIVED_STATUSES = [
  'SUBMISSION_PENDING', 'FAX_QUEUED', 'FAX_DELIVERED', 'PHARMACY_ACKNOWLEDGED', 'PHARMACY_COMPOUNDING',
  'PHARMACY_PROCESSING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED',
] as const

export function buildChecklist(_role: CoachingRole, f: ChecklistFacts): Checklist {
  let notice: string | null = null
  let steps: ChecklistStep[]
  switch (f.kind) {
    case 'clinic_admin':
      notice = f.approved ? null : WAITING_FOR_APPROVAL
      steps = [
        // Until approved, practice details live in the onboarding wizard.
        { id: 'practice',           label: 'Enter your practice details',       href: f.approved ? '/settings#clinic-profile' : '/onboarding', done: f.practiceDetails },
        { id: 'agreements',         label: 'Accept the BAA and terms',          href: '/settings/agreements',     done: f.agreementsAccepted },
        // A solo provider's practice is one person: no team step (Sam, Oct 30).
        ...(f.solo ? [] : [{ id: 'team',    label: 'Add your team',                     href: '/settings/team',           done: f.hasTeam }]),
        { id: 'patients',           label: 'Add patients: import, a sign-up link or one at a time', href: '/settings#patients', done: f.hasPatients },
        { id: 'first-prescription', label: 'Send your first prescription',      href: '/new-prescription',        done: f.sentPrescription },
      ]
      break
    case 'provider':
      steps = [
        { id: 'npi',             label: 'Confirm your profile and NPI',  href: '/settings/team',                     done: f.npiVerified },
        { id: 'protocol',        label: 'Review a protocol',             href: '/new-prescription?panel=protocols', done: f.usedProtocol },
        { id: 'first-signature', label: 'Sign your first prescription',  href: '/new-prescription',                  done: f.signedPrescription },
      ]
      break
    case 'medical_assistant':
      steps = [
        { id: 'patient', label: 'Add a patient',                href: '/new-prescription', done: f.addedPatient },
        { id: 'draft',   label: 'Start a draft for a provider', href: '/new-prescription', done: f.startedDraft },
      ]
      break
    case 'pharmacy_admin':
      steps = [
        { id: 'setup',       label: 'Complete your setup',      href: '/pharmacy/onboarding', done: f.setupSubmitted },
        { id: 'catalog',     label: 'Load your catalog',        href: '/pharmacy/onboarding', done: f.catalogLoaded },
        { id: 'first-order', label: 'Receive your first order', href: '/pharmacy/onboarding', done: f.receivedOrder },
      ]
      break
  }
  return { notice, steps, allDone: steps.every(s => s.done) }
}

// ── Reads ────────────────────────────────────────────────────

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`setup checklist: ${what} could not be read: ${error.message}`)
}

async function count(q: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string): Promise<number> {
  const { count: n, error } = await q
  fail(what, error)
  return n ?? 0
}

async function clinicAdminFacts(db: Db, userId: string, clinicId: string): Promise<ChecklistFacts> {
  const { data: clinic, error } = await db.from('clinics').select('onboarding_status, signup_kind').eq('clinic_id', clinicId).maybeSingle()
  fail('the clinic', error)
  const agreements = await loadClinicAgreements(db, clinicId)
  // The team as Settings > Team reads it (lib/team/team): another active
  // member besides this admin, or an invite still pending.
  const [members, invites] = await Promise.all([listTeamMembers(db, clinicId), listPendingInvites(db, clinicId)])
  if (members === null || invites === null) throw new Error('setup checklist: the team could not be read')
  const [patients, sent] = await Promise.all([
    count(db.from('patients').select('patient_id', { count: 'exact', head: true }).eq('clinic_id', clinicId).is('deleted_at', null), 'patients'),
    count(db.from('orders').select('order_id', { count: 'exact', head: true }).eq('clinic_id', clinicId).not('locked_at', 'is', null), 'orders'),
  ])
  const row = clinic as { onboarding_status?: string | null; signup_kind?: string | null } | null
  const approved = row?.onboarding_status === 'approved'
  const solo = row?.signup_kind === 'solo_provider'
  // Done as the wizard's Practice details step is done
  // (clinic_onboarding_steps, the wizard's own record), approved or not:
  // Settings > Clinic Profile saves through the same API and marks it.
  const { data: step, error: stepError } = await db.from('clinic_onboarding_steps').select('status').eq('clinic_id', clinicId).eq('step', 'practice').maybeSingle()
  fail('the practice details step', stepError)
  const practiceDetails = (step as { status?: string } | null)?.status === 'complete'
  return {
    kind: 'clinic_admin',
    approved,
    solo,
    practiceDetails,
    agreementsAccepted: AGREEMENT_KEYS.every(k => agreements[k].latest !== null && !agreements[k].updateAvailable),
    hasTeam:            members.some(m => m.userId !== userId && !m.deactivatedAt) || invites.some(i => i.status === 'pending'),
    hasPatients:        patients > 0,
    sentPrescription:   sent > 0,
  }
}

async function providerFacts(db: Db, userId: string, clinicId: string): Promise<ChecklistFacts> {
  const provider = await resolveCurrentProvider(db, { userId, clinicId })
  if (!provider) return { kind: 'provider', npiVerified: false, usedProtocol: false, signedPrescription: false }
  const pid = provider.provider_id
  const { data: npi, error } = await db.from('provider_npi_verifications').select('status').eq('provider_id', pid).order('checked_at', { ascending: false }).limit(1)
  fail('the NPI check', error)
  const [created, used, signed] = await Promise.all([
    count(db.from('protocol_templates').select('protocol_id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('created_by', pid), 'protocols'),
    count(db.from('protocol_instances').select('instance_id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('provider_id', pid), 'protocol use'),
    count(db.from('orders').select('order_id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('provider_id', pid).not('locked_at', 'is', null), 'orders'),
  ])
  return {
    kind: 'provider',
    npiVerified:        ((npi ?? []) as Array<{ status: string }>)[0]?.status === 'verified',
    usedProtocol:       created + used > 0,
    signedPrescription: signed > 0,
  }
}

async function assistantFacts(db: Db, userId: string, clinicId: string): Promise<ChecklistFacts> {
  const created = (resource: string) => count(
    db.from('phi_access_log').select('id', { count: 'exact', head: true })
      .eq('actor_user_id', userId).eq('clinic_id', clinicId).eq('action', 'create').eq('resource', resource),
    `your ${resource}s`,
  )
  const [patients, orders] = await Promise.all([created('patient'), created('order')])
  return { kind: 'medical_assistant', addedPatient: patients > 0, startedDraft: orders > 0 }
}

async function pharmacyFacts(db: Db, pharmacyId: string): Promise<ChecklistFacts> {
  const { data: app, error } = await db.from('pharmacy_onboarding_applications').select('status').eq('pharmacy_id', pharmacyId).order('created_at', { ascending: false }).limit(1)
  fail('the application', error)
  const [catalog, received] = await Promise.all([
    count(db.from('pharmacy_formulations').select('pharmacy_formulation_id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacyId), 'the catalog'),
    count(db.from('orders').select('order_id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacyId).in('status', [...RECEIVED_STATUSES]), 'orders'),
  ])
  const status = ((app ?? []) as Array<{ status: string }>)[0]?.status
  return { kind: 'pharmacy_admin', setupSubmitted: status === 'submitted' || status === 'approved', catalogLoaded: catalog > 0, receivedOrder: received > 0 }
}

/**
 * The caller's checklist, or null when their role has none (ops) or they
 * have no clinic or pharmacy. Throws when a read fails: a wrong tick is
 * worse than no card.
 */
export async function loadChecklist(db: Db, user: ClaimsUser & { id: string }): Promise<Checklist | null> {
  const role = getUserRole(user)
  if (role === 'pharmacy_admin') {
    const pharmacyId = getUserPharmacyId(user)
    return pharmacyId ? buildChecklist(role, await pharmacyFacts(db, pharmacyId)) : null
  }
  const clinicId = getUserClinicId(user)
  if (!clinicId) return null
  if (role === 'clinic_admin') return buildChecklist(role, await clinicAdminFacts(db, user.id, clinicId))
  if (role === 'provider') return buildChecklist(role, await providerFacts(db, user.id, clinicId))
  if (role === 'medical_assistant') return buildChecklist(role, await assistantFacts(db, user.id, clinicId))
  return null
}
