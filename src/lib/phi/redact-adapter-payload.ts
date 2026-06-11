// ============================================================
// PHI Redactor for adapter_submissions.request_payload — Option B
// ============================================================
//
// Implements the "redact at write time" policy described in
// `docs/audits/phi-policy-adapter-submissions.md` (decided 2026-06-11).
//
// Invariant:
//   The pharmacy still receives the full, unredacted outbound JSON.
//   ONLY what we persist locally in `adapter_submissions.request_payload`
//   passes through this redactor first. Adapter behavior is unchanged.
//
// Strategy:
//   1. Walk the payload recursively. For every leaf whose KEY matches a
//      PHI field pattern (patient name/DOB/address, medication detail,
//      sig text, provider DEA, etc.), drop the value and replace it with
//      the literal token "[REDACTED]". Container keys (e.g. `patient`,
//      `prescriber`) are kept so the structural shape stays inspectable.
//   2. Compute a stable SHA-256 fingerprint over the ORIGINAL payload
//      (sorted-key JSON) so ops can correlate replays / disputes without
//      ever re-reading the PHI.
//
// Persistence:
//   The redacted payload is stored in `request_payload` (existing column).
//   The fingerprint is folded into the `metadata` JSONB column under the
//   reserved key `phi_fingerprint` — no schema migration required. See
//   `audit-trail.ts:markSubmitted` for the wiring.
//
// Forward-only:
//   This redactor only runs on NEW writes. Historical rows are left as-is
//   per the policy memo. A backfill is out of scope unless counsel asks
//   for one explicitly.

import { createHash } from 'crypto'

// ============================================================
// PHI FIELD CATALOG
// ============================================================
//
// Every transformer in `src/lib/adapters/transformers.ts` produces a
// pharmacy-specific shape. Field names differ across pharmacies
// (snake_case, camelCase, nested objects). The catalog below covers
// the variations we currently emit plus common synonyms a future
// transformer might use. Matching is case-insensitive on the leaf key.
//
// IMPORTANT — when adding a new transformer that introduces a new PHI
// key name, ADD IT HERE. The unit tests assert that known transformer
// output gets fully redacted; a missing entry will surface there.

const PHI_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  // Patient identifiers
  /^patient[_-]?first[_-]?name$/i,
  /^patient[_-]?last[_-]?name$/i,
  /^patient[_-]?full[_-]?name$/i,
  /^patient[_-]?name$/i,
  /^first[_-]?name$/i,            // inside nested { patient: { first_name } }
  /^last[_-]?name$/i,
  /^full[_-]?name$/i,
  /^name$/i,                       // inside nested patient/prescriber containers
  /^patient[_-]?date[_-]?of[_-]?birth$/i,
  /^date[_-]?of[_-]?birth$/i,
  /^dob$/i,
  /^birth[_-]?date$/i,
  // Address (street/city/state/zip ARE PHI when combined with other identifiers)
  /^patient[_-]?address[_-]?line[_-]?1?$/i,
  /^patient[_-]?address[_-]?line[_-]?2$/i,
  /^address[_-]?line[_-]?1?$/i,
  /^address[_-]?line[_-]?2$/i,
  /^street[_-]?address$/i,
  /^street$/i,
  /^patient[_-]?city$/i,
  /^city$/i,
  /^patient[_-]?state$/i,
  /^patient[_-]?zip$/i,
  /^zip$/i,
  /^zip[_-]?code$/i,
  /^postal[_-]?code$/i,
  // Patient contact
  /^patient[_-]?phone$/i,
  /^phone[_-]?number$/i,
  /^patient[_-]?email$/i,
  /^email$/i,
  // Government identifiers
  /^ssn$/i,
  /^social[_-]?security[_-]?number$/i,
  /^mrn$/i,
  /^medical[_-]?record[_-]?number$/i,
  // Prescription clinical detail (sig + dose narrative are PHI per §164.514)
  /^sig[_-]?text$/i,
  /^sig$/i,
  /^directions$/i,
  /^medication[_-]?name$/i,
  /^drug[_-]?name$/i,
  /^medication[_-]?form$/i,
  /^medication[_-]?dose$/i,
  /^dose$/i,
  /^strength$/i,
  /^quantity$/i,
  // Provider controlled-substance identifiers
  /^provider[_-]?dea$/i,
  /^dea$/i,
  /^dea[_-]?number$/i,
]

const REDACTED_TOKEN = '[REDACTED]'

// State container keys whose CONTENTS are recursively scrubbed but whose
// key names are preserved so the shape stays inspectable.
const KNOWN_CONTAINER_KEYS = new Set([
  'patient',
  'prescriber',
  'provider',
  'medication',
  'prescription',
  'rx',
  'body',
])

// Patient-container-only keys: when a key like `state` or `country` appears
// at the top level of a `patient` block, it's part of an address (PHI).
// At top level of the whole payload, `state` could mean "license_state"
// or any number of non-PHI things, so we DON'T redact it there.
const PATIENT_CONTAINER_PHI_KEYS = new Set(['state', 'country'])

