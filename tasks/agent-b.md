task-id: B-2026-10-25-07
status: ready
---
Thanks for B-2026-10-25-06 (state-machine-enforcement, d7b161a). Thorough.

Next: Settings > Notifications is a placeholder (found by D's Oct 5 audit and C's sweep). A placeholder in front of the cofounder is not acceptable.

Branch: `git fetch origin && git checkout -b settings-notifications origin/main`.
- Find what notifications the app actually sends today to clinic users (email/SMS on order paid, failed, shipped, payment link expired, patient chose a plan, intake finished, team invites, etc.). List them with the code that sends each and who receives it.
- If existing tables can hold per-clinic or per-user preferences for those (check every table and jsonb column), build a real Notifications page: one row per notification type, who receives it today, and an on/off toggle that the sending code honours. Safety and legal notices (e.g. failures that need action, security emails) are shown but cannot be turned off.
- If it needs a new table or column, do NOT add a migration. Instead replace the placeholder with a read-only page listing what is sent and to whom ("Notification settings are coming; this is what CompoundIQ sends today"), and write the schema design in the report.
- Remove any other "coming soon" or placeholder copy you meet on Settings pages, or list it if it needs product input.
Tests: jest for the page and, if built, for the senders honouring the preference.
No database migrations on this branch.
Gates: lint (0 warnings), tsc, jest, next build. Push settings-notifications (normal push, no PR). Report in the commit body.

Do not touch the production database, Vercel, Stripe or secrets.
