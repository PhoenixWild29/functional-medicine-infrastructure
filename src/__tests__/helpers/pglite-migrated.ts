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
// Test-only: nothing here touches a real database.

import { spawnSync } from 'node:child_process'
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

export function runPlan(steps: PlanStep[]): Map<string, StepResult> {
  const out = spawnSync(process.execPath, [join(__dirname, 'pglite-runner.mjs')], {
    cwd: process.cwd(),
    input: JSON.stringify({ steps }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  })
  if (out.status !== 0) throw new Error(`pglite runner failed (${out.status}): ${out.stderr}`)
  const line = out.stdout.trim().split('\n').pop() ?? ''
  const parsed = JSON.parse(line) as { results?: StepResult[]; migrationError?: string }
  if (parsed.migrationError) throw new Error(`a migration failed on PGlite: ${parsed.migrationError}`)
  return new Map((parsed.results ?? []).map(r => [r.id, r]))
}
