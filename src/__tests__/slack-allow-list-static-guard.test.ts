/**
 * @jest-environment node
 *
 * Static check: every Slack payload is built by the one allow-list helper,
 * src/lib/slack/ops-alert.ts. No other file writes Slack Block Kit (a
 * header, a mrkdwn field, plain_text) or a raw `{ text: ... }` payload, and
 * the senders accept only the helper's branded SafeSlackPayload, so the
 * type checker refuses anything built by hand.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(process.cwd(), 'src')
const HELPER = 'src/lib/slack/ops-alert.ts'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sourceFiles(p)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}
const rel = (p: string) => relative(process.cwd(), p).split(sep).join('/')

const files = sourceFiles(SRC)

it('only the helper writes Slack Block Kit', () => {
  const offenders = files
    .filter(p => rel(p) !== HELPER)
    .filter(p => /['"]mrkdwn['"]|type:\s*['"]header['"]|['"]plain_text['"]/.test(readFileSync(p, 'utf8')))
    .map(rel)
  expect(offenders).toEqual([])
})

it('the senders take only the helper-branded payload', () => {
  const client = readFileSync(join(SRC, 'lib', 'slack', 'client.ts'), 'utf8')
  expect(client).toMatch(/export async function sendSlackAlert\(payload: SafeSlackPayload\)/)
  expect(client).toMatch(/export async function sendSlackMessage\(\s*channelOrUserId: string,\s*payload:\s*SafeSlackPayload/)
})

it('no call site hands the senders a payload literal', () => {
  const offenders = files
    .filter(p => /send(SlackAlert|SlackMessage)\(\s*(?:[A-Za-z_.]+,\s*)?\{/.test(readFileSync(p, 'utf8')))
    .map(rel)
  expect(offenders).toEqual([])
})

it('the brand is created only in the helper', () => {
  const offenders = files
    .filter(p => rel(p) !== HELPER && /as SafeSlackPayload/.test(readFileSync(p, 'utf8')))
    .map(rel)
  expect(offenders).toEqual([])
})
