task-id: B-2026-10-26-02
status: ready
---
Thanks for B-2026-10-26-01 (review-hipaa-fixes, dd149b5). Strong review. You fix password-flows (D is on other work; you own the branch until you push; do not rewrite its history).

`git checkout password-flows && git pull`.
1. P1 High: POST /api/auth/password must only set a new password for a RECOVERY session (amr includes recovery, issued within the last 15 minutes; read how Supabase exposes amr in this SDK version and test it), otherwise 403. Add a per-user rate limit. The signed-in change flow stays the separate route that checks the current password.
2. P3 Medium: forgot-password timing. Respond after a fixed minimum time (e.g. 600 ms) regardless of outcome, or do the Supabase call in after()/waitUntil so the response does not wait for it; pick the one that works on Vercel with this Next version and say why. Test that both paths take the same time within tolerance (mock timers).
3. P4 Low: use newPasswordProblem (the shared policy) in invite accept, sign-up and pharmacy invite.
4. P5 Low: check the per-IP limit before the per-address limit, and make the per-address limit not lock an address out for an hour from one attacker IP (e.g. count per address+IP, with a looser per-address cap).
5. P2 Medium (provider invite link handed to the admin): do NOT change the invite design in this task. Write the options in your report for Sam's decision (email delivery via Supabase invite if email is configured; forced change on first sign-in via app_metadata.must_change_password; leave as is with the admin trusted) with the effort of each.
Also: in your report, list the hosted Supabase settings that would let a browser updateUser bypass the server policy, and the Supabase dashboard setting names Sam should check (password strength, redirect allow-list), names only.
Tests: jest for each fix (recovery-only, timing, policy reuse, limiter order).
Gates: lint (0 warnings), tsc, jest, next build. Push password-flows (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
