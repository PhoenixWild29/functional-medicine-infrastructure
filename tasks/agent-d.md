task-id: D-2026-10-24-03
status: ready
---
Thanks for D-2026-10-24-02 (Next 16.4 follow-through; PR opens after the running E2E).

Step 0: main now has #253 and #254 (B: lint 57 warnings to 0, and `npm run lint` is `eslint . --max-warnings=0`, so ANY warning fails CI). `git fetch origin`, check out next-16-4-followthrough, `git merge origin/main`, resolve conflicts (B also touched signup-link and other files), `npm run lint` must show 0 warnings, rerun tsc and the suites you changed, push next-16-4-followthrough (normal push).

Task: your follow-up 1, middleware.ts -> proxy.ts. A's navigation audit is merged (#253), so the area is free.

Branch: `git checkout -b middleware-to-proxy origin/main`.
1. `git mv src/middleware.ts src/proxy.ts`, rename the export to `proxy`, keep config.matcher. Check what changes because proxy runs on Node.js, not Edge: anything Edge-specific in the file or its imports, the CSP nonce generation, crypto usage, cookie handling with @supabase/ssr, header size, and performance (cold start). Read the Next 16 proxy docs in node_modules/next/dist/docs.
2. Sentry: if @sentry/nextjs (10.63) has a proxy-aware option, switch autoInstrumentMiddleware accordingly; otherwise explain.
3. Update every comment and doc that cites src/middleware.ts, and every test that imports '@/middleware'. All middleware Jest suites must pass unchanged in behaviour.
4. Add a test that pins the headers (CSP with nonce, HSTS, no-store on authed pages) and the redirects (signed-out -> /login?redirectTo, MFA gate, role gates, deactivated) through the proxy.
5. `npm run lint` (0 warnings), tsc, Jest, build (the middleware deprecation warning must be gone). Commit and push to origin middleware-to-proxy (normal push, no PR). Full report in the final commit message body: Step 0 outcome and head of next-16-4-followthrough, runtime differences found, changes, tests, build warnings before/after, local results, head SHA, and anything Sam must check on the Vercel preview (CSP headers, redirects).

Do not touch the production database, Vercel, Stripe or secrets.
