// ============================================================
// E2E shards: which shard this run is, and its own ids and logins
// ============================================================
//
// Two Playwright shards (`--shard=1/2`, `--shard=2/2`) can run at the same
// time against the ONE E2E Supabase project. Each shard gets its own
// clinic, providers, patients and logins, derived from the shard number,
// so neither touches the other's rows. Pharmacies and the catalog are
// shared, read-only reference data.
//
// Shard 1 (and a run without --shard) keeps the ids and emails E2E has
// always used, so the normal single-shard PR run is unchanged.
//
// The shard number comes from TEST_SHARD, which playwright.config.ts sets
// from --shard before workers, globalSetup or the web server start.

/** This run's shard, 1-based. 1 without --shard. */
export function shardIndex(): number {
  const n = Number(process.env['TEST_SHARD'] ?? '1')
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n : 1
}

/**
 * A shard's copy of a fixed test id (a seeded clinic, provider or patient,
 * or a spec's own fixed row). Shard 1 returns the id unchanged; shard N
 * rewrites the first 8 hex digits to '5' + digits 2-7 + N, e.g.
 * aaaaaaaa-... -> 5aaaaaa2-..., bbbbbbbb-... -> 5bbbbbb2-... (still a valid
 * UUID, and no E2E id starts with '5', so shards never collide).
 */
export function shardId(id: string, shard: number = shardIndex()): string {
  if (shard === 1) return id
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error(`shardId: ${id} is not a UUID`)
  return `5${id.slice(1, 7)}${shard}${id.slice(8)}`
}

/** A shard's copy of a fixed NPI (unique among live providers): shard N ends in '9' + N. */
export function shardNpi(npi: string, shard: number = shardIndex()): string {
  return shard === 1 ? npi : `${npi.slice(0, 8)}9${shard}`
}

/** A shard's copy of a fixed slug (pharmacy slugs are unique): shard N gets "-sN". */
export function shardSlug(slug: string, shard: number = shardIndex()): string {
  return shard === 1 ? slug : `${slug}-s${shard}`
}

/** A shard's copy of a test email: shard 1 unchanged, shard N gets "+sN". */
export function shardEmail(email: string, shard: number = shardIndex()): string {
  if (shard === 1) return email
  const at = email.indexOf('@')
  return `${email.slice(0, at)}+s${shard}${email.slice(at)}`
}

/** A shard's copy of a display name: shard 1 unchanged, shard N gets " S<N>". */
export function shardName(name: string, shard: number = shardIndex()): string {
  return shard === 1 ? name : `${name} S${shard}`
}

/** A shard's copy of a phone number: shard N moves the last digits into its own block. */
export function shardPhone(phone: string, shard: number = shardIndex()): string {
  if (shard === 1) return phone
  // +1555000000X -> +155500N000X: same length, same shape, unique per shard.
  return `${phone.slice(0, -4)}${shard}${phone.slice(-3)}`
}

/**
 * A shard's copy of an email prefix that a spec's cleanup matches with
 * startsWith (it also sweeps up a crashed run's leftovers). Shard 1 keeps
 * the prefix; shard N puts "sN-" in front, so shard 1's startsWith never
 * matches another shard's accounts, and each shard sweeps only its own.
 */
export function shardPrefix(prefix: string, shard: number = shardIndex()): string {
  return shard === 1 ? prefix : `s${shard}-${prefix}`
}
