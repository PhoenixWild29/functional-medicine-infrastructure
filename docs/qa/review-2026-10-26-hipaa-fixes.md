# Independent review: HIPAA fix branches (2026-10-26)

Task B-2026-10-26-01. This reviews the code, not the authors' reports.
Each branch is diffed against `origin/bundle-features`, from their shared
merge-base 31bb77e5:

- `origin/password-flows` (D, 69e60cf): password reset and change (B11),
  and the providers route no longer sets a password (B10).
- `origin/order-transmission-integrity` (A, 2b9b69a): sending refuses
  unsigned or altered orders (B6), the signature is bound to the order's
  content (B7), and pharmacy URLs must be https (B17).

Each finding below was confirmed in one of two ways: by reading the path
end to end (file:line is on the branch named), or with a throwaway jest
test run in a detached worktree and then deleted. Anything that could not
be confirmed was dropped. No branch was modified. No database, Supabase
project, pharmacy, fax provider, Vercel or Stripe was contacted.

## Summary

| # | Branch | Finding | Severity |
|---|---|---|---|
| P1 | password-flows | Any signed-in session can set a new password without the current one, through `POST /api/auth/password` | High |
| P2 | password-flows | The provider invite link goes back to the admin, so the admin can still choose the provider's first password | Medium |
| P3 | password-flows | Forgot-password timing follows Supabase's latency, so it can reveal whether an account exists | Medium |
| P4 | password-flows | Invite accept, sign-up and pharmacy invite use the length-only rule, not the new policy | Low |
| P5 | password-flows | Anyone can lock an address out of reset emails for an hour | Low |
| T1 | order-transmission-integrity | The binding can be forged: it is unkeyed SHA-256, and any 64-hex value passes as "legacy" | High (blocking until B4 is applied) |
| T2 | order-transmission-integrity | The pharmacy receives fields that are not bound, including the destination pharmacy | High |
| T3 | order-transmission-integrity | The guard checks one read of the order; the adapter sends a second read | Medium |
| T4 | order-transmission-integrity | Tier 1 `fetch` follows an https-to-http redirect and resends the PHI body | Medium |
| T5 | order-transmission-integrity | The Tier 2 portal browser does not enforce https after the first navigation | Medium |
| T6 | order-transmission-integrity | A legitimate allergy edit after signing strands paid orders (fails closed, no re-sign path) | Low |
| T7 | order-transmission-integrity | The portal status poll types portal credentials with no https check | Low |

Verdict:
- **password-flows:** do not merge until P1 is fixed. The rest can follow.
- **order-transmission-integrity:** the send guard is correctly wired.
  - Every send path reaches it, and nothing calls a fax or HTTP sender
    directly.
  - B7 is not closed until T1 and T2 are fixed.
  - T1 is directly exploitable on today's base: the B4 write lockdown
    (`rls-user-write-lockdown-v2`, migration 000004) is on neither `main`
    nor `bundle-features`.

---

## password-flows

### P1. High: a new password with no current password, through the reset endpoint

- **Where:**
  - `src/app/api/auth/password/route.ts:22-46` checks only `getUser()`,
    then calls `updateUser({ password })` and `signOut({ scope: 'global' })`.
    It never checks that the session came from a recovery link.
  - `src/middleware.ts:70-72` (`isPasswordPath`) opens the route to every
    signed-in role.
- **Scenario:**
  1. An attacker has a hijacked session cookie, or is at an unattended
     signed-in browser, and does not know the password.
  2. `POST /api/auth/password/change` refuses them, because it checks the
     current password (`change/route.ts:40-42`).
  3. They `POST /api/auth/password` with `{ "password": "<new>" }` instead
     and get 200.
  4. The password is replaced, and the global sign-out locks the real
     owner out. That is account takeover.
- **Confirmed:** a throwaway jest test with the suite's own mocks and an
  ordinary (non-recovery) session.
  - `/change` with a wrong current password gave 400.
  - `/api/auth/password` with no current password gave 200, and both
    `updateUser` and `signOut({ scope: 'global' })` were called.
- **Fix:**
  - Allow this route, and `/reset-password`, only for a recovery session:
    `getClaims()` must have an `amr` entry with method `recovery` and a
    recent timestamp (for example, 15 minutes or less). Otherwise answer
    403 and point to `/change`.
  - Add a per-user rate limit to this route; it has none.
  - Check in hosted Supabase that recovery sessions carry
    `amr: recovery`.

### P2. Medium: the admin still holds the provider's first password

