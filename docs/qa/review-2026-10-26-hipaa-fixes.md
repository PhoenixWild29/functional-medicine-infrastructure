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

---

## phi-access-log-coverage (C, 896cc3f), reviewed 2026-10-26

Task B-2026-10-26-03. This reviews the code of
`origin/phi-access-log-coverage` diffed against `origin/bundle-features`
(merge-base 31bb77e5), not C's report. It also covers D's merge of the
branch into `origin/audit-review-breakglass` (merge 95023bd0; that branch's
head is now 7ef4590f).

Each finding was confirmed by reading the path end to end (file:line is on
896cc3f), or with a throwaway jest test in a detached worktree, since
deleted. No branch was modified, and no database was touched.

What counts as "logged" (`src/lib/audit/phi-access.ts`):
- `logPhiAccess`;
- `logPhiAccessMany`, one row per patient, inserted in chunks of 500;
- `logPhiDisclosure`, action `export`; the caller must not send when it
  returns false;
- the wrappers `logFaxQueueView` (`src/lib/fax/log-fax-view.ts`) and
  `refuseUnlessProposalWriteLogged` (`src/lib/proposals/request.ts`).

None of them throws. Each returns a boolean.

### Summary

| # | Finding | Severity |
|---|---|---|
| L1 | Several writes commit first and then log, ignoring a failed log write (signing, join, Keragon, favorites, plus older routes) | High (against the "writes must not proceed" rule) |
| L2 | Twilio SMS sends (phone, first name, provider name, link) are not logged as disclosures | Medium |
| L3 | The patient import's 422 answer echoes every row and existing patients' names with no log row | Medium |
| L4 | The dashboard's chosen-plan queue names patients who are not in the logged set (for a provider, other providers' patients) | Medium |
| L5 | The 30-second dashboard poll writes one row per patient per poll, over an unbounded query; the ops fax log sends up to 200 separate inserts per poll | Medium (volume and latency) |
| L6 | A log call with no resolvable actor returns false with no alert at all | Medium |
| L7 | Patient names in the practice attention `errors[]` are not logged | Low |
| L8 | Inbound Twilio STOP/START updates `patients.sms_opt_in` with no log row | Low |
| L9 | `routePattern` masks only UUID segments; a base64url token would be stored verbatim | Low (latent) |
| L10 | The health check treats only `VERCEL_ENV=production` as production | Low |

Verdict:
- **What holds:**
  - Disclosures are correctly fail-closed: pharmacy Tiers 1, 2 and 4, the
    OpenAI screenshot and the Anthropic face sheet.
  - The log content is clean.
  - The health check is right.
  - The merge dropped nothing.
- **Fix before calling B14 and B15 closed:**
  - L1, since the rule says writes must not proceed when the log fails;
  - the coverage gaps L2 to L4;
  - L6, which breaks the "never silent" promise;
  - L5, before real clinic volume.

### L1. High: writes that commit before the log, and ignore its failure

Already fail-closed (log first, 503 on failure):
- proposals send, cancel and events (`src/lib/proposals/request.ts:84-106`);
- plan choose and decline (`src/app/api/plan/[token]/route.ts:149,159`);
- intake submit (`src/app/api/intake/[token]/route.ts:62-67`);
- favorites updates (`src/app/api/favorites/route.ts:375,497,534,593`);
- ops fax actions (`api/ops/fax/[faxId]/action/route.ts:51`);
- ops order actions (`api/ops/orders/[orderId]/action/route.ts:132`).

Writes that commit first, then call `logPhiAccess` and discard its result.

New in this diff:
- `src/app/api/orders/batch-sign/route.ts:96-99` (signing);
- `src/app/api/proposals/[proposalId]/sign/route.ts:47`;
- `src/app/api/join/[token]/route.ts:137`;
- `src/lib/integrations/keragon/webhook.ts:144`;
- `src/app/api/favorites/route.ts:431`.

Already present before this diff:
- `api/orders/route.ts:456` (create);
- `api/orders/[orderId]/route.ts:326,369` (PATCH, DELETE);
- `api/patients/route.ts:184` (create; the intake SMS then still goes out);
- `api/patients/import/route.ts:92`;
- `api/patients/[patientId]/allergies/route.ts:216`;
- `api/patient-phases/route.ts:255,318,363`;
- checkout-link `:152`, group-and-send `:179`, group-link `:169` and
  reassign-to-me `:182`.

- **Scenario:** the `phi_access_log` insert fails (a database error, or a
  CHECK failure). The prescription is signed, the patient is created or the
  allergies are changed, and the response is 200 or 201. There is only an
  alert, and no audit row exists for the change.
- **About signing:** batch-sign's comment says this is deliberate, because
  a signature cannot be undone. That is exactly why the row should be
  written first.
- **Confirmed:** by reading each site. The boolean is discarded after the
  write.
- **Fix:**
  - Write the row before the write, and answer 503 on failure, as
    proposals do.
  - Where the id exists only after the write (a new patient, favorite or
    join), insert the log row in the same transaction or RPC.
  - For signing, write one `sign` row per order before the batch is signed.

### L2. Medium: Twilio SMS disclosures are not logged

- **Where:**
  - `src/lib/proposals/sms.ts:78`;
  - `src/lib/intake/sms.ts:84`;
  - `src/lib/sms/sender.ts:180`, through `triggers.ts`: the payment link,
    payment confirmation, the 24 h and 48 h reminders, and shipping.
- **Triggered by:** `POST /api/proposals`, batch-sign
  (`batch-sign.ts:1002`), the Stripe webhook `:461`, cron sla-check `:280`,
  patient create and the intake link.
- **What leaves:** the patient's phone, first name and provider last name,
  plus a link.
