// ============================================================
// Failed sign-in monitoring, alerting and throttling (security B12)
// ============================================================
//
// Sign-in and the MFA challenge go through the server (POST /api/sign-in,
// POST /api/mfa/verify), so the app sees every failure the login and MFA
// pages produce. Each one is:
//
//   1. Recorded in ops_alert_queue as alert_type 'auth_failure', a
//      record-only row (sent_at set when written, so the queue flush
//      never posts it). metadata: the step (password or mfa), a reason
//      code, the email as its keyed hash (lib/audit/keyed-hash, the same
//      HMAC as the PHI access log), the client IP and user agent, and for
//      an MFA failure the user's id and role. No migration: the queue is
//      service-role only (RLS on, no policies) and retention deletes its
//      sent rows after a year.
//   2. Counted against the alert rules over the last 15 minutes:
//        - 5 failures for one account;
//        - 20 failures from one IP;
//        - any failure on an ops_admin or pharmacy_admin account (until
//          the account rule fires for it, which then covers it).
//      A rule fires once, when the count reaches its threshold, so an
//      attack sends one alert per rule, not one per attempt.
//   3. Alerted in Slack through buildOpsAlert: the step, reason code,
//      count, window, role and keyed-hash prefixes only (never the email
//      or the IP). Each alert is also written as an 'auth_failure_alert'
//      row (with the IP, for the Ops Security page); one Slack could not
//      take stays unsent, and the reconciliation cron's flush retries it.
//
// Throttling: after 5 failures for one account, or 20 from one IP, within
// 5 minutes, further attempts are refused (429) for the rest of that
// 5-minute window. In memory per instance (lib/security/rate-limit), so a
// short delay, never a lock-out: nothing is stored, and it ends by itself.
// Supabase Auth's own per-IP limits stay in front of it.
//
// Nothing here may break a sign-in: every database and Slack error is
// logged (codes only) and swallowed.

import type { SupabaseClient } from '@supabase/supabase-js'
import { auditHash } from '@/lib/audit/keyed-hash'
import { createRateLimiter, type RateLimitResult } from '@/lib/security/rate-limit'
import { sendSlackAlert } from '@/lib/slack/client'
import { buildOpsAlert, type SafeSlackPayload } from '@/lib/slack/ops-alert'

export const AUTH_FAILURE = 'auth_failure'
export const AUTH_FAILURE_ALERT = 'auth_failure_alert'

export const ALERT_WINDOW_MINUTES = 15
export const ACCOUNT_ALERT_AT = 5
export const IP_ALERT_AT = 20
/** Roles whose every failed sign-in is alerted. */
export const PRIVILEGED_ROLES: ReadonlyArray<string> = ['ops_admin', 'pharmacy_admin']

export const THROTTLE_WINDOW_MS = 5 * 60_000
export const ACCOUNT_THROTTLE_AFTER = 5
export const IP_THROTTLE_AFTER = 20

export type SignInStep = 'password' | 'mfa'
export type AlertRule = 'account' | 'ip' | 'privileged'

export interface SignInFailure {
  step:       SignInStep
  email:      string | null | undefined
  /** Known for an MFA failure (the session's user). */
  userId?:    string | null
  /** Known for an MFA failure; looked up for a password failure. */
  role?:      string | null
  reason:     string
  ip:         string | null
  userAgent:  string | null
}

// ── Throttle ───────────────────────────────────────────────────

/** Counts failures only: peek before an attempt, fail() after one fails. */
export function createSignInThrottle(now?: () => number) {
  const opts = (limit: number) => ({ limit, windowMs: THROTTLE_WINDOW_MS, ...(now ? { now } : {}) })
  const account = createRateLimiter(opts(ACCOUNT_THROTTLE_AFTER))
  const ip      = createRateLimiter(opts(IP_THROTTLE_AFTER))
  const ipKey = (v: string | null) => v ?? 'unknown'
  return {
    /** Refused when either the account or the IP is over its limit; the longer wait wins. */
    peek(keys: { account: string; ip: string | null }): RateLimitResult {
      const a = account.peek(keys.account)
      const i = ip.peek(ipKey(keys.ip))
      if (a.allowed && i.allowed) return { allowed: true, retryAfterSeconds: 0 }
      return { allowed: false, retryAfterSeconds: Math.max(a.retryAfterSeconds, i.retryAfterSeconds) }
    },
    fail(keys: { account: string; ip: string | null }): void {
      account.check(keys.account)
      ip.check(ipKey(keys.ip))
    },
    reset() { account.reset(); ip.reset() },
  }
}

/** One per server instance, shared by the sign-in and MFA routes. */
export const signInThrottle = createSignInThrottle()

/** The message for a throttled attempt (no em dash: UI copy). */
export function throttledMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return `Too many attempts. Wait ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} and try again.`
}

