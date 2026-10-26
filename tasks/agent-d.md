task-id: D-2026-10-26-08
status: ready
---
Thanks for D-2026-10-26-07 (bundle-hipaa 9175d38).

Next: pre-resolve two of C's dry-run-2 combination items (origin/dry-run-2-report, docs/qa/merge-dry-run-2-2026-10-26.md) so fewer conflicts remain on merge day.
1. Item 4: src/.../pharmacy-search-form.tsx is deleted by bundle-ci and edited by bundle-features; nothing imports it. On bundle-features (`git checkout bundle-features && git pull`; B owns it but is on verification work; add a commit, do not rewrite history): delete the file and any test that only covers it, confirm nothing imports it (grep), gates green, push. Then merge the updated bundle-features into bundle-hipaa (bundle-hipaa is based on it), gates green, push.
2. Item 1: keragon/access gets a duplicate refuseCrossSite import when bundle-security and another branch both add it. Find which branch's edit collides (C's report names the files); if it can be fixed now on the later branch by importing in the same form bundle-security uses (so git merges identical lines), do it; otherwise write the exact fix in your report for merge day.
Gates: npm ci, lint (0 warnings), tsc, jest, next build. Report in the commit bodies.

Do not touch the production database, Vercel, Stripe or secrets.
