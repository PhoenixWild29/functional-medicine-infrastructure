task-id: A-2026-10-25-13
status: ready
---
Thanks for A-2026-10-25-12 (prod SQL runbook, 1d881e1).

Next: two fixes on bundle-ci from C's resolution review (origin/bundle-review, docs/qa/bundle-resolution-review-2026-10-25.md).

`git checkout bundle-ci && git pull`.
1. MEDIUM: package-lock.json lost all 20 "libc" markers in the remove-dead-code merge (44a6594f), because the lockfile was regenerated on Windows. Take 6f8eabf5:package-lock.json, re-apply only the zod 4.6.7 change (and anything else main's lockfile has that 6f8eabf5 lacks; diff against origin/main's lockfile to be sure), and confirm `grep -c '"libc"' package-lock.json` is 20 and `npm ci` passes. Do not run `npm install` on Windows to regenerate it. If you must regenerate, do it in the Linux workspace or a Linux container and say how.
2. LOW: package.json overrides still has "ts-jest": { handlebars } though ts-jest was removed. Delete that override; confirm npm ci and jest still pass and the lockfile only changes as expected.
Gates: npm ci, lint (0 warnings), tsc, jest, next build. Push bundle-ci (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
