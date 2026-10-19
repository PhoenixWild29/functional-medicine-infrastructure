/**
 * @jest-environment node
 *
 * Team invites: a deactivated team member (app_metadata deactivated_at,
 * set only by set_clinic_member_active with the service role) has no role
 * and no clinic, so no page or route lets them act. claims.ts stays the
 * one place role and clinic are read.
 */

import { getUserClinicId, getUserRole, isDeactivated } from '../claims'

const active = { app_metadata: { app_role: 'medical_assistant', clinic_id: 'c-1' } }
const deactivated = { app_metadata: { app_role: 'medical_assistant', clinic_id: 'c-1', deactivated_at: '2026-10-18T10:00:00Z', deactivated_by: 'u-admin' } }

it('an active member: role and clinic as before', () => {
  expect(isDeactivated(active)).toBe(false)
  expect(getUserRole(active)).toBe('medical_assistant')
  expect(getUserClinicId(active)).toBe('c-1')
})

it('a deactivated member: no role, no clinic', () => {
  expect(isDeactivated(deactivated)).toBe(true)
  expect(getUserRole(deactivated)).toBeUndefined()
  expect(getUserClinicId(deactivated)).toBeUndefined()
})

it('only app_metadata counts: user_metadata cannot deactivate (or reactivate) anyone', () => {
  const viaUserMeta = { ...active, user_metadata: { deactivated_at: '2026-10-18T10:00:00Z' } }
  expect(isDeactivated(viaUserMeta)).toBe(false)
  expect(getUserRole(viaUserMeta)).toBe('medical_assistant')
})

it.each([null, undefined, {}, { app_metadata: null }, { app_metadata: { deactivated_at: '' } }])('%j is not deactivated', u => {
  expect(isDeactivated(u as never)).toBe(false)
})
