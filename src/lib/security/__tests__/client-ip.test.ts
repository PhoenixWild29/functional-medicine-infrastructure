/**
 * @jest-environment node
 *
 * L8 (Oct 24 security review): the client IP used for rate limits and the
 * keyed audit hashes. Prefer the header Vercel's edge sets and a client
 * cannot (x-vercel-forwarded-for), then x-real-ip, then the first
 * x-forwarded-for hop. One helper; every reader uses it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { clientIp } from '../client-ip'

const h = (entries: Record<string, string>) => new Headers(entries)

describe('clientIp', () => {
  it('x-vercel-forwarded-for wins over x-real-ip and x-forwarded-for', () => {
    expect(clientIp(h({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '192.0.2.1, 10.0.0.1' }))).toBe('203.0.113.7')
  })
  it('x-vercel-forwarded-for with more than one hop: the first, trimmed', () => {
    expect(clientIp(h({ 'x-vercel-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }))).toBe('203.0.113.7')
  })
  it('no Vercel header: x-real-ip wins over x-forwarded-for', () => {
    expect(clientIp(h({ 'x-real-ip': ' 198.51.100.2 ', 'x-forwarded-for': '192.0.2.1' }))).toBe('198.51.100.2')
  })
  it('only x-forwarded-for: its first hop, trimmed (a spoofed first hop is all there is)', () => {
    expect(clientIp(h({ 'x-forwarded-for': ' 192.0.2.1 , 10.0.0.1, 10.0.0.2' }))).toBe('192.0.2.1')
  })
  it('empty or blank values fall through to the next header', () => {
    expect(clientIp(h({ 'x-vercel-forwarded-for': '  ', 'x-real-ip': '', 'x-forwarded-for': '192.0.2.1' }))).toBe('192.0.2.1')
    expect(clientIp(h({ 'x-vercel-forwarded-for': ',', 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2')
  })
  it('no headers at all, or none of these: null', () => {
    expect(clientIp(null)).toBeNull()
    expect(clientIp(undefined)).toBeNull()
    expect(clientIp(h({}))).toBeNull()
    expect(clientIp(h({ 'user-agent': 'x' }))).toBeNull()
  })
  it('accepts any { get } (a NextRequest header bag)', () => {
    expect(clientIp({ get: (n: string) => (n === 'x-real-ip' ? '198.51.100.9' : null) })).toBe('198.51.100.9')
  })
})

it('no code outside the helper reads an IP header itself', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(full); continue }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
      if (full.endsWith(join('lib', 'security', 'client-ip.ts'))) continue
      if (/['"]x-(vercel-)?forwarded-for['"]|['"]x-real-ip['"]/i.test(readFileSync(full, 'utf8'))) offenders.push(full)
    }
  }
  walk(join(process.cwd(), 'src'))
  expect(offenders).toEqual([])
})
