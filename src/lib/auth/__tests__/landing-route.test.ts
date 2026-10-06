/**
 * @jest-environment node
 *
 * Where a signed-in user lands. The clinic admin lands on the Practice
 * dashboard; providers and medical assistants on /dashboard; ops on the
 * pipeline. A safe in-app return target always wins over the default.
 */

import { defaultLandingRoute, postLoginDestination } from '../landing-route'

describe('defaultLandingRoute', () => {
  it('sends the clinic admin to the Practice dashboard', () => {
    expect(defaultLandingRoute('clinic_admin')).toBe('/practice')
  })

  it('sends a provider to /dashboard', () => {
    expect(defaultLandingRoute('provider')).toBe('/dashboard')
  })

  it('sends a medical assistant to /dashboard', () => {
    expect(defaultLandingRoute('medical_assistant')).toBe('/dashboard')
  })

  it('sends ops to the pipeline', () => {
    expect(defaultLandingRoute('ops_admin')).toBe('/ops/pipeline')
  })

  it('falls back to /dashboard when the role is missing or unknown', () => {
    expect(defaultLandingRoute(undefined)).toBe('/dashboard')
    expect(defaultLandingRoute('something_else')).toBe('/dashboard')
  })
})

describe('postLoginDestination', () => {
  it('uses the role default when there is no return target', () => {
    expect(postLoginDestination('clinic_admin', null)).toBe('/practice')
    expect(postLoginDestination('provider', null)).toBe('/dashboard')
    expect(postLoginDestination('medical_assistant', undefined)).toBe('/dashboard')
    expect(postLoginDestination('ops_admin', '')).toBe('/ops/pipeline')
  })

  it('lets an in-app return target win over the admin default', () => {
    expect(postLoginDestination('clinic_admin', '/dashboard')).toBe('/dashboard')
    expect(postLoginDestination('clinic_admin', '/new-prescription?x=1')).toBe('/new-prescription?x=1')
    expect(postLoginDestination('provider', '/settings')).toBe('/settings')
  })

  it('treats a bare "/" return target as no target (lands on the role default)', () => {
    expect(postLoginDestination('clinic_admin', '/')).toBe('/practice')
    expect(postLoginDestination('provider', '/')).toBe('/dashboard')
  })

  it('ignores absolute and protocol-relative return targets', () => {
    expect(postLoginDestination('clinic_admin', 'https://evil.example.com')).toBe('/practice')
    expect(postLoginDestination('clinic_admin', '//evil.example.com')).toBe('/practice')
    expect(postLoginDestination('provider', '/\\evil.example.com')).toBe('/dashboard')
  })
})
