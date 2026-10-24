task-id: A-2026-10-24-01
status: ready
---
Branch `pharmacy-license-upload-4mb` from origin/main. No migration. Push only, no PR. Red test then fix.

Pharmacy onboarding license documents (`src/lib/pharmacy-onboarding/application.ts` MAX_DOCUMENT_BYTES, 10 MB) go through a Vercel Function, which rejects request bodies over about 4.5 MB. Lower the limit to 4 MB everywhere it is enforced or shown: server check, browser check, copy ("up to 4 MB"), tests. Same pattern as the face-sheet limit (src/lib/face-sheet/config.ts). Also grep for any other upload that allows more than 4 MB through a Vercel Function (patient CSV import, catalog CSV, anything else) and apply the same 4 MB limit; list each in the report.

Lint, tsc, Jest, build green. Full report in the body of your final commit message.