// ── Rules and payloads ─────────────────────────────────────────

/** A Supabase error code as a short machine token, or 'unknown'. */
export function reasonCode(code: unknown): string {
  return typeof code === 'string' && /^[a-z0-9_]{1,40}$/.test(code) ? code : 'unknown'
}

export function alertRules(args: { accountCount: number; ipCount: number; privileged: boolean }): AlertRule[] {
  const rules: AlertRule[] = []
  if (args.accountCount === ACCOUNT_ALERT_AT) rules.push('account')
  if (args.ipCount === IP_ALERT_AT) rules.push('ip')
  if (args.privileged && args.accountCount < ACCOUNT_ALERT_AT) rules.push('privileged')
  return rules
}

const ALERT_TYPE = {
  account:    'auth_failures_account',
  ip:         'auth_failures_ip',
  privileged: 'auth_failure_privileged',
} as const

/** A keyed-hash prefix as a Slack-safe token ("acct:1a2b..."), or undefined. */
function ref(prefix: string, hash: string | null): string | undefined {
  return hash ? `${prefix}:${hash.slice(0, 12)}` : undefined
}

export function buildAuthAlert(rule: AlertRule, ctx: {
  step: SignInStep; reason: string; count: number; role: string | null; emailHash: string | null; ipHash: string | null
}): SafeSlackPayload {
  return buildOpsAlert({
    type: ALERT_TYPE[rule],
    details: {
      sign_in_step:   ctx.step,
      code:           ctx.reason,
      attempts:       ctx.count,
      window_minutes: ALERT_WINDOW_MINUTES,
      actor:          ctx.role ?? undefined,
      account_ref:    rule === 'ip' ? undefined : ref('acct', ctx.emailHash),
      ip_ref:         ref('ip', ctx.ipHash),
    },
    notes: ['auth_review'],
  })
}

// ── Privileged accounts (a failed password sign-in has no user) ─

const PRIVILEGED_TTL_MS = 10 * 60_000
let privilegedCache: { at: number; byEmail: Map<string, string> } | null = null

/** For tests. */
export function resetPrivilegedCache(): void { privilegedCache = null }

/**
 * The ops_admin or pharmacy_admin role of the account with this email, or
 * null. The list of such accounts (a few) is read from Supabase Auth with
 * the service role at most every 10 minutes, and kept in memory only.
 */
export async function privilegedRoleFor(svc: SupabaseClient, email: string | null | undefined, now = Date.now()): Promise<string | null> {
  if (!email) return null
  if (!privilegedCache || now - privilegedCache.at >= PRIVILEGED_TTL_MS) {
    const byEmail = new Map<string, string>()
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) { console.error('[sign-in-monitor] listUsers failed:', error.code ?? error.name); return null }
      for (const u of data.users) {
        const role = (u.app_metadata as { app_role?: unknown } | undefined)?.app_role
        if (typeof role === 'string' && PRIVILEGED_ROLES.includes(role) && u.email) byEmail.set(u.email.toLowerCase(), role)
      }
      if (data.users.length < 1000) break
    }
    privilegedCache = { at: now, byEmail }
  }
  return privilegedCache.byEmail.get(email.trim().toLowerCase()) ?? null
}

// ── Record, count, alert ───────────────────────────────────────

export interface MonitorDeps {
  send?:           (payload: SafeSlackPayload) => Promise<void>
  roleForEmail?:   (svc: SupabaseClient, email: string | null | undefined) => Promise<string | null>
  now?:            () => Date
}

async function countSince(svc: SupabaseClient, since: string, field: 'email_hash' | 'ip', value: string): Promise<number> {
  const { count, error } = await svc.from('ops_alert_queue')
    .select('alert_id', { count: 'exact', head: true })
    .eq('alert_type', AUTH_FAILURE)
    .gte('created_at', since)
    .filter(`metadata->>${field}`, 'eq', value)
  if (error) { console.error(`[sign-in-monitor] count by ${field} failed:`, error.code ?? 'unknown'); return 0 }
  return count ?? 0
}

