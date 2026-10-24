task-id: C-2026-10-24-04
status: ready
---
Thanks for C-2026-10-24-03 (landmarks, 55 routes). Flake fixes are PR #255 (CI running).

Step 0: main now has #254 (B: lint 57 warnings to 0, and `npm run lint` is `eslint . --max-warnings=0`, so ANY warning fails CI). `git fetch origin`, check out a11y-landmarks, `git merge origin/main`, resolve any conflicts (B edited sidebar-nav.tsx: SidebarContent/NavLink became render functions; you made the mobile bar a <header>; keep both), `npm run lint` must show 0 warnings, rerun tsc and your landmark tests, push a11y-landmarks (normal push).

Task: upgrade React 18 to React 19 (D's follow-up: Next 16 warns React 18 is deprecated and removed in Next 17; the App Router already renders with Next's bundled React 19 canary while Jest uses react-dom 18.3.1, so tests and production differ).

Branch: `git checkout -b react-19 origin/main`.
1. Bump react, react-dom, @types/react, @types/react-dom to 19. Check peer ranges for @testing-library/react (and jest-dom, user-event), radix packages, react-hook-form, @dnd-kit, react-query, sentry, jest-axe and anything else that peers on react; bump only what is required. Keep lockfile changes minimal; keep libc markers.
2. Fix every type and runtime break (forwardRef/ref-as-prop, removed APIs like ReactDOM.render, findDOMNode, string refs, defaultProps on function components, propTypes, act import from react-dom/test-utils -> react, useFormState -> useActionState, JSX namespace types). Follow the official React 19 upgrade guide.
3. Run the full Jest suite under React 19 and fix failures in code, not by loosening tests. No timeouts raised.
4. `npm run lint` (0 warnings), tsc, Jest (default workers and --maxWorkers=3), build (the React 18 deprecation warning must be gone). Commit and push to origin react-19 (normal push, no PR). Full report in the final commit message body: Step 0 outcome and head of a11y-landmarks, versions before/after, every break and fix (file:line), local results, head SHA.

Do not touch the production database, Vercel, Stripe or secrets.