- **Where:**
  - `src/app/api/providers/route.ts:243` creates the invite, and `:270`
    returns `inviteLink` (the bearer token) to the admin.
  - `src/app/api/onboarding/invite/accept/route.ts:116` calls
    `createLogin`.
  - `src/lib/auth/create-login.ts:40` creates the user with
    `email_confirm: true`.
- **Scenario:**
  1. A clinic_admin adds `dr@x.test` and receives `inviteLink`.
  2. They open the link themselves and choose the password.
  3. A confirmed provider login with signing rights now exists, with an
     admin-chosen password. No step proves that the invitee owns the
     address.
- **Confirmed:** by tracing the code.
- **Context:** this is how every team invite in the app already works (the
  admin copies the link), and it is the fix C's evidence map proposed for
  B10. So it is a remaining risk of the invite design, not a regression.
  It is listed because B10's intent ("the user sets their own password")
  is not fully met.
- **Fix:** any one of these:
  - deliver the link only to the invitee's email (Supabase
    `inviteUserByEmail` or the app mailer) and stop returning it;
  - create the login unconfirmed and require email verification before
    the first sign-in;
  - force a password change on first sign-in, with an app_metadata flag
    enforced in middleware for pages and APIs. The branch has no
    `must_change_password` mechanism at all.

### P3. Medium: forgot-password timing can reveal an account

- **Where:** `src/app/api/auth/password-reset/route.ts:47` awaits
  `resetPasswordForEmail` before answering.
- **What is already right:** the body and status are identical for known
  and unknown addresses. Errors are swallowed and never name the address
  (`:51-53`).
- **The leak:** Supabase answers at once for an unknown address, but
  writes and sends mail for a known one. That gap shows in the response
  time.
- **Confirmed:** a throwaway test mocked Supabase at 400 ms versus 0 ms.
  The route answered in 418 ms versus 3 ms, with the same status and body.
  The size of the real gap on hosted Supabase was not measured.
- **Fix:** don't hold the response for the Supabase call. Either:
  - start it, and finish it with `after()` / `waitUntil` once the PKCE
    verifier cookie is set;
  - or pad every answer to a fixed minimum time.

### P4. Low: the new policy is not used where first passwords are set

- **Where:** all three call `passwordProblem` (length only), not
  `newPasswordProblem`:
  - `src/app/api/onboarding/invite/accept/route.ts:63`;
  - `src/lib/signup/self-serve.ts:91`;
  - `src/lib/pharmacy-onboarding/invites.ts:258`.
- **Comment is wrong:** `src/lib/auth/password-policy.ts:5-7` says the
  policy covers these paths.
