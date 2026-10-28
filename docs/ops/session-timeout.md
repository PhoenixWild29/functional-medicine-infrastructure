# Session time-box and inactivity timeout (HIPAA B8)

C's evidence map (2026-10-25), gap B8: the app has no server-side session inactivity timeout or time-box.

- **What logs a user off today.** The 15-minute automatic logoff (`src/components/hipaa-timeout.tsx`) runs only in an open browser tab.
- **What it misses.** A closed tab, a stolen refresh token or a script keeps a Supabase session alive for as long as its refresh token is used.
- **What closes the gap.** Two hosted Supabase Auth settings. They are not in the repo: `supabase/config.toml` is the local CLI config only. Sam sets them in the Supabase dashboard of each project.

## The settings (names only)

In the Supabase dashboard: **Authentication → Sessions**, and **Authentication → JWT / Access token**. The CLI config keys are given for reference.

| Setting (dashboard) | Config key (CLI) | Recommended | Why |
|---|---|---|---|
| Time-box user sessions | `[auth.sessions] timebox` | `12h` | A signed-in session ends 12 hours after sign-in, whatever the activity: about one clinic day. The next request after that signs the user out. |
| Inactivity timeout | `[auth.sessions] inactivity_timeout` | `30m` | A session whose refresh token is not used for 30 minutes ends. That covers closed tabs, abandoned devices and stolen tokens. |
| Access token (JWT) expiry | `[auth] jwt_expiry` | `900` (seconds, 15 minutes) | The access token is refreshed at least every 15 minutes while the app is open. That keeps an active user inside the 30-minute inactivity window, and means a revoked or ended session stops working within 15 minutes. |
| Single session per user (optional) | `[auth.sessions] single_per_user` | off | It would sign a user out of their other device at each sign-in. Turn it on only if the practice wants that. |

**Why the JWT expiry must be shorter than the inactivity timeout.** Supabase counts activity by refresh-token use. A token that lives longer than the inactivity window would let an active user's session lapse between refreshes. Keep the JWT expiry at or below half the inactivity timeout.

**Plan.** Session time-boxes and inactivity timeouts are paid-plan features of Supabase Auth: confirm the plan includes them. The values above cannot be checked from the repo; record the values set, with the date, in the compliance evidence.

## What users see

- **Idle in an open tab (15 minutes, unchanged).**
  - A warning dialog appears two minutes before the end, with "Stay signed in".
  - Then the app signs out and goes to `/login?reason=session_timeout`.
  - The sign-in page shows no specific sentence for that reason today; it is the ordinary sign-in form. A small follow-up could add "You were signed out after 15 minutes of inactivity."
- **Inactivity timeout (30 minutes) or time-box (12 hours) reached.** The session's refresh token stops working.
  - The next page load or API call has no valid session.
  - The middleware sends pages to `/login?redirectTo=<the page>`, and API calls answer 401.
  - After signing in (and MFA, when required), the user returns to the page they asked for.
  - Unsaved form input on the page is lost, as with any sign-out.
- **Patients** use checkout, intake and plan links, which have no Supabase session. They are not affected.

## How to check after setting them

1. Sign in on a test account, close the tab, wait 31 minutes, and open the app. It should ask for sign-in.
2. With a session open and active, sign-in should be asked again 12 hours after the original sign-in.
3. In **Authentication → Users**, the user's sessions should show as ended.
