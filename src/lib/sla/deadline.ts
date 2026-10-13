// Has an SLA deadline passed? Compares instants, not strings: Postgres
// returns timestamptz with an offset ("+00:00", or another zone's) and
// toISOString() returns "Z", so string order is not time order. A missing
// or unparseable deadline has not passed.

export function deadlinePassed(deadlineAt: string | null | undefined, nowMs: number): boolean {
  if (!deadlineAt) return false
  const ms = Date.parse(deadlineAt)
  return !Number.isNaN(ms) && ms < nowMs
}
