/**
 * @jest-environment node
 *
 * Lauren, 18 Oct: providers will not read a guide, so the product walks
 * them through setup. The setup checklist, per role. Every step links to
 * where it is done and ticks itself from real data, never from a box the
 * user ticks:
 *
 *   clinic_admin  practice details (clinics.legal_name), BAA and terms
 *                 accepted at their current versions, a provider on the
 *                 team, a patient, a prescription sent (signed: locked_at);
 *                 while the clinic is not approved, a first line says so
 *   provider      NPI verified, a protocol created or prescribed from,
 *                 a prescription signed (their own)
 *   medical_assistant  a patient added, a draft started (their own, from
 *                 the PHI access log's create rows)
 *   pharmacy_admin  setup submitted, catalog loaded, a first order received
 *
 * Coaching preferences (hidden, done, tips seen) live in the auth user's
 * user_metadata.coaching: never a role or clinic, which come only from
 * app_metadata.
 */

import { buildChecklist, loadChecklist, WAITING_FOR_APPROVAL } from '../checklist'
import { coachingPrefs, withCoaching } from '../prefs'
import { scriptedDb, type ScriptedCall } from '@/__tests__/helpers/scripted-db'

describe('buildChecklist', () => {
  it('clinic admin: five steps with links; the approval line while not approved', () => {
    const c = buildChecklist('clinic_admin', {
      kind: 'clinic_admin', approved: false, practiceDetails: true, agreementsAccepted: false, hasTeam: false, hasPatients: true, sentPrescription: false,
    })
    expect(c.notice).toBe('Waiting for CompoundIQ approval. You can look around and set up; ordering opens when approved.')
    expect(WAITING_FOR_APPROVAL).toBe(c.notice)
    expect(c.steps.map(s => [s.id, s.href, s.done])).toEqual([
      // Not approved yet: the wizard's Practice details step.
      ['practice', '/onboarding', true],
      ['agreements', '/settings/agreements', false],
      ['team', '/settings/team', false],
      ['patients', '/settings#patients', true],
      ['first-prescription', '/new-prescription', false],
    ])
    expect(c.allDone).toBe(false)
  })

  it('an approved clinic has no approval line', () => {
    const c = buildChecklist('clinic_admin', { kind: 'clinic_admin', approved: true, practiceDetails: true, agreementsAccepted: true, hasTeam: true, hasPatients: true, sentPrescription: true })
    expect(c.notice).toBeNull()
    expect(c.allDone).toBe(true)
  })

  it('practice details: the wizard (/onboarding) until approved, the clinic profile after', () => {
    const base = { kind: 'clinic_admin' as const, practiceDetails: false, agreementsAccepted: false, hasTeam: false, hasPatients: false, sentPrescription: false }
    expect(buildChecklist('clinic_admin', { ...base, approved: false }).steps[0]).toEqual(expect.objectContaining({ id: 'practice', href: '/onboarding' }))
    expect(buildChecklist('clinic_admin', { ...base, approved: true }).steps[0]).toEqual(expect.objectContaining({ id: 'practice', href: '/settings#clinic-profile' }))
  })

  it('provider', () => {
    const c = buildChecklist('provider', { kind: 'provider', npiVerified: true, usedProtocol: false, signedPrescription: false })
    expect(c.steps.map(s => [s.id, s.label, s.href, s.done])).toEqual([
      ['npi', 'Confirm your profile and NPI', '/settings/team', true],
      ['protocol', 'Review a protocol', '/new-prescription?panel=protocols', false],
      ['first-signature', 'Sign your first prescription', '/new-prescription', false],
    ])
  })

  it('medical assistant', () => {
    const c = buildChecklist('medical_assistant', { kind: 'medical_assistant', addedPatient: true, startedDraft: true })
    expect(c.steps.map(s => s.label)).toEqual(['Add a patient', 'Start a draft for a provider'])
    expect(c.allDone).toBe(true)
  })

  it('pharmacy admin', () => {
    const c = buildChecklist('pharmacy_admin', { kind: 'pharmacy_admin', setupSubmitted: true, catalogLoaded: false, receivedOrder: false })
    expect(c.steps.map(s => [s.label, s.href, s.done])).toEqual([
      ['Complete your setup', '/pharmacy/onboarding', true],
      ['Load your catalog', '/pharmacy/onboarding', false],
      ['Receive your first order', '/pharmacy/onboarding', false],
    ])
  })

  it('no step label uses an em dash', () => {
    for (const c of [
      buildChecklist('clinic_admin', { kind: 'clinic_admin', approved: false, practiceDetails: false, agreementsAccepted: false, hasTeam: false, hasPatients: false, sentPrescription: false }),
      buildChecklist('provider', { kind: 'provider', npiVerified: false, usedProtocol: false, signedPrescription: false }),
      buildChecklist('medical_assistant', { kind: 'medical_assistant', addedPatient: false, startedDraft: false }),
      buildChecklist('pharmacy_admin', { kind: 'pharmacy_admin', setupSubmitted: false, catalogLoaded: false, receivedOrder: false }),
    ]) {
      expect(JSON.stringify(c)).not.toContain('—')
    }
  })
})

