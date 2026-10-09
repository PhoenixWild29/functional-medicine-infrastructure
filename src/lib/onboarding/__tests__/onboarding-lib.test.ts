/**
 * @jest-environment node
 *
 * Clinic onboarding building blocks:
 *   - invite tokens: random, single-use, stored only as a SHA-256 hash,
 *     expiring after 7 days; the link carries the token, the database
 *     never does
 *   - the wizard steps, where to resume, and what submit requires
 *   - practice details: tax ID last 4 only, Type 2 NPI checksum, US
 *     address and phone
 *   - agreements: a draft template with a version and the hash of its
 *     exact text
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  newInviteToken, hashInviteToken, inviteExpiresAt, inviteStatus, invitePath, INVITE_TTL_DAYS,
} from '../tokens'
import { ONBOARDING_STEPS, REQUIRED_FOR_SUBMIT, firstOpenStep, canSubmit } from '../steps'
import { validatePracticeDetails } from '../practice'
import { AGREEMENTS, agreementSha256 } from '../agreements'

describe('invite tokens', () => {
  it('are long, random and URL-safe', () => {
    const a = newInviteToken()
    const b = newInviteToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/)
  })

  it('are stored only as their SHA-256 hash', () => {
    const t = newInviteToken()
    expect(hashInviteToken(t)).toBe(createHash('sha256').update(t).digest('hex'))
    expect(hashInviteToken(t)).not.toContain(t)
  })

  it('expire after 7 days', () => {
    expect(INVITE_TTL_DAYS).toBe(7)
    const now = new Date('2026-10-10T12:00:00Z')
    expect(inviteExpiresAt(now).toISOString()).toBe('2026-10-17T12:00:00.000Z')
  })

  it('have one status: pending, accepted, revoked or expired', () => {
    const now = new Date('2026-10-10T12:00:00Z')
    const base = { accepted_at: null, revoked_at: null, expires_at: '2026-10-12T00:00:00Z' }
    expect(inviteStatus(base, now)).toBe('pending')
    expect(inviteStatus({ ...base, accepted_at: '2026-10-09T00:00:00Z' }, now)).toBe('accepted')
    expect(inviteStatus({ ...base, revoked_at: '2026-10-09T00:00:00Z' }, now)).toBe('revoked')
    expect(inviteStatus({ ...base, expires_at: '2026-10-10T11:59:59Z' }, now)).toBe('expired')
    // accepted wins over a later expiry
    expect(inviteStatus({ ...base, accepted_at: '2026-10-09T00:00:00Z', expires_at: '2026-10-01T00:00:00Z' }, now)).toBe('accepted')
  })

  it('link to the clinic page for a clinic admin and the join page for staff', () => {
    expect(invitePath('clinic_admin', 'tok')).toBe('/onboard/clinic/tok')
    expect(invitePath('provider', 'tok')).toBe('/onboard/join/tok')
    expect(invitePath('medical_assistant', 'tok')).toBe('/onboard/join/tok')
  })
})

describe('wizard steps', () => {
  it('run practice, providers, staff, BAA, terms, payouts, review', () => {
    expect(ONBOARDING_STEPS).toEqual(['practice', 'providers', 'staff', 'baa', 'terms', 'payouts', 'review'])
  })

  it('resume at the first step that is not complete', () => {
    expect(firstOpenStep({})).toBe('practice')
    expect(firstOpenStep({ practice: 'complete', providers: 'complete' })).toBe('staff')
    expect(firstOpenStep({ practice: 'complete', providers: 'in_progress' })).toBe('providers')
    const allDone = Object.fromEntries(ONBOARDING_STEPS.filter(s => s !== 'review').map(s => [s, 'complete']))
    expect(firstOpenStep(allDone)).toBe('review')
  })

  it('submit needs practice, providers, BAA and terms complete', () => {
    expect(REQUIRED_FOR_SUBMIT).toEqual(['practice', 'providers', 'baa', 'terms'])
    expect(canSubmit({ practice: 'complete' })).toEqual({ ok: false, missing: ['providers', 'baa', 'terms'] })
    expect(canSubmit({ practice: 'complete', providers: 'complete', baa: 'complete', terms: 'complete' })).toEqual({ ok: true, missing: [] })
  })
})

describe('practice details', () => {
  const good = {
    legalName: 'Sunrise Functional Medicine PLLC', dbaName: 'Sunrise Clinic',
    addressLine1: '100 Main St', addressLine2: 'Suite 2', city: 'Austin', state: 'tx', postalCode: '78701',
    phone: '(512) 555-0100', practiceNpi: '1234567893', taxIdLast4: '1234', absorbShipping: false,
  }

  it('accepts a complete practice and normalises it', () => {
    const r = validatePracticeDetails(good)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual(expect.objectContaining({ state: 'TX', phone: '5125550100', practiceNpi: '1234567893', taxIdLast4: '1234' }))
    }
  })

  it('takes the last 4 of the tax ID only, never the whole number', () => {
    const r = validatePracticeDetails({ ...good, taxIdLast4: '12-3456789' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['taxIdLast4']).toMatch(/last 4/i)
  })

  it('checks a practice NPI with the NPI check digit, and allows none', () => {
    const bad = validatePracticeDetails({ ...good, practiceNpi: '1234567890' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors['practiceNpi']).toBeDefined()
    const none = validatePracticeDetails({ ...good, practiceNpi: '' })
    expect(none.ok).toBe(true)
    if (none.ok) expect(none.value.practiceNpi).toBeNull()
  })

  it('requires a legal name, a US address and a 10-digit phone', () => {
    const r = validatePracticeDetails({ ...good, legalName: ' ', state: 'ZZ', postalCode: '7870', phone: '555' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['legalName', 'phone', 'postalCode', 'state'])
  })
})

describe('agreements', () => {
  it('the BAA is the v0.1 draft in src/content/legal, word for word, with its exact SHA-256', () => {
    const md = readFileSync(join(process.cwd(), 'src', 'content', 'legal', 'baa-draft-v0.1.md'), 'utf8').replace(/\r\n/g, '\n')
    expect(AGREEMENTS.baa.version).toBe('v0.1')
    expect(AGREEMENTS.baa.text).toBe(md)
    expect(agreementSha256(AGREEMENTS.baa.text)).toBe('14367b35e4b4ef51e6ed53d150275474635929a38c9bb900eef8d6e77ebc064e')
  })

  it('the terms stay a draft of our own, versioned', () => {
    expect(AGREEMENTS.terms.version).toMatch(/draft/)
  })

  it.each(['baa', 'terms'] as const)('%s is a versioned draft whose text hash is SHA-256', key => {
    const a = AGREEMENTS[key]
    expect(a.draft).toBe(true)
    expect(a.version).toMatch(/^[a-z0-9.-]+$/)
    expect(a.text.length).toBeGreaterThan(200)
    expect(agreementSha256(a.text)).toBe(createHash('sha256').update(a.text, 'utf8').digest('hex'))
  })
})
