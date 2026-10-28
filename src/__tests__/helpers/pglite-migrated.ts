// ============================================================
// Run SQL on a Postgres with every repo migration applied (PGlite)
// ============================================================
//
// For tests that must run real RLS: the policies, functions and grants are
// exactly the migrations' (supabase/migrations, in filename order), on top
// of a minimal Supabase stand-in (src/__tests__/fixtures/pglite-
// bootstrap.sql: roles, auth.jwt(), storage, vault, default grants).
//
// PGlite runs in a child Node process (./pglite-runner.mjs): it loads its
// WebAssembly with dynamic import(), which jest's CommonJS runtime
// refuses. runPlan sends the steps and returns each step's rows or error;
// see the runner for the step shapes. Applying the migrations takes a
// while, so send one plan per test file.
//
// The child runs asynchronously (spawn, not spawnSync): a synchronous child
// blocks the jest worker's event loop, so jest's timeout could not fire and
// a hung runner would hold the worker (and CI) until its own kill timer.
// The kill timer stays as a backstop.
//
// Test-only: nothing here touches a real database.

import { spawn } from 'node:child_process'
import { join } from 'node:path'

export interface PlanStep {
  id:       string
  sql:      string
  /** As the owner, committed (seed, settings). */
  persist?: boolean
  /** Run as `authenticated` with these JWT claims (rolled back). */
  claims?:  Record<string, unknown>
  /** Run as this role instead (rolled back). */
  role?:    'service_role' | 'anon'
  /** Owner SQL in the same transaction, before the role switch. */
  pre?:     string
}

export interface StepResult { id: string; rows?: Array<Record<string, unknown>>; error?: string }

const RUNNER_TIMEOUT_MS = 15 * 60 * 1000

export function runPlan(steps: PlanStep[]): Promise<Map<string, StepResult>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, 'pglite-runner.mjs')], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    const timer = setTimeout(() => child.kill(), RUNNER_TIMEOUT_MS)
    child.stdout.on('data', (b: Buffer) => out.push(b))
    child.stderr.on('data', (b: Buffer) => err.push(b))
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`pglite runner failed (${code ?? signal}): ${Buffer.concat(err).toString('utf8')}`))
        return
      }
      try {
        const line = Buffer.concat(out).toString('utf8').trim().split('\n').pop() ?? ''
        const parsed = JSON.parse(line) as { results?: StepResult[]; migrationError?: string }
        if (parsed.migrationError) throw new Error(`a migration failed on PGlite: ${parsed.migrationError}`)
        resolve(new Map((parsed.results ?? []).map(r => [r.id, r])))
      } catch (e) {
        reject(e)
      }
    })
    child.stdin.end(JSON.stringify({ steps }))
  })
}
