task-id: D-2026-10-24-08
status: ready
---
Thanks for D-2026-10-24-07 (L5 lockdown, 47db60d). Its migration goes to Sam with the others.

Next: zod 3 -> 4 (npm audit high GHSA-mrhx-c7xc-m3w5, fixed only in 4.x).

Branch: `git fetch origin && git checkout -b zod-4 origin/main`.

1. Check who depends on zod and how: our code, @anthropic-ai/sdk (you noted it depends on zod 3: find whether as a dependency or a peer, and whether it works alongside zod 4 or bundles its own), react-hook-form resolvers (@hookform/resolvers version support for zod 4), and anything else. If a dependency pins zod 3 internally, it can keep its own nested copy; our code moves to 4.
2. Upgrade our zod to the latest 4.x. Apply the zod 4 migration guide: error customization (message/errorMap -> error), .email()/.url()/.uuid() string format changes (z.email() etc. and stricter UUID), .strict()/.passthrough() -> z.strictObject/looseObject where used, default/optional semantics, z.record two-argument form, ZodError .format()/.flatten() changes and issue shapes (anything that reads error.issues or error.flatten() for API responses), z.infer unchanged, .nonempty() on arrays, refinements, z.coerce, unions/discriminatedUnion. Keep every API's validation behaviour and error response shape the same; add tests where a shape could change.
3. `npm audit --omit=dev` after: expect 0 high/critical. Lockfile minimal; keep libc markers.
4. `npm run lint` (0 warnings), tsc, Jest (default workers and --maxWorkers=3), build. Push zod-4 (normal push, no PR). Full report in the final commit body: dependency findings, every changed schema pattern (file:line count), any response-shape change, audit before/after, local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
