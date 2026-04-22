// ============================================================
// EPCS TOTP secret encryption — AES-256-GCM (WO-86)
// ============================================================
//
// Single source of truth for encrypting / decrypting provider TOTP
// secrets. Imported by:
//   - /api/epcs/route.ts (setup + verify handlers)
//   - /lib/poc/totp-enrollment.ts (demo provider pre-enrollment)
//
// Extracting this guarantees that any future refactor — new format,
// key rotation, algorithm change — updates both callers atomically.
// There is literally one code path.
//
// # Key derivation
//
// Uses the first 32 bytes of SUPABASE_SERVICE_ROLE_KEY, padded with
// '0' if shorter. NOTE — this is a latent issue: a Supabase service
// role key rotation would silently brick every previously-encrypted
// secret because there's no key versioning. Out of scope for the POC
// demo work. Production deployment should migrate to a KMS-backed
// key with versioning.
//
// # Format
//
// Encrypted output is three hex strings joined by colons:
//     {iv_12_bytes_hex}:{auth_tag_16_bytes_hex}:{ciphertext_hex}
// decryptSecret parses in the same shape.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function getEncryptionKey(): Buffer {
  // Read at call time so tests can override SUPABASE_SERVICE_ROLE_KEY per-suite.
  return Buffer.from(
    (process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '').slice(0, 32).padEnd(32, '0')
  )
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decryptSecret(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split(':')
  if (!ivHex || !tagHex || !encHex) throw new Error('Invalid encrypted format')
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8')
}
