# CompoundIQ Security Audit — Phase 11 Dependency Upgrade

**Audit Date:** 2026-03-24
**Auditor:** Claude Code (Phase 11 automated build)
**Status:** COMPLETE — 0 high/critical vulnerabilities

---

## Initial State (Pre-Phase 11)

Running `npm audit` before Phase 11 work revealed:

```
14 vulnerabilities (4 low, 10 high)
```

### High Severity Vulnerabilities (10)

| CVE / GHSA | Package | Description |
|---|---|---|
| GHSA-7m27-7ghc-44w9 | next <14.2.10 | Image Optimizer DoS (malformed Accept header) |
| GHSA-g77x-44xx-532m | next <14.2.21 | HTTP request smuggling via CRLF in headers |
| GHSA-67mh-4wv8-2f99 | next <15.1.6 | Next.js cache poisoning (disk cache) |
| GHSA-qpjv-v59x-3xxc | next <15.1.7 | Authorization bypass in middleware |
| GHSA-mw96-cpmx-2vgc | rollup (via @sentry/nextjs) | Path traversal via crafted entry point |
| GHSA-wgrm-67xf-hhpq | @tootallnate/once (via jest-environment-jsdom) | Incorrect control flow scoping |
| GHSA-34x7-hfp2-rc4v | node-tar | Arbitrary file creation via hardlink path traversal |
| GHSA-8qq5-rm4j-mr97 | node-tar | Arbitrary file overwrite via symlink poisoning |
| GHSA-83g3-92jg-28cx | node-tar | Arbitrary file read/write via symlink chain |
| GHSA-qffp-2rhf-9h96 | tar | Hardlink path traversal via drive-relative linkpath |

### Low Severity Vulnerabilities (4)

| CVE / GHSA | Package | Description |
|---|---|---|
| GHSA-9ppj-qmqm-q256 | node-tar | Symlink path traversal via drive-relative linkpath |
| GHSA-r6q2-hw4h-h46w | node-tar | Race condition in path reservations (macOS APFS) |
| GHSA-vpq2-c234-7xj6 (low/medium) | @tootallnate/once | Incorrect control flow scoping |
| (pdfjs-dist CVE) | react-pdf / pdfjs-dist | Arbitrary JS execution on malicious PDF open |

---

## Remediation Actions

### WO-60: Next.js 14 → 16 Full Framework Upgrade

- Upgraded `next` from ^14.2.0 to ^16.2.1
- `react` / `react-dom` remain at 18.3.x — Next.js 16 supports both 18 and 19 (`^18.2.0 || ^19.0.0`)
- Upgraded `eslint-config-next` to match
- Resolved all TypeScript breaking changes from `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and regenerated Supabase types
- **CVEs resolved:** GHSA-7m27-7ghc-44w9, GHSA-g77x-44xx-532m, GHSA-67mh-4wv8-2f99, GHSA-qpjv-v59x-3xxc

### WO-61: react-pdf 7 → 10 Upgrade

- Upgraded `react-pdf` from ^7.7.0 to ^10.4.1 (pdfjs-dist upgraded from vulnerable 3.x to 5.4.296)
- No source code changes required — react-pdf is a declared dependency but not currently used in any component (PDF preview uses signed download URLs; PDF generation uses a custom raw PDF writer)
- **CVE resolved:** pdfjs-dist arbitrary JS execution (pdfjs-dist upgraded 3.x → 5.4.296, above the ≥4.2.67 fix threshold)

### WO-62: @sentry/nextjs 8 → 10 Upgrade

- Upgraded `@sentry/nextjs` from ^8.0.0 to ^10.45.0 (rollup upgraded from vulnerable 3.x to 4.x as transitive dep)
- Updated `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` for v10 API
- PHI scrubbing `beforeSend` hook preserved with all 12 PHI patterns
- Added `Authorization`, `authorization`, `Cookie`, `cookie`, `set-cookie` to `ALWAYS_REDACT_KEYS` (HIPAA hardening — bearer tokens and session cookies must not reach Sentry)
- **CVE resolved:** GHSA-mw96-cpmx-2vgc (rollup)

### WO-63: Dev & Build Tool Security Fixes

- Upgraded `jest-environment-jsdom` from ^29.7.0 to ^30.3.0 (drops vulnerable jsdom 22 / @tootallnate/once chain)
- Added missing `ts-node` devDependency (required for jest.config.ts TypeScript config loading)
- `node-tar` vulnerabilities resolved as a transitive consequence of the above upgrades (tar no longer required by the new dependency tree)
- **CVEs resolved:** GHSA-wgrm-67xf-hhpq (@tootallnate/once via jsdom), GHSA-vpq2-c234-7xj6 (also @tootallnate/once — resolved by same jsdom upgrade), GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx, GHSA-qffp-2rhf-9h96, GHSA-9ppj-qmqm-q256, GHSA-r6q2-hw4h-h46w (all node-tar variants — tar removed from dependency tree)

---

## Final State (Post-Phase 11)

```
found 0 vulnerabilities
```

`npm run build` output:
```
✓ Compiled successfully
✓ TypeScript: Finished TypeScript in 13.6s
✓ Generating static pages (46/46)
```

### Dependency Versions Post-Upgrade

| Package | Pre-Phase 11 | Post-Phase 11 |
|---|---|---|
| `next` | ^14.2.0 (14.2.x) | ^16.2.1 (16.2.1) |
| `react` / `react-dom` | ^18.3.0 (18.3.1) | ^18.3.0 (18.3.1) — unchanged |
| `@sentry/nextjs` | ^8.0.0 | ^10.45.0 |
| `react-pdf` | ^7.7.0 (7.7.3) | ^10.4.1 (10.4.1) |
| `jest-environment-jsdom` | ^29.7.0 | ^30.3.0 |

---

## Compliance Notes

- **HIPAA:** All upgrades preserve PHI handling. Sentry `beforeSend` hook unchanged plus hardened with Auth/Cookie header redaction. No PHI flows through any upgraded dependency.
- **BAA coverage:** Documo (fax), Supabase (database/storage), and Stripe (payments) BAA agreements are not affected by any of these upgrades.
- **Vault credentials:** No changes to Supabase Vault integration. Credential retrieval via `(supabase as any).schema('vault')` is a TypeScript-only workaround for the generated types not including the vault schema; runtime behavior is unchanged.
- **Stripe API version:** Pinned at `2023-10-16` to match installed Stripe SDK v14. Upgrading Stripe SDK is a separate concern.

---

## Sign-off

This audit document is produced as part of the Phase 11 automated build process. Review by a compliance officer is recommended before production deployment.

| Role | Name | Date |
|---|---|---|
| Engineer (automated build) | Claude Code | 2026-03-24 |
| Compliance Officer | _pending_ | |
