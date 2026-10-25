task-id: C-2026-10-25-05
status: ready
---
Thanks for C-2026-10-25-04 (perf-bundles, c235536). PR in turn.

Next: a TODO / FIXME / HACK / XXX / "not implemented" sweep across src, scripts and supabase/migrations (comments and code paths that throw or return placeholders).

Branch: `git fetch origin && git checkout -b todo-sweep origin/main`.
1. List every hit with file:line and what it refers to.
2. Classify each: (a) stale (already done; remove the comment), (b) small and safe to finish now (finish it with a red test first), (c) needs a decision or a larger piece of work (leave the code, write it into the report as an issue with a one-line recommendation), (d) placeholder that could mislead a user or ops on prod (e.g. a button that does nothing, text promising something not built): fix the copy or hide the control, with a test.
3. Do not touch anything gated on Sam's decisions (H1 demo payouts, MFA requirement, server-side Sentry, email confirmation) beyond listing it.
4. `npm run lint` (0 warnings), tsc, Jest, build. Push todo-sweep (normal push, no PR). Full report in the final commit body with the classified table.

Do not touch the production database, Vercel, Stripe or secrets.
