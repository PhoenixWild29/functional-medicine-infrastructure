// ============================================================
// Who to contact at CompoundIQ (decision 12)
// ============================================================
//
// The support address comes from NEXT_PUBLIC_SUPPORT_EMAIL, set per
// environment so production and the demo point to their own inbox
// (docs/decisions/before-real-patients-2026-10-25.md, item 12). Every
// "Contact CompoundIQ" in the app comes from contactCompoundIQ(): with the
// address set it reads "Contact CompoundIQ at <address>"; unset, or not an
// email address, the generic "Contact CompoundIQ", as before.
//
// NEXT_PUBLIC_*: read with a literal key so Next inlines it in client
// bundles too. Plain module: server and client.

const EMAIL_RE = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/

export function supportEmail(): string | null {
  const v = (process.env['NEXT_PUBLIC_SUPPORT_EMAIL'] ?? '').trim()
  return v.length <= 254 && EMAIL_RE.test(v) ? v : null
}

/** "Contact CompoundIQ" (or "contact CompoundIQ"), with the support address when one is set. */
export function contactCompoundIQ(opts: { lower?: boolean } = {}): string {
  const base = `${opts.lower ? 'c' : 'C'}ontact CompoundIQ`
  const email = supportEmail()
  return email ? `${base} at ${email}` : base
}