// Medication-container-only keys: ambiguous bare names that are clinical
// PHI only when nested under a `medication` / `prescription` / `rx` block.
const MEDICATION_CONTAINER_PHI_KEYS = new Set(['form', 'strength', 'route', 'frequency'])

function isPhiKey(key: string, containerKey: string | null): boolean {
  // Container keys are NOT scrubbed wholesale — we still recurse into them.
  if (KNOWN_CONTAINER_KEYS.has(key.toLowerCase())) return false

  // Contextual: address fragments inside a `patient` container are PHI.
  if (
    containerKey === 'patient' &&
    PATIENT_CONTAINER_PHI_KEYS.has(key.toLowerCase())
  ) {
    return true
  }

  // Contextual: clinical fragments inside a medication container are PHI.
  if (
    (containerKey === 'medication' ||
      containerKey === 'prescription' ||
      containerKey === 'rx') &&
    MEDICATION_CONTAINER_PHI_KEYS.has(key.toLowerCase())
  ) {
    return true
  }

  return PHI_KEY_PATTERNS.some(rx => rx.test(key))
}

// ============================================================
// REDACTION
// ============================================================

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

function redactValue(value: unknown, containerKey: string | null = null): JsonValue {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, containerKey))
  }
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (isPhiKey(key, containerKey)) {
        out[key] = REDACTED_TOKEN
      } else {
        // If this key is a known container (patient/prescriber/etc.),
        // the child recursion needs to know so PATIENT_CONTAINER_PHI_KEYS
        // can fire on bare `state` / `country`.
        const nextContainer = KNOWN_CONTAINER_KEYS.has(key.toLowerCase())
          ? key.toLowerCase()
          : containerKey
        out[key] = redactValue(raw, nextContainer)
      }
    }
    return out
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  // Unknown primitive (bigint, symbol, function): coerce to a safe string,
  // since JSONB cannot store them and we should not leak whatever toString()
  // yields verbatim if it happens to be PHI-derived.
  return String(value)
}

// ============================================================
// FINGERPRINT
// ============================================================
//
// SHA-256 over a deterministic canonical JSON encoding of the ORIGINAL
// (un-redacted) payload. Two writes of the same logical payload produce
// the same fingerprint so ops can correlate replays / dedupe attempts.
// Different payloads produce different fingerprints.
//
// Canonicalization: recursively sort object keys, then JSON.stringify.
// This avoids order-dependence ("{a:1,b:2}" === "{b:2,a:1}" → same hash).

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sortedKeys = Object.keys(obj).sort()
    const out: Record<string, unknown> = {}
    for (const k of sortedKeys) {
      out[k] = canonicalize(obj[k])
    }
    return out
  }
  return value
}

export function computePayloadFingerprint(raw: unknown): string {
  const canonical = JSON.stringify(canonicalize(raw))
  return createHash('sha256').update(canonical).digest('hex')
}

// ============================================================
// PUBLIC API
// ============================================================

export interface RedactionResult {
  /** Safe-to-persist payload with all PHI leaves replaced by "[REDACTED]" */
  redactedPayload: Record<string, JsonValue>
  /** Stable SHA-256 hex digest of the ORIGINAL payload (for replay correlation) */
  fingerprint: string
}

/**
 * Redact PHI from an outbound adapter request payload and compute a
 * fingerprint for ops correlation.
 *
 * The caller MUST persist `redactedPayload` to `request_payload` and
 * fold `fingerprint` into `metadata.phi_fingerprint`. The original
 * `raw` value must never be persisted, logged, or returned upstream.
 *
 * Pass-through behavior:
 *   - `null` / `undefined` input → null payload + fingerprint of literal null
 *   - Empty object input         → empty redacted object + stable hash of `{}`
 *   - Nested PHI keys at any depth get redacted (the patient is inside a
 *     `patient` container in most transformer outputs, so depth matters).
 */
export function redactAdapterRequestPayload(raw: unknown): RedactionResult {
  const fingerprint = computePayloadFingerprint(raw ?? null)

  if (raw === null || raw === undefined) {
    return { redactedPayload: {}, fingerprint }
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    // request_payload column is jsonb with shape Record<string, unknown>.
    // If a caller hands us a non-object root, wrap it so the column type
    // stays consistent and the value is still inspectable.
    return {
      redactedPayload: { value: redactValue(raw) },
      fingerprint,
    }
  }

  const redacted = redactValue(raw) as Record<string, JsonValue>
  return { redactedPayload: redacted, fingerprint }
}

// Test-only export: surface the PHI matcher so unit tests can lock the
// catalog without re-deriving the regex set.
export const __TEST_ONLY__ = {
  isPhiKey,
  REDACTED_TOKEN,
  KNOWN_CONTAINER_KEYS,
  PHI_KEY_PATTERNS,
}