/** Records one failed sign-in or MFA challenge and sends any alert it triggers. Never throws. */
export async function recordSignInFailure(svc: SupabaseClient, failure: SignInFailure, deps: MonitorDeps = {}): Promise<{ alerts: AlertRule[] }> {
  const send = deps.send ?? sendSlackAlert
  const roleForEmail = deps.roleForEmail ?? privilegedRoleFor
  const now = (deps.now ?? (() => new Date()))()
  try {
    const email     = failure.email?.trim().toLowerCase() || null
    const emailHash = await auditHash(email)
    const ipHash    = await auditHash(failure.ip)
    const reason    = reasonCode(failure.reason)

    const { error: insertError } = await svc.from('ops_alert_queue').insert({
      alert_type: AUTH_FAILURE,
      message:    `Failed sign-in (${failure.step} step). Record only: not posted to Slack.`,
      metadata:   {
        step: failure.step, reason, email_hash: emailHash, ip: failure.ip, user_agent: failure.userAgent?.slice(0, 300) ?? null,
        ...(failure.userId ? { user_id: failure.userId } : {}),
        ...(failure.role ? { role: failure.role } : {}),
      },
      severity:   'info',
      sent_at:    now.toISOString(),
    })
    if (insertError) console.error('[sign-in-monitor] failed to record a sign-in failure:', insertError.code ?? 'unknown')

    const since = new Date(now.getTime() - ALERT_WINDOW_MINUTES * 60_000).toISOString()
    const [accountCount, ipCount] = await Promise.all([
      emailHash ? countSince(svc, since, 'email_hash', emailHash) : Promise.resolve(0),
      failure.ip ? countSince(svc, since, 'ip', failure.ip) : Promise.resolve(0),
    ])
    const role = failure.role ?? await roleForEmail(svc, email)
    const privileged = role !== null && PRIVILEGED_ROLES.includes(role)
    const rules = alertRules({ accountCount, ipCount, privileged })

    for (const rule of rules) {
      const count = rule === 'ip' ? ipCount : accountCount
      let sentAt: string | null = null
      try {
        await send(buildAuthAlert(rule, { step: failure.step, reason, count, role, emailHash, ipHash }))
        sentAt = new Date().toISOString()
      } catch (err) {
        console.error(`[sign-in-monitor] Slack alert (${rule}) failed; left queued:`, err instanceof Error ? err.name : 'unknown')
      }
      const { error } = await svc.from('ops_alert_queue').insert({
        alert_type: AUTH_FAILURE_ALERT,
        message:    `Failed sign-in alert: ${rule} rule (${count} in ${ALERT_WINDOW_MINUTES} minutes).`,
        metadata:   { rule, step: failure.step, reason, count, role, email_hash: emailHash, ip: failure.ip, ip_hash: ipHash },
        severity:   privileged ? 'critical' : 'warning',
        sent_at:    sentAt,
      })
      if (error) console.error('[sign-in-monitor] failed to record an alert:', error.code ?? 'unknown')
    }
    return { alerts: rules }
  } catch (err) {
    console.error('[sign-in-monitor] failed:', err instanceof Error ? err.name : 'unknown')
    return { alerts: [] }
  }
}

// ── Ops Security page ──────────────────────────────────────────

export interface SignInAlertRow {
  alertId:    string
  createdAt:  string
  rule:       string
  step:       string
  reason:     string
  count:      number | null
  role:       string | null
  /** The first 12 hex of the email's keyed hash (match it by hashing a candidate). */
  accountRef: string | null
  ip:         string | null
  sent:       boolean
}

export type SignInAlertList =
  | { ok: true; alerts: SignInAlertRow[]; failures24h: number }
  | { ok: false; error: string }

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** The last 7 days of failed sign-in alerts (newest first, at most 100), and the failures recorded in the last 24 hours. */
export async function listSignInAlerts(svc: SupabaseClient, now = new Date()): Promise<SignInAlertList> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const dayAgo  = new Date(now.getTime() - 86_400_000).toISOString()
  const [alerts, failures] = await Promise.all([
    svc.from('ops_alert_queue').select('alert_id, created_at, metadata, sent_at')
      .eq('alert_type', AUTH_FAILURE_ALERT).gte('created_at', weekAgo)
      .order('created_at', { ascending: false }).limit(100),
    svc.from('ops_alert_queue').select('alert_id', { count: 'exact', head: true })
      .eq('alert_type', AUTH_FAILURE).gte('created_at', dayAgo),
  ])
  if (alerts.error || failures.error) {
    console.error('[sign-in-monitor] list failed:', alerts.error?.code ?? failures.error?.code ?? 'unknown')
    return { ok: false, error: 'Failed sign-in alerts could not be loaded. Reload the page to try again.' }
  }
  const rows = (alerts.data ?? []) as Array<{ alert_id: string; created_at: string; metadata: Record<string, unknown> | null; sent_at: string | null }>
  return {
    ok: true,
    failures24h: failures.count ?? 0,
    alerts: rows.map(r => {
      const m = r.metadata ?? {}
      return {
        alertId:    r.alert_id,
        createdAt:  r.created_at,
        rule:       str(m['rule']) ?? 'unknown',
        step:       str(m['step']) ?? 'unknown',
        reason:     str(m['reason']) ?? 'unknown',
        count:      typeof m['count'] === 'number' ? m['count'] : null,
        role:       str(m['role']),
        accountRef: str(m['email_hash'])?.slice(0, 12) ?? null,
        ip:         str(m['ip']),
        sent:       r.sent_at !== null,
      }
    }),
  }
}