- **Effect:** since B10 these are where first passwords are set (a new
  provider's included), so `password1234` or the user's own email passes.
- **Confirmed:** a throwaway test. `passwordProblem('password1234')` is
  null, and `newPasswordProblem` refuses it.
- **Fix:** use `newPasswordProblem(password, email)` in all three, and
  correct the comment.

### P5. Low: reset-email lockout for any address

- **Where:** `src/app/api/auth/password-reset/route.ts:40`. The
  per-address limiter is checked, and counts the attempt, before the
  per-IP limiter. A request the IP check then refuses still uses up the
  address's allowance.
- **Scenario:**
  1. One IP spends its 5 requests on throwaway addresses.
  2. It then sends 3 requests for `victim@`. All get 429, and no email
     goes out.
  3. The victim, asking from a fresh IP, gets 429 for an hour.
- **Confirmed:** a throwaway test. Supabase was called 5 times, and the
  victim's request from a new IP got 429.
- **Fix:**
  - Check the IP limit first.
  - Count the address only after both checks pass, or make the
    per-address limit silent: answer 200 and don't send. Supabase already
    limits mail to one per address every 60 seconds.

### Checks that passed (password-flows)

- **Enumeration (body, status, headers):** these are identical for known
  and unknown addresses, and 429s don't depend on whether the account
  exists. Timing is the only leak (P3).
- **Reset link:**
  - The redirect target is fixed to `APP_BASE_URL` from the environment,
    not taken from the Host header (`password-reset/route.ts:48`,
    `env.ts:46`).
  - It uses PKCE, so the link completes only in the browser that holds
    the verifier.
  - `/auth/callback` exchanges the code and 302s to an in-app path,
    refusing `//` (`auth/callback/route.ts:27-33`).
  - `/reset-password` carries no token in its URL. Referrer-Policy is
    strict-origin-when-cross-origin (`security/headers.ts:42`). Neither
    page loads anything from a third party.
- **Server-side policy:** enforced on reset and change
  (`password/route.ts:33`, `change/route.ts:46`). The reset form calls the
  API, not the Supabase client.
- **Current password on change:** checked with a separate client that
  keeps no session (`persistSession: false`, `password-check.ts:9-11`).
  That check session is signed out locally at once. A failure gets a
  generic 400, limited to 5 per 15 minutes per user. (P1 sidesteps it.)
- **Other sessions:**
  - Reset signs out everywhere (`scope: 'global'`).
  - Change signs out `scope: 'others'` and keeps the current session.
  - A failed sign-out is only logged, and the route still answers 200
    (minor).
- **Rate limits:**
  - Reset requests: 5 per 15 minutes per IP, and 3 per hour per address.
  - Change: 5 per 15 minutes per user.
  - All in memory per instance.
  - `/api/auth/password` has none (see P1).
- **Logs and Sentry:**
  - The new code logs only error codes and user ids.
  - Sentry drops request bodies (`phi-scrubber.ts:238`).
  - Seen in passing, not reached by this code: the scrubber's key list is
    exact-match, so `currentPassword` and `newPassword` are not redacted
    as keys.
- **Providers route:** refuses a `password` field (`route.ts:117`) and
  creates no login. The invite token is never logged, only the invite id.
  The link is returned to the admin (P2).
- **must_change_password:** not implemented on this branch, so there is
  nothing to bypass (see P2).

### Not verifiable here (password-flows)

- **Direct Supabase calls:** a browser with a session can call
  `supabase.auth.updateUser({ password })` with the anon key. That skips
  the server policy, the current-password check and the sign-out. Closing
  it needs these hosted Supabase Auth settings:
  - a minimum length of 12;
  - leaked-password protection;
  - "Secure password change" (reauthentication).

  (`reauthentication_needed` is handled at `update-password.ts:8`.)
- Whether `APP_BASE_URL/auth/callback` is on Supabase's redirect
  allow-list.
- Whether recovery sessions carry `amr: recovery`, which P1's fix needs.
- Whether Vercel overwrites a client-supplied `x-forwarded-for`, which
  the IP limits depend on.
- Whether the reset email template sends a PKCE code. `/auth/callback`
  handles only `code`.

---

## order-transmission-integrity

### Callers: every send path reaches the guard

Each adapter calls `assertOrderTransmittable` at entry:
`tier1-api.ts:149`, `tier2-portal.ts:199` and `tier4-fax.ts:86`.

| Entry point | Callers | Guarded |
|---|---|---|
| `submitTier1Api` (Tier 1; Tier 3 through the same adapter) | `routing-engine.ts:663`; `api/adapters/submit/route.ts:96,116` | yes: adapter :149, and `routeOrder` at `routing-engine.ts:562` |
| `submitTier2Portal` | `routing-engine.ts:671`; `api/adapters/submit/route.ts:124` | yes: adapter :199, and :562 |
| `submitTier4Fax` | `routing-engine.ts:631` (direct), `:786` (cascade), `:915` (`submitQueuedFax`); `cron/fax-retry/route.ts:124`; `cron/sla-check/route.ts:221`; `api/adapters/submit/route.ts:104` | yes: adapter :86; `submitQueuedFax` also at :905 |
| `routeOrder` | `webhooks/stripe/route.ts:593`; `cron/submit-paid-orders/route.ts:95`; `api/adapters/route-order/route.ts:177`; `ops/orders/[orderId]/action/route.ts:360` (retry_submission) | yes, through the adapters |
| `submitQueuedFax` | `ops/orders/[orderId]/action/route.ts:413` (force_fax, retry_fax) | yes: :905 and the adapter |
| `sendFax` (Documo) | only `tier4-fax.ts:331` | yes, behind :86 |

Paths that send nothing to a pharmacy:
- Ops reroute moves the order to REROUTE_PENDING through `casTransition`.
- Slack `manual_fax` and `order_reroute` only log
  (`slack/interactions/route.ts:119-127`).
- `submission-reconciliation` and `stuck-orders.ts` only alert.
- `portal-status-poll` sends no clinical content (but see T7).

### T1. High, blocking until B4 is applied: the binding can be forged, and "legacy" has no limit

- **Where:**
  - `src/lib/orders/signature-binding.ts:134,145`: the binding is
    `sha256(DOMAIN, digest, time, content)` with no secret, and DOMAIN
    (`:35`) is in the source.
  - `signature-binding.ts:161`: any 64-hex value parses as `legacy`.
  - `src/lib/adapters/transmission-guard.ts:87-90`: a legacy order is sent
    with no content check.
  - `prevent_snapshot_mutation` only fires once `OLD.locked_at` is set.
  - On today's base, `orders_clinic_user_update`
    (`20261010000001_app_metadata_roles.sql:165`) lets any clinic role
    update any column of its clinic's orders. The B4 lockdown that would
    stop this (`rls-user-write-lockdown-v2`, migration 000004) is on
    neither `main` nor `bundle-features`.
- **Scenario:**
  1. A medical assistant uses the browser Supabase client with the anon
     key on a DRAFT order.
  2. They set `locked_at`, set `provider_signature_hash_snapshot` to 64
     zeros (or a v2 value they computed themselves), and set
     `status = 'PAID_PROCESSING'`.
  3. The submit-paid-orders cron routes it. The guard returns `legacy`
     (or `bound`), and the order goes to the pharmacy with no provider
     signature and no payment.
- **Confirmed:** a throwaway jest test against the real
  `assertOrderTransmittable` with a mocked database row.
  - The all-zero hash returned `legacy`.
  - A self-computed v2 value over altered content (new `sig_text`,
    refills 11) returned `bound`.
- **Fix:**
  - Key the binding: HMAC with a server-only secret.
  - Accept `legacy` only for a fixed list of order ids locked before the
    deploy, or only when a `provider_batch_sign` history row's
    `signature_hash` equals the column.
  - Apply B4 (000004) first, and confirm with a PostgREST PATCH test that
    clinic users cannot write `status`, `locked_at`,
    `provider_signature_hash_snapshot` or the clinical columns.

### T2. High: the pharmacy receives fields the binding does not cover

- **Where:** `CANONICAL_FIELDS` / `SIGNED_ORDER_COLUMNS` in
  `signature-binding.ts` bind `patient_id`, `provider_npi_snapshot`,
  `pharmacy_snapshot`, `medication_snapshot`, the Rx columns and the
  allergies. The adapters also send values read live at send time:
  - **Destination pharmacy:**
    - Tier 4 sends to `orders.pharmacy_id` (`tier4-fax.ts:93,146,219`),
      and Tier 1 and 2 send to the caller's `pharmacyId`.
    - `pharmacy_id` is not bound, nothing compares it with
      `pharmacy_snapshot`, and it is clinic-writable before B4.
    - So a signed prescription can be sent to a different pharmacy with
      no refusal.
  - **Patient name and date of birth:** read live from `patients`, which
    stays writable after signing (for example, by the intake route).
  - **Prescriber name, DEA and license state:** read live from
    `providers`.
    - Tier 2 sends the live `provider.npi_number` instead of the snapshot.
    - Tier 4 falls back to the live NPI when the snapshot is null.
  - **Shipping address snapshot columns:** not bound, but the trigger
    freezes them (low). Legacy orders fall back to the live patient
    address.
  - **Clinic name and order number:** not bound (low).
- **Confirmed:** by tracing the code. These fields are absent from the
  bound columns and present in the Tier 1 payload, the Tier 4 PDF and the
  Tier 2 field maps.
- **Fix:**
  - Bind patient name and DOB, prescriber name, DEA, license and NPI
    (snapshot them at signing if needed), and the destination pharmacy id.
  - Refuse to send when `pharmacy_id` differs from the signed pharmacy. A
    legitimate reroute or cascade changes the pharmacy, so it must re-bind
    through an audited path.

### T3. Medium: the guard checks one read of the order; the adapter sends another

- **Where:** the guard reads the row (`tier1-api.ts:149`,
  `tier2-portal.ts:199`, `tier4-fax.ts:86`). The adapter then selects the
  order again (`tier1-api.ts:218`, `tier2-portal.ts:245`,
  `tier4-fax.ts:91-93`) and builds the payload from that copy.
- **Scenario:** many bound columns stay writable after lock, because
  `prevent_snapshot_mutation` does not freeze them: `sig_text`,
  `sig_mode`, `titration_steps`, `quantity`, `dispense_*`, `days_supply`,
  `refills`, `substitution_allowed`, `special_instructions`, `package_*`,
  `syringe_option` and `shipping_type` (that is B5). A write that lands
  between the two reads is sent unverified. In Tier 1 the window spans a
  Vault read and the rate-limit check.
- **Confirmed:** by tracing the code (the two separate selects).
- **Fix:**
  - Have the guard return the verified row and build from it, or verify
    the row the adapter loaded.
  - Add the bound columns to `prevent_snapshot_mutation` (B5).

### T4. Medium: Tier 1 follows an https-to-http redirect and resends the PHI

- **Where:** `src/lib/adapters/tier1-api.ts:380` calls
  `fetch(submitUrl, …)` with no `redirect` option, so it uses the default
  `follow`.
- **Confirmed:** a throwaway jest test. A local https server answered 307
  to a plain-http server, and Node's fetch followed it. The http server
  received the full JSON body. (`Authorization` was dropped because the
  origin changed, but the PHI went out in cleartext.)
- **Fix:** pass `redirect: 'error'`, or use `manual` and re-check
  `Location` with `assertSecurePharmacyUrl`.

### T5. Medium: the Tier 2 browser does not enforce https after the first navigation

- **Where:**
  - Only the configured URLs are checked (`tier2-portal.ts:233-242`).
  - `page.goto` (`portal-flow-executor.ts:126`, `tier2-portal.ts:433`)
    follows server redirects.
  - Later clicks and form posts can go to `http:` carrying the typed PHI
    and credentials. Nothing routes requests, filters them or checks the
    scheme of `page.url()`.
- **Confirmed:** by tracing the code. Chromium was not run.
- **Fix:**
  - Add `context.route('**/*', …)` that aborts any non-https request,
    keeping the localhost test exception.
  - Check the scheme of `page.url()` before every fill step.

### T6. Low (operational): a legitimate allergy edit strands paid orders

- **Scenario:** allergies are bound, but staff can change them at any
  time (`PATCH /api/patients/[id]/allergies`). After a change, every
  signed, unsent order for that patient is refused with
  `signature_mismatch`, and there is no way to re-sign it.
- **Confirmed:** by tracing the code (`signature-binding.ts`, allergies in
  the canonical content).
- **Note:** this fails closed, so it is not a security hole.
- **Fix:** give such orders a re-sign path, or warn about (or refuse)
  allergy edits while signed orders are in flight.

### T7. Low: the portal status poll has no https check

- **Where:** `src/app/api/cron/portal-status-poll/route.ts:134` runs the
  portal's `status_check_flow`, typing portal credentials, without
  `assertSecurePharmacyUrl`.
- **Fix:** apply the same flow-URL check Tier 2 uses.

### Checks that passed (order-transmission-integrity)

- **Guard coverage:** every path that sends to a pharmacy reaches the
  guard (table above). That includes retries, the cascade, the queued fax,
  ops retry and force-fax, and the crons. Nothing calls `sendFax` or a
  pharmacy endpoint directly.
- **Hash determinism between signing and sending:** this holds, because
  both sides read the same columns through PostgREST
  (`signature-binding.ts` read at sign and at send).
  - Same hash: key order, `10` vs `10.0`, `undefined` vs `null`, and
    every `locked_at` form that carries an offset.
  - Different hash: `"10"` vs `10`, `""` vs `null`, NFC vs NFD, trailing
    whitespace, allergy order, and a time with no zone.
  - None of those differing forms can arise between the two reads of the
    same stored row. A future write path that stores NFD text, or reorders
    allergies, would make a signed order fail closed (refused), not pass.
- **Nulling the hash of a signed order:** it is refused (`unsigned`), and
  the trigger freezes the column after lock. The open hole is the
  `legacy` acceptance (T1).
- **The URL check itself:**
  - Refused: `HTTP://`, `hTtP://`, leading whitespace or a tab before
    `http`, `http:\\`, `http:/`, `ws:`, `javascript:`, `//host`, and
    `https://` with no host.
  - Accepted: `HTTPS://`, padded `https`, and `https:\\…` (normalised to
    https).
  - `http://localhost` passes only under `NODE_ENV=test`.
  - The gaps are after the check (T4, T5).

### Not verifiable here (order-transmission-integrity)

- The live Postgres grants, RLS and triggers on any deployed project
  (only the migrations were read). T1's write path assumes the deployed
  RLS matches them.
- What Chromium does on an https-to-http redirect for a real portal.
- Whether any real pharmacy host uses HSTS.

---

## Recommended order of fixes

1. T1, the forgeable binding and unlimited legacy: key the binding and
   restrict legacy.
2. Apply B4 (000004) first.
3. P1, the recovery-only reset endpoint.
4. T2, the unbound fields, and the destination pharmacy above all.
5. T4 and T5, redirects to http.
6. T3, one row for both the check and the payload, together with B5.
7. P3, P2, then the lows.
