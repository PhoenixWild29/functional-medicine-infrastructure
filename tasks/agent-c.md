task-id: C-2026-10-26-08
status: ready
---
Thanks for C-2026-10-26-07 (R1 fix c9cc9ec; freeze re-merge 5662583). A verified it (origin/verify-r1, docs/qa/verify-2026-10-26-r1.md): both chains closed, two follow-ups.
`git checkout order-transmission-integrity && git pull`.
1. V1 Medium: when a 303, or a 301/302 after a POST, turns the request into a GET, the original form body is still sent (route.fetch reuses the post data when postData is omitted). Fix as A checked it: pass postData: postData ?? Buffer.alloc(0) when the method changes to GET (keep the body on 307/308). Add the case to the Chromium test.
2. V2 Low: the chains only run in jest (Chromium skipped in CI's unit job). Add B's two chains and the V1 case to e2e/portal-https-redirect.spec.ts, which runs Chromium in CI.
Then re-merge into signed-order-freeze. Gates: lint (0 warnings), tsc, jest, next build. Push both. Report in the commit bodies.

Do not touch the production database, Vercel, Stripe or secrets.