- **What is recorded:** only an `sms_log` row; no `phi_access_log` row. The
  Documo fax path, also a BAA vendor, is logged and fail-closed.
- **Confirmed:** by reading the three senders. No `logPhi*` call precedes
  `messages.create`.
- **Fix:** before each send, call `logPhiDisclosure({ actor:
  systemActor(clinicId), resource: 'sms_disclosure', patientId, orderId })`,
  and skip the send when it returns false. This needs a new resource code.
  Raise the severity if policy treats every outbound vendor send as a
  disclosure.

### L3. Medium: the import's 422 answer is unlogged

- **Where:** `src/app/api/patients/import/route.ts:51-53`.
- **Scenario:** staff post an import in which any included row has an error.
  - The response spreads `...review`: every file row's parsed patient data,
    plus existing patients' names through duplicates of kind `existing`
    (`lib/patients/import/duplicates.ts:52`).
  - No row is written. The same payload from `/validate` is logged
    (`validate/route.ts:42-44`).
- **Confirmed:** by reading the route.
- **Fix:** before the 422, log as `validate` does: the preview entry, plus
  `logPhiAccessMany` over the existing-duplicate ids. Or answer row indexes
  and errors only.

### L4. Medium: the dashboard's chosen-plan queue is outside the logged set

- **Where:**
  - `src/app/(clinic-app)/dashboard/page.tsx:223` loads `chosenPlans`
    (`lib/proposals/queue.ts:77`: patient first name and plan label);
  - `:355` renders it;
  - the logged set at `:313-315` holds only the orders' patients and the
    duplicate-flag names.
- **Scenario:** a provider on the default (own) view.
  - Orders RLS limits the orders to the provider's own
    (`20260611000004:68-74`).
  - `treatment_proposals_clinic_read` is clinic-wide (`20261024000002:79`).
  - So the dashboard shows "Jordan chose Foundation plan…" for other
    providers' patients, and no row names them.
- **Confirmed:** by reading the page and the migrations. RLS was not run.
- **Fix:** add the chosen plans' patient ids to `listedPatientIds`.

### L5. Medium: log volume from the 30-second polls

- **Dashboard poll:**
  - `src/app/(clinic-app)/dashboard/_components/orders-dashboard.tsx:219`
    refetches every 30 s (paused in a background tab), calling
    `GET /api/dashboard/orders`.
  - That route (`route.ts:47-79`) reads every non-deleted order of the
    clinic with no `.limit()`, then logs every distinct patient on every
    poll.
  - The inserts are batched (500 rows each), but the chunks are awaited in
    sequence, so a clinic with more than 500 patients adds round trips to
    each poll.
  - At 10 open dashboards with 50 patients each, that is 1,000 rows a
    minute: about 600k rows in a 10-hour day, or 1.44M if left open.
- **Ops fax queue:**
  - `ops/fax/_components/fax-triage-queue.tsx:83` also polls every 30 s.
  - `src/lib/fax/log-fax-view.ts:32-35` issues one `logPhiAccess` per
    matched order: up to 200 separate parallel inserts, not one array
    insert.
  - That is about 576k rows a day per open ops tab.
- **Confirmed:** by reading the code end to end.
- **Fix:**
  - Deduplicate: log once per actor, patient and resource per window (for
    example 15 minutes). Use a server-side check, or a unique index on
    actor, patient, resource and time bucket with `ON CONFLICT DO NOTHING`.
    Or skip the row on a poll whose patient set has not changed.
  - Bound the dashboard query.
  - Make `log-fax-view` one array insert.

### L6. Medium: a missing actor is silent

- **Where:** `src/lib/audit/phi-access.ts:210` and `:278`. `if (!actor)
  return false` runs before `reportLogFailure`, so there is no console
  line, no Slack and no Sentry.
- **Scenario:**
  - `src/app/(ops-dashboard)/ops/fax/page.tsx:68` passes
    `await getRequestUser()`. That is a second `getUser()` call after the
    ops layout's, and it turns any error into null
    (`src/lib/auth/request-user.ts:17-23`).
  - On a transient auth error, the page still renders the queue with its
    15-minute signed fax PDF URLs, with no row and no alert.
  - Disclosures are unaffected: `logPhiDisclosure` also returns false, so
    they stay closed.
- **Confirmed:** a throwaway test. `logPhiAccess({ user: null, ... })` gave
  false, with 0 inserts, 0 Slack and 0 Sentry.
- **Fix:** call `reportLogFailure(route, action, 'no_actor')` before
  returning false.

### L7. Low: names in the practice attention errors

- **Where:**
  - `src/lib/practice/attention.ts:170` pushes `Draft check for <medication,
    patient full name>` into `errors`.
  - `/api/practice` returns that list (`route.ts:58`).
  - Only the patients in `items` are logged (`route.ts:51-53`).
- **Fix:** add those drafts' patient ids to the logged set, or leave the
  name out of the error text.

### L8. Low: inbound STOP/START is unlogged

- **Where:** `src/lib/sms/inbound.ts:84` updates `patients.sms_opt_in`
  (matched by phone) as a system write, with no log row.
- **Fix:** write one `logPhiAccess(systemActor, 'update', 'patient')` row
  per patient updated.

### L9. Low (latent): routePattern masks UUIDs only

- **Where:** `routePattern` / `UUID_SEGMENT_RE` in `phi-access.ts`. It
  strips the query string and replaces UUID segments only.
- **Effect:** a base64url bearer token fits the route CHECK's characters,
  so it would be stored verbatim and the insert would succeed.
- **Confirmed:** a throwaway test stored `/plan/AbC-def_123TOKENxyz`.
- **Exposure today:** none. Every call site passes a literal pattern (for
  example `'/api/plan/[token]'`), and nothing builds the route from
  `request.url`.
