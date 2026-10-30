/**
 * @jest-environment node
 *
 * The plan link token (copied from the intake token and its tests): 32
 * random bytes, base64url (43 characters); only its SHA-256 hex is stored;
 * 7 days; revoked when re-sent (a new token replaces the stored hash); dead
 * once the choice is signed, or the proposal is declined, expired or
 * cancelled. 5 wrong dates of birth lock it for 15 minutes only.
 */

import { createHash } from 'node:crypto'
import {
  hashProposalToken, isWellFormedProposalToken, newProposalToken, proposalLinkExpiresAt, proposalLinkState,
  PROPOSAL_LINK_TTL_DAYS, MAX_DOB_FAILURES, DOB_LOCK_MINUTES, isDobLockActive,
} from '../token'

const NOW = new Date('2026-10-24T12:00:00Z')

describe('the token', () => {
  it('is 43 base64url characters, different every time', () => {
    const a = newProposalToken()
    const b = newProposalToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(isWellFormedProposalToken(a)).toBe(true)
  })

  it('rejects anything that is not a token before touching the database', () => {
    for (const bad of ['', 'abc', 'x'.repeat(43) + '=', '../../etc/passwd', 'a b'.padEnd(43, 'c'), 'x'.repeat(44)]) {
      expect(isWellFormedProposalToken(bad)).toBe(false)
    }
  })

  it('is stored as its SHA-256 hex, matching the migration CHECK', () => {
    const token = newProposalToken()
    const hash = hashProposalToken(token)
    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
  })

  it('lasts 7 days', () => {
    expect(PROPOSAL_LINK_TTL_DAYS).toBe(7)
    expect(proposalLinkExpiresAt(NOW).toISOString()).toBe('2026-10-31T12:00:00.000Z')
  })
})

describe('the link state', () => {
  const token = newProposalToken()
  const open = {
    status: 'sent' as const,
    token_hash: hashProposalToken(token),
    expires_at: proposalLinkExpiresAt(NOW).toISOString(),
    locked_at: null as string | null,
  }

  it('open while sent or chosen, before it expires, unlocked, for the current token', () => {
    expect(proposalLinkState(open, token, NOW)).toBe('open')
    expect(proposalLinkState({ ...open, status: 'chosen' }, token, NOW)).toBe('open')
  })

  it('re-sent: the old token no longer matches the stored hash (revoked)', () => {
    const resent = { ...open, token_hash: hashProposalToken(newProposalToken()) }
    expect(proposalLinkState(resent, token, NOW)).toBe('not_found')
  })

  it('past its 7 days: expired', () => {
    expect(proposalLinkState(open, token, new Date('2026-10-31T12:00:01Z'))).toBe('expired')
  })

  it('5 wrong dates of birth lock it for 15 minutes, then it is open again', () => {
    expect(MAX_DOB_FAILURES).toBe(5)
    expect(DOB_LOCK_MINUTES).toBe(15)
    expect(proposalLinkState({ ...open, locked_at: NOW.toISOString() }, token, NOW)).toBe('locked')
    expect(proposalLinkState({ ...open, locked_at: '2026-10-24T11:45:01Z' }, token, NOW)).toBe('locked')
    expect(proposalLinkState({ ...open, locked_at: '2026-10-24T11:45:00Z' }, token, NOW)).toBe('open')
    expect(proposalLinkState({ ...open, locked_at: '2026-10-23T12:00:00Z' }, token, NOW)).toBe('open')
  })

  it('an expired link says expired, locked or not', () => {
    expect(proposalLinkState({ ...open, locked_at: '2026-10-31T11:59:00Z' }, token, new Date('2026-10-31T12:00:01Z'))).toBe('expired')
  })

  it('isDobLockActive: none, active, lapsed', () => {
    expect(isDobLockActive(null, NOW)).toBe(false)
    expect(isDobLockActive('2026-10-24T11:50:00Z', NOW)).toBe(true)
    expect(isDobLockActive('2026-10-24T11:44:59Z', NOW)).toBe(false)
  })

  it('dies once signed; closed once declined, expired or cancelled; nothing before it is sent', () => {
    expect(proposalLinkState({ ...open, status: 'signed' }, token, NOW)).toBe('signed')
    for (const status of ['declined', 'expired', 'cancelled'] as const) expect(proposalLinkState({ ...open, status }, token, NOW)).toBe('closed')
    expect(proposalLinkState({ ...open, status: 'draft' }, token, NOW)).toBe('not_found')
    expect(proposalLinkState({ ...open, token_hash: null }, token, NOW)).toBe('not_found')
  })

  it('a malformed token is not found without comparing anything', () => {
    expect(proposalLinkState(open, 'nope', NOW)).toBe('not_found')
  })
})