describe('loadChecklist reads real data, scoped to the caller', () => {
  const CLINIC = 'c-1'
  const member = (userId: string, deactivatedAt: string | null = null) => ({
    user_id: userId, email: `${userId}@clinic.test`, full_name: null, role: 'provider', deactivated_at: deactivatedAt, last_sign_in_at: null,
  })
  const invite = (expiresAt: string) => ({
    invite_id: 'i-1', kind: 'staff', email: 'ma@clinic.test', invitee_name: null, provider_id: null,
    expires_at: expiresAt, last_sent_at: '2026-10-01T00:00:00Z', accepted_at: null, revoked_at: null,
  })
  const user = (role: string, extra: Record<string, unknown> = {}) => ({ id: 'u-1', app_metadata: { app_role: role, clinic_id: CLINIC, ...extra } })

  it('clinic admin: from the clinic, its agreements, the Team page members and invites, patients and signed orders', async () => {
    const db = scriptedDb((c: ScriptedCall) => {
      if (c.table === 'clinics') return { data: { onboarding_status: 'approved', legal_name: 'Sunrise PLLC' } }
      if (c.table === 'agreement_acceptances') return { data: [] }
      if (c.table === 'clinic_team_members') return { data: [member('u-1'), member('u-2')] }
      if (c.table === 'onboarding_invites') return { data: [] }
      if (c.table === 'patients') return { count: 0 }
      if (c.table === 'orders') return { count: 1 }
      return undefined
    })
    const c = await loadChecklist(db.client as never, user('clinic_admin'))
    expect(c!.steps.map(s => [s.id, s.done])).toEqual([
      ['practice', true], ['agreements', false], ['team', true], ['patients', false], ['first-prescription', true],
    ])
    for (const call of db.calls) {
      if (['clinics', 'patients', 'orders', 'agreement_acceptances', 'onboarding_invites'].includes(call.table)) {
        expect(call.filters['clinic_id']).toBe(CLINIC)
      }
    }
    // The Team page's data source (lib/team/team), not a query of its own.
    expect(db.calls.find(c => c.table === 'clinic_team_members')!.payload).toEqual({ p_clinic_id: CLINIC })
    expect(db.to('providers', 'select')).toEqual([])
    expect(db.to('orders', 'select')[0]!.filters['locked_at:not']).toEqual(['is', null])
  })

  describe('"Add your team" ticks with an active member besides the admin, or a pending invite', () => {
    const teamDone = async (members: unknown[], invites: unknown[]) => {
      const db = scriptedDb((c: ScriptedCall) => {
        if (c.table === 'clinics') return { data: { onboarding_status: 'approved', legal_name: 'Sunrise PLLC' } }
        if (c.table === 'agreement_acceptances') return { data: [] }
        if (c.table === 'clinic_team_members') return { data: members }
        if (c.table === 'onboarding_invites') return { data: invites }
        return { count: 0 }
      })
      const c = await loadChecklist(db.client as never, user('clinic_admin'))
      return c!.steps.find(s => s.id === 'team')!
    }
    it('links to Settings > Team', async () => {
      expect((await teamDone([], [])).href).toBe('/settings/team')
    })
    it('only the admin: to do', async () => {
      expect((await teamDone([member('u-1')], [])).done).toBe(false)
    })
    it('another active member: done', async () => {
      expect((await teamDone([member('u-1'), member('u-2')], [])).done).toBe(true)
    })
    it('another member, deactivated: to do', async () => {
      expect((await teamDone([member('u-1'), member('u-2', '2026-10-01T00:00:00Z')], [])).done).toBe(false)
    })
    it('a pending invite: done', async () => {
      expect((await teamDone([member('u-1')], [invite(new Date(Date.now() + 86400000).toISOString())])).done).toBe(true)
    })
    it('only an expired invite: to do', async () => {
      expect((await teamDone([member('u-1')], [invite('2026-01-01T00:00:00Z')])).done).toBe(false)
    })
  })

  describe('practice details, not approved: ticked as the wizard ticks its Practice details step', () => {
    const practiceDone = async (stepStatus: string | null, legalName: string | null) => {
      const db = scriptedDb((c: ScriptedCall) => {
        if (c.table === 'clinics') return { data: { onboarding_status: 'in_progress', legal_name: legalName } }
        if (c.table === 'clinic_onboarding_steps') return { data: stepStatus ? { status: stepStatus } : null }
        if (c.table === 'agreement_acceptances') return { data: [] }
        if (c.table === 'clinic_team_members' || c.table === 'onboarding_invites') return { data: [] }
        return { count: 0 }
      })
      const c = await loadChecklist(db.client as never, user('clinic_admin'))
      const step = db.to('clinic_onboarding_steps', 'select')[0]
      return { done: c!.steps[0]!.done, filters: step?.filters }
    }
    it('the wizard step is complete: done', async () => {
      const r = await practiceDone('complete', null)
      expect(r.done).toBe(true)
      expect(r.filters).toEqual(expect.objectContaining({ clinic_id: CLINIC, step: 'practice' }))
    })
    it('a legal name alone is not the wizard step: to do', async () => {
      expect((await practiceDone('in_progress', 'Sunrise PLLC')).done).toBe(false)
      expect((await practiceDone(null, 'Sunrise PLLC')).done).toBe(false)
    })
  })

  it('medical assistant: from the PHI access log rows they wrote', async () => {
    const db = scriptedDb((c: ScriptedCall) => {
      if (c.table === 'phi_access_log') return { count: c.filters['resource'] === 'patient' ? 1 : 0 }
      return undefined
    })
    const c = await loadChecklist(db.client as never, user('medical_assistant'))
    expect(c!.steps.map(s => s.done)).toEqual([true, false])
    for (const call of db.to('phi_access_log', 'select')) {
      expect(call.filters).toEqual(expect.objectContaining({ actor_user_id: 'u-1', action: 'create' }))
    }
  })

  it('ops_admin, or a clinic role with no clinic: no checklist', async () => {
    const db = scriptedDb(() => undefined)
    expect(await loadChecklist(db.client as never, { id: 'u', app_metadata: { app_role: 'ops_admin' } })).toBeNull()
    expect(await loadChecklist(db.client as never, { id: 'u', app_metadata: { app_role: 'provider' } })).toBeNull()
  })

  it('a read that fails throws: the card is not shown with a wrong tick', async () => {
    const db = scriptedDb(c => (c.table === 'patients' ? { error: { message: 'down' } } : c.table === 'clinics' ? { data: { onboarding_status: 'approved', legal_name: null } } : { count: 0, data: [] }))
    await expect(loadChecklist(db.client as never, user('clinic_admin'))).rejects.toThrow()
  })
})

describe('coaching prefs in user_metadata', () => {
  it('read with defaults', () => {
    expect(coachingPrefs(null)).toEqual({ checklistHidden: false, checklistDone: false, rxTipsSeen: false })
    expect(coachingPrefs({ user_metadata: { coaching: { checklist_hidden: true, rx_tips_seen: true } } })).toEqual({ checklistHidden: true, checklistDone: false, rxTipsSeen: true })
  })

  it('merged into the existing metadata, keeping everything else', () => {
    const meta = { full_name: 'Lauren Perkins', coaching: { rx_tips_seen: true } }
    expect(withCoaching(meta, { checklistHidden: true })).toEqual({
      full_name: 'Lauren Perkins', coaching: { checklist_hidden: true, checklist_done: false, rx_tips_seen: true },
    })
  })
})
