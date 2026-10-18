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
      ['practice', '/settings#clinic-profile', true],
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
  const user = (role: string, extra: Record<string, unknown> = {}) => ({ id: 'u-1', app_metadata: { app_role: role, clinic_id: CLINIC, ...extra } })

  it('clinic admin: from the clinic, its agreements, providers, patients and signed orders', async () => {
    const db = scriptedDb((c: ScriptedCall) => {
      if (c.table === 'clinics') return { data: { onboarding_status: 'approved', legal_name: 'Sunrise PLLC' } }
      if (c.table === 'agreement_acceptances') return { data: [] }
      if (c.table === 'providers') return { count: 2 }
      if (c.table === 'patients') return { count: 0 }
      if (c.table === 'orders') return { count: 1 }
      return undefined
    })
    const c = await loadChecklist(db.client as never, user('clinic_admin'))
    expect(c!.steps.map(s => [s.id, s.done])).toEqual([
      ['practice', true], ['agreements', false], ['team', true], ['patients', false], ['first-prescription', true],
    ])
    for (const call of db.calls) {
      if (['clinics', 'providers', 'patients', 'orders', 'agreement_acceptances'].includes(call.table)) {
        expect(call.filters['clinic_id']).toBe(CLINIC)
      }
    }
    expect(db.to('orders', 'select')[0]!.filters['locked_at:not']).toEqual(['is', null])
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
