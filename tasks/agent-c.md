task-id: C-2026-10-25-08
status: ready
---
Thanks for C-2026-10-25-07 (security-followups-3, ea321e8).

Next: patients open their links on phones. Make every patient-facing page work well at phone sizes.

Branch: `git fetch origin && git checkout -b patient-pages-mobile origin/main`.
Pages: /plan/[token] (DOB gate, options, choose, confirmation), /checkout/[token] (summary, payment form container, success, expired), /intake/[token] (every step), /join/[token], and the patient error/not-found pages.
- Run them locally with seeded test data at 360x740, 390x844 and 768x1024 (Playwright devices). Check: no horizontal scroll; tap targets at least 44x44 px; text at least 16px in inputs (no iOS zoom on focus); correct input types and autocomplete (bday for DOB, tel, email, given-name/family-name, address fields); labels visible, not placeholder-only; buttons not hidden behind the keyboard; long drug names and prices wrap without breaking layout; focus order sane; the DOB field works with the native date picker and typed input.
- Fix what fails. Keep the visual style.
- Add an E2E spec patient-pages-mobile.spec.ts that runs the main patient flows at 390x844 and asserts no horizontal overflow (document.scrollingElement.scrollWidth <= innerWidth) and input font size >= 16px. Never enter a card; do not submit payment.
No database migrations.
Gates: lint (0 warnings), tsc, jest, next build. Push patient-pages-mobile (normal push, no PR). Report in the commit body with before/after per page.

Do not touch the production database, Vercel, Stripe or secrets.