- **Fix:** take route patterns from a typed allow-list, or refuse any
  segment that is not a literal or `[param]`.

### L10. Low: the health check's notion of production

- **Where:** `src/app/api/health/route.ts` answers 503 only when
  `VERCEL_ENV === 'production'`.
- **Effect:** a non-Vercel production run (`NODE_ENV=production` only)
  answers 200 with the secret missing.
- **Fix:** acceptable while production is always on Vercel. Otherwise, also
  fail on `NODE_ENV === 'production' && !VERCEL_ENV`.

### PHI path inventory (logged = a log call on every branch that returns or sends PHI)

| Path | PHI | Logged |
|---|---|---|
| Tier 1/3 pharmacy POST (`tier1-api.ts` ~389) | disclose | yes: `logPhiDisclosure` before every attempt, fail-closed |
| Tier 2 portal fill (`tier2-portal.ts` ~459) | disclose | yes: before submit, fail-closed |
| Tier 2 screenshot to OpenAI (~475) | disclose | yes: fail-closed (score 0, manual review) |
| Tier 4 Documo fax (`tier4-fax.ts` ~338) | disclose | yes: fail-closed before `sendFax` |
| Adapter callers (routing engine, `/api/adapters/submit`, fax-retry, sla-check, submit-paid-orders) | via adapters | yes, in the adapter |
| Face sheet to Anthropic (`/api/patients/face-sheet:122`) | disclose | yes: fail-closed, then a view row |
| Keragon inbound (`keragon/webhook.ts:143`) | write | yes, after the write (L1); no outbound Keragon exists |
| Twilio SMS (proposals, intake, payment, reminders, shipping) | disclose | **no** (L2) |
| Inbound STOP/START (`sms/inbound.ts:84`) | write | **no** (L8) |
| `/dashboard` page (`page.tsx:316`) | list | partial: chosen plans missing (L4) |
| `/api/dashboard/orders` poll (`:80`) | list | yes (volume, L5) |
| `/api/practice` and `lib/practice/attention.ts` | list | partial: `errors[]` names (L7) |
| `/new-prescription`, `/new-prescription/search` | list, draft | yes |
| `checkout/[token]` (`render-checkout.tsx:129,204`) | order, group | yes (patient actor) |
| `/api/plan/[token]` | view, choose, decline | yes: writes fail-closed |
| `/api/intake/[token]` (`:62`) | write | yes: fail-closed before the claim |
| `/api/join/[token]` (`:137`) | create | yes, after the create (L1) |
| `/api/patients` POST (`:144,184`) | duplicates, create | yes; create logs after (L1) |
| `/api/patients/import/parse` (`:54`), `/validate` (`:42-44`) | file rows, duplicate names | yes |
| `/api/patients/import` POST | rows, names | success logged (`:92`, after); **the 422 is not logged** (L3) |
| Allergies, EHR changes, duplicate flag, intake link, patient phases, favorites | single record | yes (some after the write, L1) |
| Orders: PATCH/DELETE, record, timeline, bundlable siblings, checkout link, group link, group-and-send, reassign, batch-sign, compliance check, refill, create | order, patient | yes (the writes log after, L1) |
| Proposals: create, sign, send, cancel, events | write | yes: send, cancel and events fail-closed; sign logs after (L1) |
| `/ops/fax` page (`:68`), `/api/ops/fax` (`:110`) | queue, signed PDF URLs | yes (L5 volume, L6 no actor) |
| `/api/ops/fax/[faxId]/action` | write | yes: fail-closed |
| `/api/ops/orders/[id]/action` (`:132`), detail (`:96`) | write, read | yes: action fail-closed |
| Stripe, portal status poll, Slack, checkout success, plan quote, timeline actors, failure reason, favorites frequent, ops pipeline and SLA, Documo inbound webhook | ids, amounts or no PHI | n/a |

Not re-audited branch by branch (a log call is present):
- the margin, sign and refill pages;
- bundlable-siblings, checkout-link, group-link, group-and-send,
  reassign-to-me, compliance-check, refill, intake-link and duplicate-flag;
- the settings access log.

### Checks that passed

**Fail-closed disclosures:**
- **Tier 1:** a false result throws `DisclosureNotRecordedError`, which
  retries and then ends `exhausted`. The routing engine does not count it
  against the circuit breaker (`routing-engine.ts:653,664`).
- **Tier 2:** the screenshot is sent only when the disclosure is logged.
- **Tier 4:** the send is refused before `sendFax`.
- **Face sheet:** 503 before `extractFaceSheet`.
- `sendFax` has one caller, and so does OpenAI; both are covered.
- The practice CSV holds aggregates only.

**No leaked 500:**
- The log helpers never throw, so no route answers 500 because of the log.
- Log-failure answers are fixed sentences.
- Reads still serve when the log fails, and alert through the console (code
  only), Slack and Sentry, throttled to once a minute per route and action.
  L6 is the exception.

**Log content:**
- The row holds ids, role, action, resource, a route pattern and HMAC
  hashes only.
- On failure, only the error code, route and action are reported. A test
  confirmed that the Postgres "Failing row contains ..." text is not
  forwarded.
- Resource codes fit `^[a-z_]{1,40}$`, including D's `ops_reason_*`.
- **Patient actors on token pages:** `actor_role` is `patient` and
  `actor_user_id` is the patient id (a uuid, so NOT NULL holds). The system
  actor is the nil uuid.
- Neither the token nor its hash is stored, and token routes use literal
  patterns.
- Each insert is bounded at 500 rows. The number of rows per call is not
  (L5).

**Health check (throwaway tests):**
- Production with the secret missing: 503. Whitespace only: 503.
- The secret set: 200. Preview with it missing: 200.
- The body says only `set` or `missing`. No value or length appears in the
  body or the logs.

