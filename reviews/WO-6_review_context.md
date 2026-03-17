# WO-6 Review Context — Next.js 14 App Router Skeleton

## Work Order Summary

**WO:** 6
**Title:** Next.js 14 App Router Skeleton
**Status:** in_review
**Phase:** 1
**Assignee:** Samuel Shamber

## Files Created

| File | Description |
|------|-------------|
| `package.json` | All dependencies |
| `tsconfig.json` | TypeScript strict mode config |
| `next.config.ts` | Next.js config (no Realtime, strict env) |
| `tailwind.config.ts` | Tailwind with mobile-first breakpoints |
| `src/app/layout.tsx` | Root layout (robots: noindex for HIPAA) |
| `src/app/globals.css` | Tailwind base + CSS variables |
| `src/app/not-found.tsx` | 404 page |
| `src/app/(clinic-app)/layout.tsx` | Auth guard: clinic roles |
| `src/app/(clinic-app)/error.tsx` | Error boundary |
| `src/app/(clinic-app)/loading.tsx` | Loading UI |
| `src/app/(ops-dashboard)/layout.tsx` | Auth guard: ops_admin only |
| `src/app/(ops-dashboard)/error.tsx` | Error boundary |
| `src/app/(ops-dashboard)/loading.tsx` | Loading UI |
| `src/app/(patient-checkout)/layout.tsx` | JWT token auth, mobile-first |
| `src/app/(patient-checkout)/error.tsx` | Error boundary |
| `src/app/(patient-checkout)/loading.tsx` | Loading UI |
| `src/middleware.ts` | Edge auth middleware |
| `src/components/providers.tsx` | TanStack Query + Sonner |
| `src/lib/env.ts` | Server/client env validation |
| `src/lib/auth/checkout-token.ts` | JWT verify (Web Crypto) |

## Acceptance Criteria Checklist

### TypeScript
- [ ] `strict: true` in tsconfig
- [ ] `noImplicitAny: true`
- [ ] `strictNullChecks: true`
- [ ] `noUncheckedIndexedAccess: true`

### Route Groups (3)
- [ ] `(clinic-app)` — layout, error, loading present
- [ ] `(ops-dashboard)` — layout, error, loading present
- [ ] `(patient-checkout)` — layout, error, loading present

### Auth Guards
- [ ] clinic-app checks: clinic_admin, provider, medical_assistant
- [ ] ops-dashboard checks: ops_admin only
- [ ] patient-checkout uses JWT token (no Supabase session)
- [ ] All error.tsx files have `'use client'` directive

### HIPAA / No Realtime
- [ ] No WebSocket/Realtime subscriptions in providers.tsx
- [ ] Comment documenting polling-only policy present
- [ ] `robots: noindex` in root layout metadata

### Client/Server Boundary
- [ ] serverEnv contains no NEXT_PUBLIC_ vars
- [ ] clientEnv contains only NEXT_PUBLIC_ vars
- [ ] next.config.ts env field is empty

### Middleware
- [ ] Skips /checkout routes (JWT auth, not session)
- [ ] Whitelists /login, /unauthorized
- [ ] Redirects unauthenticated users to /login
- [ ] Matcher excludes static assets

### Dependencies
- [ ] @supabase/supabase-js
- [ ] @tanstack/react-query + devtools
- [ ] zustand
- [ ] react-hook-form + zod + @hookform/resolvers
- [ ] date-fns, sonner, recharts, react-pdf
- [ ] react-signature-canvas, papaparse, react-dropzone
- [ ] @stripe/stripe-js + @stripe/react-stripe-js

## Agent Review Result
**PASS (clean)** — All 10 checks passed. `src/lib/supabase/server.ts` noted as expected pending (WO-7).

## How to Review with Cowork
1. Open Claude Cowork and connect to the `Functional Medicine` folder
2. Read this file and the key files: layouts, middleware, providers, env.ts
3. Work through every checkbox above
4. If all pass, mark WO-6 as `completed` in the Software Factory