**D's merge (95023bd0, parents 9ac38805 and 896cc3fb):**
- Only two files needed resolution:
  - `order-drawer.tsx`: this branch's removal of the browser Supabase
    client was kept.
  - `phi-access.ts`: the resource union, plus `OpsAccessReasonResource`.
- Nothing was dropped. Every non-test file in this branch's diff has the
  same number of `logPhi*`, `logFaxQueueView`, `refuseUnless...` and
  `disclosed` calls at 896cc3f and at the breakglass head.
- **D's new code:**
  - The access-review CSV export is logged (`export`, `access_log`) and
    fails closed. The CSV holds ids and codes only.
  - Opening an ops order with a reason writes a view row plus an
    `ops_reason_<code>` row. Only `emergency` fails closed, by design.

### Seen in passing (outside the log scope)

`src/app/api/favorites/route.ts` returns raw Supabase `error.message` in its
500 bodies (lines 239, 265, 367, 385, 426, 506, 550 and 602). One of these
is new in this diff; the rest predate it. This leaks database error text,
and these should be fixed messages.

### Not verifiable here

- Real inserts against the deployed schema: the CHECK constraints for the
  new resource codes, and RLS. L4 rests on reading the migrations.
- Slack delivery, and insert latency under load.
- Whether Twilio is covered by a BAA, and whether policy counts sends to
  BAA vendors as logged disclosures. This sets L2's severity.
- Whether production runs only on Vercel (L10).
- Whether a Keragon `error` outcome can follow a partial patient write.
  `lib/integrations/keragon/sync.ts` was not read.

### Recommended order of fixes

1. L1: log first, or log in the same transaction, for writes (signing
   first).
2. L6: alert on a missing actor.
3. L3, L4 and L2: the coverage gaps.
4. L5: deduplicate and bound the polls before real clinic volume.
5. The lows.

---

## bundle-hipaa merge resolutions (D), reviewed 2026-10-26

Task B-2026-10-26-05. This reviews the merges in `origin/bundle-hipaa` on top of `origin/bundle-features` (8af58776), from the commits themselves rather than D's report.

- **Head reviewed:** 1ea42cc7 (D's report plus an EPCS test timeout). It was unchanged at the end of the review.
- **Merges, first parent:**
  - e41cfa3d: clinic-help 96f74e33.
  - a4cc8820: password-flows 1d0ed5e1.
  - d91d63ca: auth-monitoring 438d960e.
  - b6f93df4: audit-review-breakglass 7ef4590f.
- **Also checked:** the earlier merge inside audit-review-breakglass, 95023bd0, which brings in phi-access-log-coverage 896cc3fb.

### Method

1. **Merge-tree comparison.** For each merge, I recomputed the clean three-way merge of its two parents (`git merge-tree --write-tree`) and diffed it against D's actual merge tree. Any file that differs is a hand resolution, or an edit made inside the merge.
2. **Shared files.** For every non-test file a source branch changed, the head was compared with that branch's version. Where they differ (the file was also changed by another side), I checked three things:
   - reverse-applied the branch's own patch to the head, to see whether its hunks are present;
   - checked that every line the branch added is present at the head;
   - checked that no line the branch removed reappears.
3. **Tests.** Every test file each source branch added or changed was compared with the head. Every `e2e/*.spec.ts` at the head was checked against the playwright projects.
4. **Semantics.** The auth routes, the sign-in monitor and `phi-access.ts` at the head were read for each side's rules and for the handler order.

### Result: no defect in the merges

**Hand resolutions.** Only the conflicted files differ from the clean auto-merge, so nothing else was edited inside a merge:
- **a4cc8820, `playwright.config.ts`:** the chromium `testMatch` keeps both `keyboard-core-flows.spec.ts` (bundle-features) and `password-change.spec.ts` (password-flows).
- **d91d63ca, `src/middleware.ts`:** `publicExactRoutes` keeps all three sides' routes: `/get-started`, `/api/signup`, `/forgot-password`, `/api/auth/password-reset` and `/api/sign-in`, with both comments. Two checks:
  - Every other line password-flows and auth-monitoring added is present at the head. The only lines not found verbatim are the two old one-sided route lists, which the head replaces with this superset.
  - No removed line reappears.
- **b6f93df4, `ops-nav.tsx`:** both tabs kept, "Security" (auth-monitoring) and "Access review" (breakglass). All of both sides' added lines are present.
- **b6f93df4, `new-prescription/search/page.tsx`:** both import sets are kept and used: clinic-help's `HelpLink`, and the phi-log's `logPhiAccess` and `currentRequestHeaders`. All added lines are present, and no removed line reappears.
- **95023bd0 (inside breakglass):**
  - `order-drawer.tsx`: the phi-log branch's removal of the browser Supabase client was kept.
  - `phi-access.ts`: the B14 resources plus `OpsAccessReasonResource`.

  This merge was already checked in the phi-log review above. No removed line reappears.

**Auto-merged shared files.** Each side's patch reverse-applies cleanly at the head, so all their hunks are present:
- `login/page.tsx`: password-flows' "Forgot password?" link and auth-monitoring's server sign-in.
- `batch-review-form.tsx`: clinic-help, plus bundle-features' keyboard fix.
- `lib/slack/ops-alert.ts`: auth-monitoring's alert types plus breakglass's.

**Everything else.** All other source files are byte-identical at the head to their source branch. That covers:
- all password routes and `recovery-session.ts`;
- `password-rate-limit.ts`;
- `sign-in-monitor.ts`, `api/sign-in` and `api/mfa/verify`;
- `phi-access.ts` and every PHI-log call site;
- the access-review and ops-reason code.

So each side's rules carry over unchanged:
- **password-flows:** recovery-only `/api/auth/password` (`isRecentRecovery`, a per-user limit), and the reset limiter order (IP, then address and IP, then address).
- **auth-monitoring 438d960e:** the email-and-IP throttle key (`passwordThrottleKey`) and the `>=` alert rules.
- **breakglass:** the D1 to D6 fixes, including emergency and export failing closed.
- **phi-log:** its fail-closed disclosures and writes, as they stood at 896cc3f. Findings L1 to L10 above still apply; they are not merge defects.

**Tests.** All 78 test files added or changed by the four source branches are present and byte-identical at the head (clinic-help 2, password-flows 11, auth-monitoring 22, audit-review-breakglass 43, the last including phi-access-log-coverage's).

**E2E.** Every `e2e/*.spec.ts` at the head is in a playwright project, and none of the source branches' specs is missing.

**Handler order.** The auth routes at the head keep cross-site, then the auth or gate, then parse, then the limits, then the Supabase call:
- **change:** cross-site, `getUser`, parse, limit, current-password check, update, sign out the others.
- **password:** cross-site, `getUser`, recovery claims, limit, parse, policy, update, global sign-out.
- **password-reset:** cross-site, parse, then the IP, address-and-IP and address limits, then send.
- **sign-in:** cross-site, parse, throttle, sign in.
- **mfa/verify:** cross-site, `getUser`, parse, throttle, verify.

**D's report** (1ea42cc7) states exactly these resolutions and no deliberate removals, which matches the above.

### Cross-side notes (not merge defects; low)

- **The reset paths are not MFA-exempt.** A user with an authenticator who opens a reset link lands at AAL1, so `/reset-password` sends them through `/mfa/challenge` first. Afterwards the session's `amr` carries both `totp` and `recovery`, and `isRecentRecovery` still accepts it, provided the code is entered within 15 minutes of opening the link. This is the right behaviour, a second factor before a password reset, but it is worth a line in Help.
- **Failed current-password checks are not monitored.** `/api/auth/password/change` checks the current password with its own `signInWithPassword` client. Those failures are limited (5 per 15 minutes per user) but are not recorded or alerted by the sign-in monitor. Fix if wanted: call `recordSignInFailure` with step `password` and reason `current_password` on a failed check.
- **Shared server IP.** Both the server sign-in and that check now reach Supabase Auth from the server's IP, which adds to Supabase's per-IP sign-in limit (see the auth-monitoring report).

### Follow-up: newer commits

None landed before the end of this review:
- `origin/bundle-hipaa` is still 1ea42cc7.
- `phi-access-log-coverage` is still 896cc3f, so C's L1 to L10 fixes are not pushed yet.
- `order-transmission-integrity` (2b9b69a) is not yet merged into the bundle.

When they land, each merge needs the same checks:
- the merge-tree comparison;
- each side's added and removed lines;
- the test and E2E inventory.

For the transmission merge, also check these, since both branches change them: `tier1-api.ts`, `tier2-portal.ts`, `tier4-fax.ts` and `routing-engine.ts`. A's guard and C's disclosure logging must both be present in each adapter, with the order: guard, then the disclosure log, then the send.

---

## phi-access-log-coverage: fix verification (L1 to L10), 2026-10-26

Task B-2026-10-26-07, part 2. This verifies C's fixes for findings L1 to L10 (the section "phi-access-log-coverage (C, 896cc3f)" above), on `origin/phi-access-log-coverage` at **07a12024**. It covers seven commits after 896cc3f, made as three red-then-green pairs plus C's report:

| Red tests | Fix |
|---|---|
| 7f1ad585 (L5, L6, the L1 follow-up row) | 697571e7 |
| cb354def (L2, L4, L5, L6, L7, L9, L10) | cdbef7fe |
| 3e9c8148 (L1, L3, L8) | 574d4e12 |

I read the code, not C's report. Nothing was pushed to C's branch.

### Method

**Red then green.**
- The three red commits change only test files. I checked this with `git diff --name-only <red>^ <red>`.
- Each red commit's test files were run at that commit, so against the code before its fix, with `jest --runTestsByPath`. A first run that passed the paths as patterns silently skipped every path containing `[...]`, so it was redone with literal paths.
- At 7f1ad585, the 1 suite fails: 9 of 11 tests.
- At cb354def, all 10 suites fail: 19 of 87 tests.
- At 3e9c8148, 19 of 23 suites fail (89 of 525 tests). The 4 that pass are existing tests C only adjusted for the new log calls:
  - `orders/[orderId]/__tests__/proposal-edit-revoke.test.ts`;
  - `patient-phases/__tests__/{input-validation,advanced-by,generic-errors}.test.ts`.

  They are not new red tests.
- At 07a12024, all 33 suites (34 file entries, one shared between two commits) pass: **612 of 612 tests**.

**Re-reading the code.** I re-read the code for each finding at 07a12024.

**L1 re-run on both signing paths:**
- **Batch sign:** the library-level test runs the real `signBatch` against a database fake. `src/lib/orders/__tests__/batch-sign.test.ts:1048`:
  - `beforeWrite` runs once, after every check, with 0 writes and 0 shipping calls so far;
  - when it returns false: 503, 0 writes, and no shipping or payment-group call.
- **No earlier write:** I scanned `signBatch` from its start (`batch-sign.ts:780`) to the `beforeWrite` call (`:854`). It has no insert, update, upsert, delete, rpc or `casTransition`.
- **Proposal sign:** `signChosenProposal` passes `beforeWrite` through to `signBatch`, and its only writes come after `signBatch` returns (`sign-choice.ts:113-149`).
  - Its test wraps the real `signBatch` with `jest.fn(actual.signBatch)`, so the refusal path is genuine.
  - A refused log gives 503: nothing signed or cancelled, and the plan stays chosen (`sign-choice.test.ts`, "a refused log").
- **Both routes:** a refused log gives 503 "This change could not be recorded. Nothing was changed. Try again."
  - If signing then fails, each logged order gets a `not_completed` row; for a partial sign, only the unsigned orders do.

**Nothing new opened:**
- I searched every `logPhiAccess*` call whose result is not checked, then classified each by action (below).
- Lint, tsc and the full jest suite ran at 07a12024 (results under Gates).

### Per finding

| # | Verdict | Evidence at 07a12024 |
|---|---|---|
| L1 | **Fixed** for every site in the finding; 3 more writes with the same pattern remain (see "Not fully closed") | Batch sign and proposal sign log before any write, as above. Order create, PATCH and DELETE; patient create; import; allergies; patient phases; checkout link, group link, group-and-send, reassign; join; Keragon; favorites: each logs before its write (`if (!(await logPhiAccess(…))) return phiWriteRefused()`), with a `not_completed` row when the write then fails. Creates generate their id first (`crypto.randomUUID()`). Red: 3e9c8148 |
| L2 | **Fixed** | `sms/sender.ts:347`: `logPhiDisclosure` (resource `sms_disclosure`) before `dispatchWithRetry`, the only `messages.create` (`:181`); false returns `disclosure_not_recorded`, not sent. The same before the send at `proposals/sms.ts:81` → `:87` and `intake/sms.ts:87` → `:94`. No other Twilio send exists (`notifications/catalog.ts` only names the senders). Red: cb354def |
| L3 | **Fixed** | `patients/import/route.ts:70-74`: before the 422, the preview row plus one row per existing duplicate shown; 503 if they cannot be written. Red: 3e9c8148 |
| L4 | **Fixed** | `dashboard/page.tsx:320`: the chosen plans' patient ids join `listedPatientIds`. Red: cb354def |
| L5 | **Fixed** | `logPhiAccessBatch`: one insert per 500 rows. An optional dedupe reads back from `phi_access_log` (same actor, action and resource, the last N minutes, at most 5000 rows), so it holds across instances. A failed read writes every row: duplicates, never a gap. The dashboard poll (`api/dashboard/orders/route.ts:69,88`) is bounded and deduped for 15 minutes, as are the page render (`:325`) and `/api/practice`. The fax queue (`log-fax-view.ts:41-44`) is now one batch insert, deduped. Red: 7f1ad585, cb354def |
| L6 | **Fixed** | `phi-access.ts:227` and `:325`: no actor calls `reportLogFailure(route, action, 'no_actor')` before returning false. Red: 7f1ad585, cb354def |
| L7 | **Fixed** | `practice/attention.ts`: `AttentionError.patientId` is set for "Draft check for …". `/api/practice` logs `items` plus `errors`, deduped. Red: cb354def |
| L8 | **Fixed**, with a documented exception | `sms/inbound.ts`: STOP and START are logged before the update in one batch. A refused log does **not** refuse the opt-out: a STOP must always be honoured (TCPA), and the failure is alerted. That is the right call. Patients the pre-read missed are logged after, best effort; a failed update gets `not_completed`. Red: 3e9c8148 |
| L9 | **Fixed** | `routePattern` keeps only `[param]` segments and lowercase words of up to 32 characters; any other segment becomes `[id]`. A base64url token (43 characters, mixed case) is masked. Residual (low): a lowercase alphanumeric token of 32 characters or fewer would still pass as a word; no current token has that shape. Red: cb354def |
| L10 | **Fixed** | `api/health/route.ts:27-28`: production means `VERCEL_ENV === 'production'` when `VERCEL_ENV` is set, else `NODE_ENV === 'production'`, so a non-Vercel production run is checked and a Vercel preview is not. Red: cb354def |
| Seen in passing | **Fixed** | The favorites 500 bodies no longer carry the raw Supabase `error.message` (574d4e12) |

### Not fully closed (medium; L1's rule, at sites outside L1's list)

Three writes still log after the write and ignore the result. They predate this branch, were not named in L1, and are not in C's "Remaining" list:

- **`src/app/api/patients/[patientId]/intake-link/route.ts:83`:** a new intake link is created (`:73`) and texted, and only then is the `update`/`patient` row written. Its SMS disclosure is fail-closed (L2), but the token rotation is not.
- **`src/app/api/patients/[patientId]/duplicate-flag/route.ts:67`:** the dismissal is saved (`.update`, `:56`), then logged.
- **`src/app/api/proposals/route.ts:62`:** `createProposal` (`:58`) writes the plan and its draft orders, then logs the `create`.

Fix: the same pattern as the rest: `if (!(await logPhiAccess(entry))) return phiWriteRefused()` before the write, and `logPhiWriteNotCompleted` if it then fails. For the proposal, generate the id first or log per patient.

Everything else with an unchecked log call is a read (`view`), which may serve and alert by design, or a deliberate "best effort" second row after a first row was already written before the write: join `:157`, group-and-send `:193`, import `:123`.

### New side effect (low, not security)

`/api/dashboard/orders` now returns at most `POLL_ORDER_LIMIT = 1000` orders (newest `updated_at` first). The page's first render is not limited. A clinic with more than 1,000 non-deleted orders would see its oldest orders drop out after the first 30-second refresh, with nothing saying the list was cut. Fix: page by tab or date, or show "showing the newest 1,000".

### C's own "Remaining" list

C lists these as remaining; they are not regressions:
- join and import pre-rows have no patient id (needs a migration);
- the favorite id is not in the log;
- the `/api/patients` 409 duplicate-check view is unchecked;
- favorites/frequent logs `error.message` to the console;
- sign-choice's "Nothing was signed." on a partial-sign 500;
- the reassign-to-me partial move.

### Gates at 07a12024

- npm run lint (eslint . --max-warnings=0): 0 errors, 0 warnings
- npx tsc --noEmit: clean
- npx jest --maxWorkers=3: full run 633 of 638 suites. That run was on a heavily loaded machine: two suites took about 2,360 s each. The 6 suites that failed in it (5 a11y and UI suites, plus order-drawer-order-switch, none touched by this branch) were rerun on their own and all pass: 6 of 6 suites, 58 of 58 tests. So they were timing failures, not regressions

### Verdict

- L1 to L10 are fixed, each with a test that fails before its fix and passes after.
- L1 re-run: on batch sign and proposal sign, a failed log write means nothing is written (proven against the real `signBatch`).
- Nothing new was opened, except the low poll-truncation side effect above.
- Before B14 and B15 count as closed, the three after-the-write logs above (intake link, duplicate flag, proposal create) should get the same log-first fix.

---

## order-transmission-integrity: verification of A's fixes for D's findings 1-7, 2026-10-26

Task B-2026-10-26-09. I checked A's fixes for D's verification (`origin/verify-transmission`, `docs/qa/verify-2026-10-26-transmission.md`) on `origin/order-transmission-integrity` at **f4b7487a**. The red tests are at **36cf5a31**. I also checked C's dry run 2, items 6 to 9 (`origin/dry-run-2-report`).

Only confirmed results are reported. Each was confirmed in one of these ways:
- A's tests, run before and after the fix;
- my own throwaway probes against the real code, run and then deleted;
- real Chromium (Playwright 1.58, chromium-1208);
- reading the code, marked where it is the only evidence.

Nothing was pushed to A's, C's or D's branches.

### Summary

| D's finding | Fixed? | Red before the fix | Note |
|---|---|---|---|
| 1. T5/T7 redirect hops | **Partly.** A redirect straight to http is refused. **A redirect to http after an allowed hop still goes through, form body included.** | Yes (`portal-redirect-hops`) | **R1, high**, below |
| 2. The development key outside production | **Fixed** | Yes (health, signature-binding, batch-sign) | |
| 3. Key rotation | **Fixed** | Yes | |
| 4. The legacy cutoff | **Fixed** | Yes | |
| 5. The T6 clinic copy | **Fixed** | Yes (`submission-failure`) | |
| 6. The OAuth `token_url` | **Fixed** | Yes (`vault-token-https`) | |
| 7. The legacy digest for `provider_sign_and_send` | **Fixed**, by tying the row to the signing time | Yes | |

**A's tests, red then green:** A's 13 jest test files were run at 36cf5a31 and at f4b7487a.
- At 36cf5a31, 7 files fail: 27 tests.
- The 6 that pass are fixture updates: each adds `signed_at` to a legacy history row in a test.
- At f4b7487a: 333 of 333 tests pass.
- The Chromium part of `portal-redirect-hops` ran; it was not skipped.

### R1. High: a redirect to http after an allowed hop is followed, and resends a form

- **Where:** `src/lib/adapters/transmission-guard.ts:322-351`, `enforceHttpsOnly`.
  - The handler fetches each allowed request itself (`route.fetch({ maxRedirects: 0 })`) and refuses a 3xx whose Location is not allowed.
  - When the redirect's target is allowed, it hands the 3xx back to the browser (`route.fulfill({ response })`). It assumes the browser's next hop "is a new request and comes through the route again".
  - **In Chromium it does not.** After a fulfilled redirect, Chromium follows the rest of the chain without calling the route.
- **Confirmed** in real Chromium, with A's real `enforceHttpsOnly`: server A allowed, server B blocked, B recording every request.
  - **Which requests the route sees:** for `A/chain` → 302 → `A/chain2` → 301 → `B/chain-end`, the handler ran only for `A/chain`. A received `/chain` and `/chain2`, and **B received `GET /chain-end`**. Reproduced 3 of 3.
  - **A form POST:** a form POST to `A/submit` → 307 → `A/submit2` → 307 → `B/steal`. **B received `POST /steal` with the body `phi=Jane+Doe+1980-01-01`.**
- **Production scenario:**
  1. An https portal answers a submit with a 307 to another https page on its own site.
  2. That page answers with a 307 to an http URL.
  3. The patient and prescription fields Tier 2 typed are resent in cleartext.

  The same applies to the status poll's typed portal credentials. `assertPageSecure` only stops the next fill.
- **What A's handler does stop** (each case confirmed alone, 3 of 3):
  - a direct 302 to B;
  - a direct 307 form POST to B;
  - a 303 after a POST;
  - a page `fetch` straight to B.

  An allowed same-origin redirect still works.
- **Why A's test passes:** its Chromium case has one allowed same-origin redirect that ends there, and direct redirects to the blocked origin. It never has a redirect after an allowed hop.
- **Fix:** do not hand an allowed 3xx back to the browser. Follow the chain inside the handler:
  1. `route.fetch({ url: next, maxRedirects: 0 })`, hop by hop, checking every Location with the same rule. Keep the method and body for 307 and 308; use GET for 301, 302 and 303 after a POST.
  2. Cap the number of hops.
  3. Fulfill only the final, non-3xx response.

  `page.url()` then stays the first URL, which was checked. Then add the two-hop chain and the two-hop 307 POST to the Chromium test.

### 2. The development key: fixed

- **Where:** `bindingKeyRequired()` (`signature-binding.ts:98-101`) requires `RX_BINDING_SECRET` in these cases:
  - `VERCEL` or `VERCEL_ENV` is set: production, preview, `vercel dev`;
  - any `NODE_ENV` other than `test` or `development`, including **unset**, so a bare node script also requires it.
- **My probe:**
  - The key is required on Vercel production, Vercel preview, vercel dev, `VERCEL` alone, `next start` off Vercel, `NODE_ENV` unset and `NODE_ENV=staging`.
  - It is not required for local `next dev` or jest.
  - On a Vercel preview with no key, signing throws `BindingKeyMissing`, and a value made with the development key never verifies as `match`.
  - With a real key set, a development-key value is a `mismatch`: the development key is never in the verification list.
- **Health check:** `/api/health` now fails on the same rule (`bindingKeyRequired() && missing`), and batch sign refuses before reading or writing.

### 3. Rotation: fixed

My probe:
- An order signed under the old key is a `mismatch` under the new key alone, and a `match` with `RX_BINDING_SECRET_PREVIOUS` set to the old key.
- Altered content under the previous key is still a `mismatch`.
- A new binding uses the current key: it differs from the old one and verifies without `PREVIOUS`.
- A reroute proof made under the old key passes with `PREVIOUS`, and not under a third key.
- The runbook `docs/ops/rx-binding-key.md` gives the steps.

### 4. The legacy cutoff: fixed

- `legacySigningCutoff()` reads `RX_LEGACY_CUTOFF`. My probe:
  - Unset, empty or not a time (`'tomorrow'`): even a perfect batch-sign row is not accepted as legacy.
  - Set to a later time: the same row is accepted.

### 5. The T6 clinic copy: fixed

- `submissionFailureNotice` (`submission-failure.ts`). For `allergies_changed`, `signature_mismatch`, `unsigned_order` and `pharmacy_mismatch`, my probe got "CompoundIQ ops will cancel and refund it; then prescribe it again".
- None of them says "Cancel this prescription", and none has an em dash.

### 6. The OAuth token_url: fixed

- `vault.ts:112-117` checks `creds.token_url` with `isSecurePharmacyUrl` before the client secret is posted. Otherwise it throws `insecure_pharmacy_url`.
- The fetch has `redirect: 'error'`.
- A's `vault-token-https.test.ts` was red at 36cf5a31 and passes now.

### 7. The provider_sign_and_send legacy digest: fixed

- `legacySignatureProven` (`signature-binding.ts:372-395`) now requires:
  - `metadata.signed_at` at the same instant as the order's `locked_at` (`sameInstant`, so the format does not matter);
  - a digest equal to the column wherever the row records one;
  - for batch-sign rows, a digest at all.
- **My probe:**
  - A `provider_sign_and_send` row with `signed_at` the same instant as `locked_at` (written `+00:00`) is accepted.
  - The same row with another `signed_at`, or none, is refused.
  - A row carrying a different digest is refused.
  - 64 zeros with a sign-and-send row from another signing is refused (that was D's case 3).
  - A batch-sign row with no digest, another digest, or a time after the cutoff is refused.
- **The tie holds for real old orders:** on `main`, batch-sign writes `locked_at: signedAt` (`batch-sign.ts:897`) and the history metadata `signed_at: signedAt` (`:939`) from the same value.

### Nothing new opened, apart from R1

A's changes to the health check, `env.ts` and batch-sign only widen where the key is required: from `VERCEL_ENV=production` to any Vercel deployment or any server outside local test and development. That is stricter, not looser.

Not a finding (not demonstrable in a probe):
- The Tier 2 context does not set `serviceWorkers: 'block'`, and a context route does not see requests a service worker handles.
- On an https portal, Chromium's mixed-content rule blocks a service worker's fetch to http anyway.
- Setting `serviceWorkers: 'block'` in `getBrowserContextOptions` would be a cheap belt-and-braces step.

### C's dry run 2, items 6 to 9: as described

Checked on C's local dry-run commits:
- **fef437cc:** the merge of `signed-order-freeze`, before the test fixes;
- **939aec59:** the test fixes.

On the four test files C changed, **13 tests fail at fef437cc** and all **113 pass at 939aec59**.

- **Item 6: the health check, two secrets.** Two tests fail at fef437cc, one from each side:
  - signed-order-freeze's "fails (503) in production when it is missing ...";
  - bundle-hipaa's "production with the secret: 200, and the value is never in the body".

  Each sets only its own secret, against the merged route that checks both. As described.
- **Item 7: the Tier 2 order read moved.** Confirmed by reading the code:
  - bundle-hipaa's tier2 adds `clinic_id` to its own order select;
  - signed-order-freeze replaces that read with `loadTransmittableOrder`, whose `SEND_ORDER_COLUMNS` include `clinic_id`;
  - freeze's local `OrderRow` type has no `clinic_id`;
  - C's merge adds `clinic_id: string` to it (`tier2-portal.ts:265`), and the disclosure call uses it (`:382`, `:387`).

  As described.
- **Item 8: the disclosure tests.** 10 of `phi-disclosure.test.ts` fail at fef437cc (Tier 1 ×4, Tier 2 ×3, Tier 4 ×3), with `TransmissionRefusedError: Order o-1 has not been signed, so it was not sent`. The guard refuses the file's unsigned orders. As described.
- **Item 9: batch-sign's partial sign.** "a partial sign names the orders that were not signed" fails at fef437cc: the expected status was 500 and the received status is **503**. The freeze's per-order binding write catches the order that left DRAFT before anything is signed. As described.

### Verdict

Findings 2 to 7 are fixed, each with a test that fails before its fix. Finding 1 (T5/T7) is **not fully closed**: R1 is a confirmed, high-severity gap, because a redirect to http that comes after an allowed hop is followed, form body included. Fix R1 as above before Tier 2 portal sending is relied on. C's items 6 to 9 are as C described.
