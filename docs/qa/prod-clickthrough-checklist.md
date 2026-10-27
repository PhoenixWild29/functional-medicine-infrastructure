# Production click-through checklist

For the orchestrator (or any careful tester) to verify production in a browser in about 60 to 90 minutes. Generated from the code on `main` at 2696ff2 (2026-10-25). Each line names the file that renders the text, so a mismatch can be traced. Paths are relative to `src/`.

**Updated 2026-10-25 for after the merge queue lands.** Read from these origin branches:
- bundle-security: error-boundaries, api-input-validation, security-followups-3, token-pages-hardening, checkout-token-out-of-url.
- bundle-ci: including patient-pages-mobile and perf-bundles.
- The bundle-features branches, not yet pushed as a bundle: state-machine-enforcement, rx-quantity-shipping, rx-allergies-required, favorites-frequent, settings-notifications.
- The five migration branches: ops-fax-viewer-documo, rls-user-write-lockdown-v2, security-followups-2, signup-squatting, rate-limit-db.

Items new or changed for them are marked **(new)** or **(changed)**. Before testing, check the migrations ran: 20261024000003 to 20261024000007, in order.

## How to read this

Each item is one line:

`[CLASS] click -> expect "exact text"; must not: ...`

| Class | Meaning |
|---|---|
| **SAFE** | Read-only. Click freely. |
| **WRITES DATA** | Creates or changes prod rows. Do it only on the test records named here, and note what you created. |
| **NEVER** | Do not press on production. Confirm the control is there, then stop. Reason given. |

Text in quotes is the exact visible copy. `{x}` is a value that varies.

## Ground rules (read first)

1. **Stripe is live.** Never type in the card fields on a checkout page and never press "Pay". **Opening** an active checkout link (an order in AWAITING_PAYMENT) already creates a live Stripe PaymentIntent and stores its id on the order (`api/checkout/payment-intent/route.ts`). Nothing is charged, but it is a write. Open one at most once (step 7.3).
2. **SMS is the only outbound message.** The app sends no email at all; invites and links are copied by hand. Texts go out (when Twilio is configured on prod) from exactly these actions:
   - "Add patient" / "No, add a new patient" on the new-patient form. The intake link is texted **even without opt-in** (`lib/intake/sms.ts`).
   - "Resend link" (intake) on a draft row or in the session banner.
   - "Send to patient for choice", "Send the plan link", "Send a new link" (plan link, only if the patient opted in).
   - "Confirm & Send" and "Sign & Send N Prescription(s)" (payment link, only if opted in). Signing also creates the Stripe payment and starts the pharmacy send, so these are always **NEVER**.
3. **Demo phones.** Every seeded Sunrise patient uses the fictional 555-01xx exchange (for example +1 415 555 0110), so a text cannot reach a real phone. But every seeded patient has `sms_opt_in = true`, and patients created on prod by people (not in any seed) may have **real** numbers. Before any action in rule 2, open the patient and check the phone.
4. **Faxes, pharmacy submissions and Slack alerts are real.** "Retry", "Force Fax", "Retry Fax", "Reject Order" and catalog "Trigger Sync" all reach outside systems.
5. **Garbage tokens are safe.** `/plan/abc`, `/intake/abc`, `/join/abc`, `/checkout/abc`, `/onboard/clinic/abc`, `/onboard/join/abc`, `/onboard/pharmacy/abc` each validate before any write. Use them for the "invalid link" states.
6. **/ops/demo-tools shows passwords in plain text.** Redact any screenshot of it.
7. Keep a list of every row you create (test patient, test provider, test invite, test protocol). Section 9 says how to leave things.
8. **(new) The sign page's allergy prompt sends.** On /new-prescription/sign, "Save allergies" inside "Record allergies or mark NKDA before signing" signs and sends at once. NEVER save there unless every selected draft is the test patient's and you mean to sign. (On Review, the same prompt only reopens the confirm step.)
9. **(new) Never refresh checkout.** After the page loads, the address bar reads plain `/checkout`; a refresh shows "Please reopen your payment link". Reopen the copied link instead.
10. **(new) Rate limits are shared and persistent.** Two sign-ups from one network with an email that already exists block sign-ups from it for an hour ("Too many sign-up attempts from here. Wait a few minutes, then try again."). Plan, join, face-sheet and invite pages are also limited ("Too many requests. Wait a few minutes, then try again."). Do not hammer them.

## Accounts

| Role | Email | Lands on |
|---|---|---|
| Clinic admin (Sunrise) | admin@sunrise-clinic.com | /practice |
| Provider (Sunrise) | dr.chen@sunrise-clinic.com | /dashboard |
| Medical assistant (Sunrise) | ma@sunrise-clinic.com | /dashboard |
| Ops admin | ops@compoundiq-poc.com | /ops/pipeline |
| Pharmacy admin | pharmacy-admin@compoundiq-poc.com, **only if it was ever created on prod** (no seed creates it; Sam to confirm) | /pharmacy/onboarding |
| Patient | no login; token pages only (section 7) | |

Sources: `lib/poc/canonical-users.ts`, `lib/auth/landing-route.ts`, `lib/pharmacy-onboarding/demo-invite.ts`. Passwords are not in this document. Ops and pharmacy admin may be asked for two-step sign-in (`/mfa/challenge`); pharmacy admin always is.

## Demo data map

Sunrise Functional Medicine is the demo clinic. Blue Cedar Integrative Health is a second tenant with no login.

| Order | Patient | Pharmacy (tier) | Status | Open it for |
|---|---|---|---|---|
| DEMO-1001 | Jordan Rivera | Strive (T4 Fax) | DELIVERED | history, tracking |
| DEMO-1002 | Ethan Brooks | Strive (T4 Fax) | DELIVERED | fax tier |
| DEMO-1003 | Sofia Nguyen | Portal Plus (T2) | DELIVERED | |
| DEMO-1004 | Noah Kim | Express Digital (T1) | DELIVERED | |
| DEMO-1005 | Liam Carter | Quick Rx (T1) | SHIPPED | tracking |
| DEMO-1006 | Grace O'Connor | Portal Plus (T2) | SHIPPED | |
| DEMO-1007 | Maya Thompson | Express Digital (T1) | PHARMACY_PROCESSING | |
| DEMO-1008 | Ava Martinez | Strive (T4 Fax) | PHARMACY_PROCESSING | |
| DEMO-1009 | Jordan Rivera | Quick Rx (T1) | PAID_PROCESSING | |
| DEMO-1010 | Sofia Nguyen | Portal Plus (T2) | PAID_PROCESSING | |
| **DEMO-1011** | Noah Kim | Express Digital (T1) | **SUBMISSION_FAILED** | failure reason (clinic drawer), ops triage, Submissions tab |
| DEMO-1012 | Ruby Sandoval (Blue Cedar) | Hybrid Labs (T3 Hybrid) | seeded AWAITING_PAYMENT; the expiry cron has likely made it PAYMENT_EXPIRED | ops clinic filter only |
| DEMO-1013 | Ethan Brooks | Hybrid Labs (T3 Hybrid) | SHIPPED, this month | practice dashboard, payables |
| DEMO-1014 | Grace O'Connor | Portal Plus (T2) | SHIPPED, this month | practice dashboard, payables |
| DEMO-1015 | Liam Carter | Quick Rx (T1) | PAID_PROCESSING, this month | practice dashboard, payables |

Sources: `scripts/demo-expansion-seed.sql`, `scripts/demo/2026-10-23-sunrise-refresh.sql`, `lib/poc/refresh-demo-data.ts`.

Known gaps in the demo data:
- **No Sunrise order is AWAITING_PAYMENT.** Step 7.3 explains how to get a checkout link safely, or skip it.
- **No demo order has SLA rows**, so SLA checks are empty states only.
- The seed sets no refills, so "Refill this prescription" may not appear on demo orders.

## Time plan

| Section | Minutes |
|---|---|
| 1. Signed out | 5 |
| 2. Clinic admin (incl. the new Rx, favorites and Notifications items) | 28 |
| 3. Provider | 8 |
| 4. Medical assistant | 5 |
| 5. Ops admin | 18 |
| 6. Pharmacy admin (if the account exists) | 4 |
| 7. Patient token pages (incl. 390 px check) | 12 |
| 8. Patient protocol choice, end to end (incl. lockout) | 9 |
| Total | about 89; skip 6 and 8.6 if short of time |

---

## 1. Signed out (5 min)

### /login (`app/login/page.tsx`)
- [SAFE] Open /login -> "Sign in", "Access your clinic dashboard", "Email address", "Password", button "Sign in", "HIPAA-compliant authentication", link "New to CompoundIQ? Get started", footer "Privacy Policy" and "Terms of Use"; must not: "Sign in" enabled before both fields are filled.
- [SAFE] /login?error=deactivated -> "Your access has been turned off. Contact your clinic admin."
- [SAFE] /login?error=auth_callback_failed -> "Email verification failed. Please try signing in again."
- [SAFE] /login?error=zzz -> "Something went wrong. Please try again."
- [SAFE] Wrong password once -> "Invalid email or password. Please try again."; must not: navigate away. Keep it to one or two tries (Supabase throttles).

### /get-started (`app/get-started/_components/get-started-form.tsx`)
- [SAFE] Open -> "Get started with CompoundIQ", "Create your account and look around right away. Nothing can be ordered, signed or received until CompoundIQ approves you.", "What are you setting up?", radios "I'm a provider (solo practice)", "I run a clinic or practice", "I run a compounding pharmacy", link "Already have an account? Sign in"; must not: form fields before a radio is picked.
- [SAFE] Pick each radio -> org label changes ("Practice name" / "Clinic or practice name" / "Pharmacy name"). Solo provider adds "NPI", "State licenses", "Add another state license", "DEA number (optional)". Pharmacy adds "Pharmacies set up two-step verification the first time they sign in."
- [SAFE] Type a 5-character password and press "Create account" -> "Use at least 12 characters." (client-side; nothing sent). Mismatched confirm -> "The passwords do not match."
- [WRITES DATA] A valid "Create account" creates a real clinic, provider or pharmacy account (POST /api/signup). **Skip on prod** unless Sam wants a test sign-up; if done, use an address you own, and step 5.9 must not approve it.

### Static pages
- [SAFE] /legal/privacy -> "Privacy Policy", "Version 1.0. Effective October 12, 2026."; /legal/patient-terms -> "Patient Terms of Use", same version line; must not: ask for sign-in.
- [SAFE] /unauthorized signed out -> "Access Denied", "You don't have permission to access this page.", "Sign out"; must not: redirect to /login.
- [SAFE] /mfa/enroll signed out -> redirects to /login?redirectTo=...
- [SAFE] **(new)** /no-such-page signed out -> "Page not found", "We could not find that page. If your clinic sent you a link, please ask them to send it again.", "Go to sign in" (`app/not-found.tsx`); must not: a bare "404".

---

## 2. Clinic admin: admin@sunrise-clinic.com (25 min)

### 2.1 Landing, sidebar, banners
- [SAFE] Sign in -> lands on /practice. Sidebar "Dashboard", "New Prescription", "Practice", "Settings"; footer role "Admin", "Sign out", "Collapse" (`components/sidebar-nav.tsx`).
- [SAFE] **(new)** /settings/no-such-page -> "Page not found", "We could not find that page. It may have been moved, or the link may be incomplete.", "Back to dashboard".
- [SAFE] Sunrise is approved -> must not: see "We're verifying your licenses..." or "Submitted. We're reviewing your clinic; ordering opens once you're approved." (`components/pending-review-banner.tsx`). (The banner itself is checked on a not-yet-approved clinic only; see 5.9.)

### 2.2 /practice (`app/(clinic-app)/practice/`)
- [SAFE] -> "Practice Dashboard". Period buttons "Today", "7 days", "30 days", "Month to date", "Custom".
- [SAFE] "Month to date" -> cards "Scripts", "Patient revenue (collected)", "Clinic payout", "Shipping passed through" (or "Shipping absorbed by the clinic"), "Avg margin"; DEMO-1013..1015 count here. Note "CompoundIQ's monthly fee is billed separately and is not taken from orders."; must not: "$0" where an error should be ("... This is an error, not a zero." with "Retry").
- [SAFE] "Custom" -> "From", "To", "Cancel"; one date only -> "Choose both dates."
- [SAFE] Tabs "By provider", "By pharmacy", "By medication"; "Export CSV" downloads in the browser.
- [SAFE] "Needs attention" section: items or "Nothing needs attention."

### 2.3 /dashboard (`app/(clinic-app)/dashboard/`)
- [SAFE] -> "Dashboard", "Revenue overview and order management for your clinic."
- [SAFE] Setup checklist (if not hidden): "Get set up", "{n} of {m} done", steps "Enter your practice details", "Accept the BAA and terms", "Add your team", "Add patients: import, a sign-up link or one at a time", "Send your first prescription", each "Done" or "To do" (`components/coaching/setup-checklist-card.tsx`, `lib/coaching/checklist.ts`).
- [WRITES DATA] "Hide checklist" -> card goes, sidebar shows "Show setup checklist"; click it -> card returns. Writes only this user's preference.
- [SAFE] "Plans ready to sign" card appears only if a patient has chosen a plan (checked in section 8).
- [SAFE] KPI cards "Total Orders", "Revenue", "Pending Payment", "Shipped". Click one -> "Showing orders created this month", "Show all dates"; must not: a card number that differs from the rows its tab shows.
- [SAFE] Toolbar "Orders", "Table" / "Cards", "+ New Protocol", "Refill", "+ New Prescription".
- [SAFE] Tabs in order "All", "Drafts", "Proposed", "Pending Payment", "Submitting", "Processing", "Shipped", "Errors". Click each; empty ones show "No draft orders", "No plans are waiting for a patient to choose", "No orders are waiting for payment", "No orders are being submitted", "No orders are being processed", "No orders have shipped", "No orders need attention". Footer "Showing X of Y orders".
- [SAFE] "Cards" view -> "View" opens the drawer; must not: a card drag change status.
- [NEVER] "Resend link" on any draft row (texts the patient the intake link).

### 2.4 Order drawer (`dashboard/_components/order-drawer.tsx`)
- [SAFE] Open DEMO-1005 -> "Order", "Financial Split", "Rx details", "Rx Document", "Status Timeline", "Close drawer"; Escape closes it.
- [SAFE] **Open DEMO-1011 (Errors tab)** -> "Sending to Express Digital Rx failed: {plain reason}. CompoundIQ ops has been alerted and will re-route or retry." (`lib/orders/submission-failure.ts`); must not: a raw code such as PHARMACY_API_UNAVAILABLE, a stack trace or a URL; must not: any retry button for the clinic.
- [SAFE] A PAYMENT_EXPIRED order (if any) -> "Payment Link Expired", "Regenerate Payment Link". The button only mints a link (POST /api/orders/[id]/checkout-link): no SMS, no Stripe. Do not give the link to anyone.
- [WRITES DATA] "Combine into one payment link" (shown only with Phase C groups on and several unpaid orders) creates a payment group. Skip.

### 2.5 /new-prescription walk (stop before signing)
- [SAFE] "+ New Prescription" -> "New Prescription"; steps "Patient & Provider", "Add Prescriptions", "Review & Send" (`new-prescription/_lib/wizard-steps.ts`).
- [WRITES DATA] First visit only: "Tips for your first prescription", "Tip 1 of 4", "Next", "Skip tips". "Skip tips" / "Done" saves a preference; must not: return after reload.
- [SAFE] Search "Search by name, DOB, or phone..." -> type "Kim" -> Noah Kim; type "zzzz" -> "No patients match your search."
- [SAFE] "Select Provider" list shows "NPI: ...". "Continue to Pharmacy Search" disabled until a patient and a provider are both chosen.
- [SAFE] **"+ New patient"** form -> "New patient", "The patient gets a link to fill in the rest on their phone. You can prescribe now; nothing is signed or charged until they finish."
  - **Face sheet hidden without a key.** If prod has no ANTHROPIC_API_KEY (or FACE_SHEET_AI_ENABLED=false): must not see "Drop a face sheet", "Choose a face sheet file" or "Paste text instead" (`new-patient-form.tsx`, `lib/face-sheet/config.ts`). If they are shown, the key is set: then check the 4 MB limit by choosing a 5 MB PDF -> "That file is over 4 MB. Choose a smaller file, or paste the text instead." (client-side, nothing sent). Do not upload a real face sheet.
  - [NEVER with a real number] "Add patient" texts the intake link. Close the form here, or follow 7.1 to make the one test patient.
- [SAFE] Pick Noah Kim and a provider -> "Continue to Pharmacy Search" -> "Configure Prescription", "Search medication name...", "Favorites (N)", "Protocols (N)".
- [SAFE] **(new)** "Favorites (N)" -> "Frequently used (last 90 days)", or "Recent" when nothing was ordered in 90 days.
  - Entries read "{dose with mg} · {pharmacy} · used N times" (`quick-actions-panel.tsx`). An entry already saved reads "★ Favorite".
  - Clicking an entry opens the dose step with the dropdowns filled in.
- [SAFE] **(new)** "Make favorite" on an entry -> dialog "Make {drug} a favorite" (`make-favorite-dialog.tsx`).
  - "Save it for": "The practice" (default) or "Only for {patient}".
  - "Doses on this favorite": the used dose ticked, the drug's other doses unticked, and "Add dose".
  - "Save favorite" is disabled with nothing ticked.
  - Press "Cancel", or Escape. [WRITES DATA] "Save favorite" adds a favorite to the demo clinic; delete it afterwards with the card's delete.
- [SAFE] **(new)** Pharmacy cards (Semaglutide 5 mg/mL, 80 units, Once weekly, For 90 days):
  - each card shows its suggested vials ("2 × 5 mL vials") and the shipping it adds: "+ $X shipping (cold chain)", "Ships with the other {pharmacy} prescription" or "Free shipping";
  - a pharmacy with no rates on file shows no shipping line;
  - "Refills" offers "0 refills" to "12 refills".
- [SAFE] Pick any medication and pharmacy -> "Continue to Set Retail Price" -> "Set Retail Price", "Wholesale Cost (locked)", "1.5×", "2×", "2.5×", "3×". A price below cost -> "Retail price must be at least the wholesale cost ($X)."
- [SAFE] **(new)** With a line at another pharmacy already in the session, the price page shows "2 pharmacies → 2 shipping charges ($X)." under the shipping line, with no "Route all to" button (that stays on Review).
- [SAFE] "Review & Send (1)" -> "Review & Send", "Review all prescriptions, sign once, and send the payment link."
- [SAFE] **(new)** Card "Rx details" -> "Dispense: 9.6 mL (2 × 5 mL vials)", "Days supply", "Refills" (0 to 12).
  - The screen shows the amount and the vials. The pharmacy now also receives "Quantity: 2 vials" (a capsule line: "Quantity: 30 capsules").
  - That Quantity line is printed only on the fax PDF. On prod it cannot be seen without submitting and paying an order (NEVER), so it is not checked here; the PDF tests cover it.
  - In the order drawer, "Rx Document" still reads "PDF preview available after pharmacy submission" for new orders.
- [SAFE] **(new)** Allergies required (`review/_components/allergy-notice.tsx`). Only for a patient whose chip reads "not recorded"; never clear a real patient's allergies to get there, which the app no longer allows anyway.
  - Amber notice: "Allergies not recorded for {name}" and "Record allergies or mark NKDA before signing. Confirm NKDA here, or record the allergies. You can still save as a draft.", with "Confirm NKDA" and "Record allergies".
  - Pressing the Sign & Send button opens the prompt "Record allergies or mark NKDA before signing": "{name}: the pharmacy receives allergies or NKDA on every prescription. Nothing has been signed, and your prescriptions are kept. Save, and signing continues."
  - The prompt holds "No known drug allergies (NKDA)", "Save allergies" and "Cancel". Press "Cancel".
- [SAFE] **(new)** The same patient in plan mode: "Send to patient for choice" is refused with "Record allergies or mark NKDA before sending this plan", and the same prompt opens. Press "Cancel".
- [WRITES DATA] **(new)** "Save allergies" or "Confirm NKDA" writes the patient's allergy status. Test patient only.
- [SAFE] "Let the patient choose" box with the checkbox "Send the patient a plan to choose from, instead of signing now". Tick it -> signature pad hides, "Option A" fieldset, "★ Required", "Add an option", button "Send to patient for choice". **Do not press it here** (section 8 does this on a safe patient). Untick it.
- [SAFE] An admin with no linked verified provider sees "Only the assigned provider can sign and send." and "Save as Draft: Provider Signs Later".
- [NEVER] "Confirm & Send" (charges, texts, sends to the pharmacy).
- [SAFE] "Start Over" on the session banner clears only the browser session. Do it now.

### 2.6 /protocols/new (protocol without a patient)
- [SAFE] Dashboard "+ New Protocol" -> "New protocol", "A protocol is a saved set of medications your clinic can load into any prescription. It is not tied to a patient." Fields "Protocol name", "Medication 1", "Search medications", "Formulation", "Pharmacy", "Dose", "Frequency", "Directions (sig)", "Default quantity", "Refills".
- [SAFE] "Save protocol" with nothing filled -> "Give the protocol a name and add at least one medication with its pharmacy."
- [WRITES DATA] Name it "QA click-through {date}", add one medication, "Save protocol" -> back on the dashboard with "Protocol saved: QA click-through {date}. It is in your Protocols list on New Prescription."; "Dismiss" removes the notice.
- [SAFE] /new-prescription/search "Protocols (N)" now lists it.

### 2.7 /refill
- [SAFE] Dashboard "Refill" -> "Refill"; either "No patient has a prescription to refill yet..." or a "Patient" select ("Select a patient…") and "Prescriptions to refill". "Refill N prescription(s)" only builds a session and opens Review (writes nothing). Then "Start Over".

### 2.8 /settings (`app/(clinic-app)/settings/`)
- [SAFE] -> "Clinic Settings"; section links "Stripe Connect" or "Payouts", "Clinic Profile", "Sign-in Security", "Team", "Patients", "Access log", "Integrations", "Notifications", "Agreements".
- [SAFE] **Demo payout label.** "Stripe Payout Account", "Payouts active", "Account: Demo payout account" (`lib/stripe/demo-account.ts`); must not: a raw `poc_placeholder...` or `acct_poc_...` id. If Sunrise instead shows a raw id or no "Payouts active", record it.
- [NEVER] "Start Onboarding" / "Continue Onboarding" (creates a real Stripe Express account).
- [SAFE] Clinic Profile: "Clinic Name" (read-only), "Default Markup %", "Absorb shipping costs", "Logo URL", "Show the practice dashboard to providers". "Save Settings" with no change -> "No changes to save." (nothing sent).
- [WRITES DATA] Tick "Show the practice dashboard to providers" -> "Save Settings" -> "Settings saved successfully." **Leave it on until 3.3, then turn it off again.**
- [SAFE] **Practice details**: "Practice details", "Your practice as it appears on prescriptions and payouts. We keep the last 4 digits of the tax ID only.", fields "Legal name", "DBA (optional)", "Address line 1", "City", "State", "ZIP code", "Phone", "Practice NPI (Type 2, optional)", "Tax ID (last 4 digits)" with "Only the last 4 digits. Never enter the whole number."
- [WRITES DATA] "Save practice details" with the values unchanged -> "Practice details saved." Do not change the values; they are the practice's prescription identity.
- [SAFE] Sign-in Security: "Two-step sign-in is on." or "Two-step sign-in is off." Do not enroll.
- [SAFE] **(changed)** Notifications card: "The texts CompoundIQ sends your patients (payment links, reminders, plan and intake links) and what your team sees in the app. CompoundIQ does not send email." -> "See what is sent".
- [SAFE] **(new)** /settings/notifications (`settings/notifications/page.tsx`, `lib/notifications/catalog.ts`):
  - "Notifications" and "Back to Settings".
  - A banner: "Texting is on: the texts below are sent." or "Texting is not set up yet, so no texts are sent today. Share payment, plan and intake links with your patients by copying them or showing their QR code." On prod expect the second.
  - "Texts to your patients": Payment link, Payment reminders, Payment confirmation, Treatment plan link, Intake link.
  - "For your clinic team": Plans ready to sign, Team invitations, A text that could not be delivered.
  - Columns "Notification", "When", "Who receives it", then "Not sent today".
  - Read-only: there are no switches.

### 2.9 /settings/team (invites, deactivate)
- [SAFE] "Manage the team" -> "Team", "Add providers, invite medical assistants and clinic admins, and turn off access for anyone who leaves..."; "Team members" with Name, Email, Role, Status; your row shows "You". "Pending invites" or "No invites are waiting." "Provider credentials" with NPI status.
- [WRITES DATA] "Invite a medical assistant or clinic admin" -> email `qa-ma+{date}@compoundiq.test`, role MA -> "Create invite" -> "Invite link ready", "...It works once, for 7 days. No email is sent from CompoundIQ.", "Copy link". No email goes out (`api/team/invites/route.ts`).
- [WRITES DATA] On that test invite only: "Resend" (new link, old dies), then "Revoke".
- [WRITES DATA] "Add a provider" -> fake name, NPI 1234567893, email `qa-provider+{date}@compoundiq.test` -> "Add provider" -> "Invite link ready". Runs a read-only NPI registry lookup. Note the name.
- [SAFE] "Deactivate" on that test provider -> "{name} will not be able to sign in or act in CompoundIQ. Their history is kept, and you can reactivate them later.", "Cancel".
- [WRITES DATA] Test provider only: "Yes, deactivate" -> Status "Deactivated"; then "Reactivate" -> "Active"; then deactivate again to leave it off.
- [NEVER] "Yes, deactivate" on Dr. Chen, the MA, the admin or any real person (ends their sessions, blocks sign-in).
- [NEVER] "Re-run NPI check" and "Save license" on Dr. Chen or any demo provider (demo NPIs are fake; a failed check can block signing).

### 2.10 /settings/patients
- [SAFE] /settings/patients/signup-link -> "Patient sign-up link", QR code, "Sign-up link", "On. Made {date}. Used N times." (or "Your clinic does not have a sign-up link yet."). "Copy link" -> "Link copied." "Print" -> a sheet "Scan to sign up as a new patient".
- [SAFE] "Make a new link" -> "The current link and any printed QR codes will stop working..." -> press "Cancel".
- [NEVER] "Yes, make a new link" and "Turn off" (would break the clinic's printed QR codes).
- [WRITES DATA] "Create a sign-up link" only if none exists.
- [SAFE] /settings/patients/import -> "Import patients", "Choose a file", "Match the columns", "Review before importing", "Import complete", "A .csv file up to 4 MB and 5,000 patients, with a header row."
- [SAFE] **4 MB limit**: choose a 5 MB .csv -> "The file is larger than 4 MB. Split it into smaller files." (client-side, nothing sent). Press upload with no file -> "Choose a .csv file to upload."
- [WRITES DATA] Do not press "Import N patients" on prod.

### 2.11 Agreements, integrations, access log
- [SAFE] /settings/agreements -> "Agreements", the version table, "View text" -> "{title}, version {v}", "Back to Agreements".
- [NEVER] Typing a name and pressing "Accept the {title} {version}" (a binding acceptance for the real practice).
- [SAFE] /settings/integrations -> "EHR sync", "Connection", "Sync log" ("No events yet."). "Rotate secret" / "Disconnect" -> confirmation -> "Cancel".
- [NEVER] "Rotate now" / "Disconnect now" on a live connection. [WRITES DATA] "Generate secret": skip.
- [SAFE] /settings/access-log -> "Access log", "... Read-only; entries cannot be edited or removed.", filters "Patient", "From", "To", "Filter". "Who" shows a person's name or "Unknown user"; must not: an email shown as the name. (Opening the page logs its own view; that is expected.)

---

## 3. Provider: dr.chen@sunrise-clinic.com (10 min)

- [SAFE] 3.1 Sign in -> /dashboard. Sidebar role "Provider". "Practice" shows now (the admin turned sharing on in 2.8).
- [SAFE] 3.2 Toggle "My patients" / "All clinic orders" -> URL gains `?view=clinic`; table and KPI cards change together.
- [SAFE] 3.3 Sidebar "Practice" -> "Practice Dashboard". **Then as the admin, untick "Show the practice dashboard to providers" and save.** Reload as the provider -> "Practice" gone; /practice typed in -> "Access Denied", "Your clinic admin hasn't shared the practice dashboard with providers.", "Back to dashboard".
- [SAFE] 3.4 Drafts tab: own drafts show "Sign all (N)" / "Sign selected (N)". Opening the sign page is SAFE; [NEVER] "Sign & Send N Prescription(s)".
- [SAFE] 3.5 /new-prescription -> step 1 "Patient" (no provider list), "Prescribing as {first} {last}. Select the patient to begin."
- [SAFE] 3.6 /new-prescription/sign with nothing selected -> "Review & Sign Prescriptions" with "No prescriptions selected" and "Back to dashboard".
- [SAFE] **(new)** 3.6a The sign page with selected drafts at two pharmacies (if any exist) -> "2 pharmacies → 2 shipping charges ($X)." under the patient, with no re-route.
- [NEVER] **(new)** "Save allergies" in the sign page's allergy prompt (rule 8).
- [SAFE] **(new)** 3.6b A draft missing part of its record (old data only) is refused at signing: "{medication} is missing part of its prescription record (...), so it cannot be signed. Remove it and prescribe it again." Do not try to create one.
- [SAFE] 3.7 /settings -> no "Patients", "Access log" or "Integrations"; "Only the clinic admin can change these settings." and "Only the clinic admin can change these."; Team link "View my credentials"; "Only the clinic admin can set up the payout account."
- [SAFE] 3.8 /settings/patients/signup-link -> "Only the clinic admin or a medical assistant can see the patient sign-up link." /settings/integrations -> "Only the clinic admin can manage integrations." /settings/access-log -> "Only the clinic admin can view the access log."
- [SAFE] 3.9 /settings/team -> "Your clinic's team. Your clinic admin manages who is on it."; must not: any "Deactivate" or actions column.
- [SAFE] 3.10 /ops/pipeline typed in -> /unauthorized.

---

## 4. Medical assistant: ma@sunrise-clinic.com (8 min)

- [SAFE] 4.1 Sign in -> /dashboard. Sidebar "Dashboard", "New Prescription", "Settings", role "MA"; must not: "Practice".
- [SAFE] 4.2 /practice typed in -> /unauthorized. /new-prescription/sign typed in -> /unauthorized.
- [SAFE] 4.3 Dashboard: no view toggle, no "Sign all", no plan Send/Cancel buttons.
- [SAFE] 4.4 Open a DRAFT order (if any) -> "Awaiting Provider Signature"; "Review & Sign This Prescription" leads to /unauthorized (expected).
- [SAFE] 4.5 New-prescription Review (session only): no signature pad; "Only the assigned provider can sign and send."; with the plan box ticked, the button reads "Save the plan for the provider to send" (sends nothing; saving it is WRITES DATA, skip unless in section 8).
- [SAFE] 4.6 /settings -> "Patients" present; Team link "View the team"; /settings/patients/signup-link read-only with "Only the clinic admin can turn this link off or make a new one."; /settings/patients/import opens.
- [SAFE] 4.7 /settings/integrations and /settings/access-log -> the "Only the clinic admin ..." notices.

---

## 5. Ops admin: ops@compoundiq-poc.com (20 min)

### 5.1 Shell
- [SAFE] Sign in -> /ops/pipeline. Header "CompoundIQ Ops", "Sign out". Tabs "Pipeline", "SLA", "Adapters", "Fax Queue", "Catalog", "Licensure", "Ingredients", "Clinic onboarding", "Pharmacy onboarding", "EHR sync", "Payables", and "Demo Tools" only if NEXT_PUBLIC_SHOW_DEMO_TOOLS is on (`ops/_components/ops-nav.tsx`).
- [SAFE] Onboarding tabs show a number badge only when self sign-ups are waiting; must not: a "0" badge.
- [SAFE] /dashboard typed in -> /unauthorized.
- [SAFE] **(new)** /ops/no-such-page -> "Page not found" with "Back to ops dashboard".

### 5.2 Pipeline filters (tier, chips, URL)
- [SAFE] Stuck refunds panel -> "No stuck refunds." (or a count with instructions).
- [SAFE] Sidebar "Pipeline" with groups "Payment", "Submission", "Pharmacy", "Shipping", "Errors / Terminal". Click the "Submission Failed" row -> DEMO-1011 listed; chip "Submission Failed"; URL `statuses=SUBMISSION_FAILED`.
- [SAFE] Tier "T4 Fax" -> DEMO-1001, 1002, 1008 (plus non-demo rows); chip "T4 Fax"; URL `tier=TIER_4_FAX`. "T1 API" -> 1004, 1005, 1007, 1009, 1011, 1015. "T2 Portal" -> 1003, 1006, 1010, 1014.
- [SAFE] The dropdown has no "T3 Hybrid" option (known gap). Type `?tier=TIER_3_HYBRID` -> chip "T3 Hybrid", DEMO-1013 (and DEMO-1012).
- [SAFE] Clinic "All Clinics" -> Blue Cedar -> DEMO-1012 only.
- [SAFE] "From date" = the 1st of this month -> chip "From YYYY-MM-DD"; DEMO-1013..1015 present.
- [SAFE] Reload with filters in the URL -> same filters and chips. Chip "x" ("Remove {label} filter") removes one; "Clear all filters" clears all; counter "{n} of {m} orders".
- [SAFE] Impossible filter -> "No orders match the current filters", "Clear filters".
- [SAFE] Bad URL value (`?tier=NOPE`) -> silently ignored.

### 5.3 Pipeline drawer and row actions on DEMO-1011
- [SAFE] Click DEMO-1011 -> drawer "{clinic} · Express Digital Rx", tabs "Detail", "History", "Submissions", "SLA".
  - Detail: Status "SUBMISSION_FAILED", "Reroute Count" "0 / 2", Tier "TIER_1_API".
  - History: DRAFT → AWAITING_PAYMENT → PAID_PROCESSING → SUBMISSION_PENDING → SUBMISSION_FAILED, "by CompoundIQ (automatic)".
  - Submissions: "FAILED", "Attempt #3", "[PHARMACY_API_UNAVAILABLE] Express Digital Rx API returned 503 Service Unavailable on 3 attempts. No fax fallback is configured for this pharmacy."
  - SLA: "No SLA deadlines."
- [SAFE] `/ops/pipeline?order=<DEMO-1011 uuid>` (copy the uuid from the drawer URL or network tab) -> drawer opens on load.
- [WRITES DATA] "Claim" on DEMO-1011 -> Assigned shows "ops"; then "Release". Reversible.
- [NEVER] "Retry" (resubmits to the pharmacy), "Force Fax" / "Retry Fax" and their bulk "... All" (send real faxes), "Cancel" (can issue a live Stripe refund).
- [WRITES DATA, skip] "Reroute" (adds to the reroute count; nothing resets it, so the DEMO-1011 demo beat is lost).

### 5.4 SLA and adapters
- [SAFE] /ops/sla -> "SLA Heatmap"; filter buttons "All Active", "Breached", "T1 API", "T2 Portal", "T3 Hybrid", "T4 Fax", "Cascade Active", "Adapter Health", "Submission Failed"; empty -> "No SLA deadlines match this view" / "All SLAs are on track or resolved".
- [SAFE] "Show Shift Handoff Report" -> "Shift Handoff Report", "Adapter metrics cover the last 8 hours.", "Submission Failures" at least 1.
- [WRITES DATA, skip] "Acknowledge" (no demo SLA rows).
- [SAFE] /ops/adapters -> "Adapter Health Monitor", "{n} pharmacies", Tier, Status and Circuit Breaker filters; cards "Success Rate (24h)", "24h Total", "Failures".
- [NEVER] "Disable Adapter", "Force Tier 4" (change live routing; Force Tier 4 has no undo). "Close Circuit": skip.

### 5.5 Fax queue, catalog, licensure, ingredients, EHR
- [SAFE] /ops/fax -> "Inbound Fax Triage", status buttons "All", "Received", "Matched", "Unmatched", "Processed", "Archived".
- [WRITES DATA, audit row only] **(changed)** A row's "View" -> "Fax Details" -> "Open fax" (`fax-pdf-viewer.tsx`).
  - The PDF opens inside the page, fetched from Documo. This is a read; nothing is sent.
  - Each view writes one access-log row.
  - Seeded demo faxes have no real Documo copy: expect "This fax is no longer available."
  - Other messages: "Only ops admins can open faxes.", "Too many faxes opened in a short time. Wait a few minutes and try again."
- [NEVER] "Reject Order" (rejects the order and posts a real Slack alert). [WRITES DATA, seeded faxes only, optional] "Acknowledge Order", "Archive", "Manual match" (a bad id -> "Must be a valid UUID").
- [SAFE] /ops/catalog -> "Product Catalog", "Hierarchical catalog powering the prescription builder, read-only here", tabs "Catalog", "Versions", "Normalized", "API Sync".
- [NEVER] Any CSV upload (uploads on drop, no confirm), "Add Item", "Rollback", "Trigger Sync".
- [SAFE] /ops/licensure -> "Pharmacy licensure" with "Valid" / "Expired" / "Expires in N days".
- [SAFE] /ops/ingredients -> "Ingredients: compounding status", "Cannot be ordered: {n} of {m}". [NEVER] "Save review" (changes what clinics can order).
- [SAFE] /ops/integrations -> "EHR sync" table or "No clinic has connected an EHR yet."

### 5.6 Payables
- [SAFE] /ops/payables -> "Pharmacy payables", "...nothing here moves money."; per pharmacy "Owed", "Scheduled", "Paid"; lines for DEMO-1013 (Hybrid Labs), DEMO-1014 (Portal Plus), DEMO-1015 (Quick Rx) as "Owed".
- [SAFE] Set "From" / "To" -> "Download remittance CSV". With no range -> "Choose a date range to download the remittance CSV."
- [WRITES DATA, skip] "Mark paid" / "Mark scheduled" (no undo).

### 5.7 Demo tools
- [SAFE] /ops/demo-tools -> "Demo Tools", "Self-service utilities for keeping the POC demo environment healthy." (404 if POC_MODE is off). Redact screenshots.
- [NEVER] "Reset Credentials" (signs out every demo user, including you, and resets passwords).
- [WRITES DATA, only if demo data looks stale] "Refresh Demo Data" -> "Fax seed: refreshed (deleted N, inserted 4)". Touches only demo seed rows.

### 5.8 Clinic onboarding and the license check
- [SAFE] "Clinic onboarding" -> "Clinic onboarding", "...A clinic cannot sign or send orders until it is approved."; sections "Clinics in onboarding", "Approved clinics", "Clinic invites".
- [SAFE] Self sign-ups show "Signed up on their own" (and "Solo provider"), with "Signed up on their own. Confirm the email and phone with them before approving."
- [SAFE] **License check.** On a submitted clinic whose provider NPI is unverified: "{name}’s NPI was not found in the national registry. Check their license with the state board before approving." and the checkbox "I checked this provider’s license with the state board"; must not: "Approve {name}" enabled before it is ticked. **Do not tick and approve** a real clinic.
- [SAFE] "Review details for {name}" -> "Review: {name}", sections "Practice", "Providers", "Staff", "Agreements", "History"; Sunrise's history may show "Note: Demo payout account set on approval."
- [NEVER] "Approve {name}" on any real clinic (activates ordering; may set a demo payout account).
- [SAFE] **(new)** A sign-up whose NPI is already used at an approved clinic shows "{name}’s NPI is already registered to a provider at an approved clinic. Approve is refused until this is resolved with the provider.", and "Approve {name}" is disabled. A shared NPI also shows "NPI also claimed by N other pending sign-up(s)."
- [NEVER] **(new)** On an unapproved self sign-up's review page: "Delete this sign-up" -> "Yes, delete {clinic}". It is irreversible: logins, providers and licenses are removed. If opened, press "Keep it".
- [WRITES DATA, test clinic only] "Send {name} back" with an empty note -> "Write what the clinic needs to change."; skip the real send.
- [WRITES DATA, optional] "Invite a clinic" with a test email -> "Invite link for {email} (shown once; it works once and expires in 7 days)", "Copy link". Then "Revoke invite for {clinic}" on that test invite. Never press send in "Email this invite".

### 5.9 Pharmacy onboarding
- [SAFE] "Pharmacy onboarding" -> "Invites", "Applications"; "Review" -> application page with "Details", "How they receive orders", "State licenses", "Agreements", "Catalog", "History"; "Back to pharmacy onboarding".
- [SAFE] On a non-ready application, "Approve" is disabled with "Approve is available when every license is verified, ...".
- [NEVER] "Approve", "Load into catalog". [WRITES DATA, test only] "Verify" / "Reject" licenses, "Mark adapter configured", "Send back".

---

## 6. Pharmacy admin: pharmacy-admin@compoundiq-poc.com (7 min, only if the account exists)

- [SAFE] Sign in -> /pharmacy/onboarding (after /mfa/challenge). Header "CompoundIQ · Pharmacy", nav "Onboarding", "Agreements". "Set up your pharmacy", "Your progress is saved as you go. CompoundIQ reviews your licenses and details before your pharmacy is shown to prescribers."
- [SAFE] Steps "Pharmacy details", "Facility type", "State licenses", "How you receive orders", "Shipping", "BAA", "Terms of service", "Catalog", "Review and submit". Click through each step without saving.
- [SAFE] **(new)** "How you receive orders" shows "Hybrid" disabled with "Not available yet".
- [SAFE] **(new)** /pharmacy/no-such-page -> "Page not found" with "Back to pharmacy portal".
- [SAFE] **4 MB limit.** State licenses step -> "Upload the {ST} license document", hint "PDF, PNG or JPEG, up to 4 MB." -> choose a 5 MB dummy file -> "The file must be under 4 MB." (client-side, nothing uploaded). Only possible if a license row exists; do not add one just for this.
- [SAFE] Catalog step -> "Download the CSV template".
- [NEVER] "Accept and continue" on BAA / Terms (binding), "Submit for review", real credentials on "How you receive orders".
- [SAFE] /pharmacy/agreements -> "Agreements", "The agreements your pharmacy accepted, and the exact text of each." [NEVER] "Review and accept".
- [SAFE] /dashboard or /ops/pipeline typed in -> /unauthorized.

---

## 7. Patient token pages (10 min)

### 7.1 One safe test patient (do this once)
The only safe way to get intake, plan and checkout tokens without texting a real person:
1. [WRITES DATA] As the clinic admin, "+ New patient" with name "QA Clickthrough", DOB 1990-01-01, mobile **+1 512 555 0142** (fictional exchange). "Add patient" -> the intake panel says either "Texted to the patient's mobile..." or "Texting is not set up, so nothing was texted. Copy the link or email it to the patient." **Record which one; it tells you whether Twilio is live on prod.** "Copy link".
2. Open that intake link in a private window (7.2) and complete it with **texts unticked**, so `sms_opt_in` is false.

### 7.2 /intake/[token] (`app/intake/[token]/`)
- [SAFE] **(changed)** /intake/abc -> "This link is no longer active", "Links stop working after 72 hours or once your details are sent. If you need a new link or need to change something, please contact your clinic." The same page shows for expired, used and unknown links.
- [SAFE] Real link -> "Complete your details", "{Clinic} asked you to complete your details. It takes about 3 minutes.", "Step 1 of 5", "Before you start", "Privacy notice", "I have read the privacy notice."; Continue without ticking -> "Please confirm you have read the privacy notice."; must not: any patient data before you enter it.
- [SAFE] Leave **"I agree to receive text messages ..."** unticked. Steps "Your details" ("Scan my license" / "Type my details"), "Shipping address" (ZIP "123" -> "Enter a 5-digit ZIP code."), "Allergies and medications" ("No known drug allergies"), "Check and submit" with "Texts: No".
- [WRITES DATA] "Submit" -> "Thank you", "Your details were sent to {clinic}.", "Your clinic will send you a link to pay once your prescription is ready."
- [SAFE] **(changed)** Reopen the same link -> "This link is no longer active".

### 7.3 /checkout (Stripe is LIVE)
- [SAFE] **(changed)** /checkout/abc -> redirects to /checkout/expired: "This payment link is no longer active", "Payment links stop working after 72 hours or once they have been used. If you have already paid, there is nothing more to do. Otherwise, please contact your clinic for a new link." The tab title reads "Payment link".
- [SAFE] **(new)** /checkout opened directly -> "Please reopen your payment link", "For your security, please reopen the payment link from your text message."
- [SAFE] /checkout/success with no params -> "Payment Unsuccessful", "Your payment could not be completed. Please contact your clinic to try again."
- [SAFE] **(changed)** An old link on a paid, cancelled or expired order -> the same neutral expired page; the clinic name is no longer shown.
- Active checkout page: **no Sunrise order is in AWAITING_PAYMENT**, and making one needs a provider to sign (charges nothing, but creates a live payment and texts opted-in patients). Recommended: **skip the active page on prod**. If Sam wants it, sign one cheap order for the QA Clickthrough patient (opt-in false, so no text), then "Copy Payment Link" in the drawer ("Payment link copied · valid for 72 hours"), open it once, and check "Amount due", "HSA / FSA", the Stripe Payment Element, "Pay $X.XX", "256-bit TLS Encryption", "Powered by Stripe"; must not: patient name, medication or diagnosis on the page. **(new)** After it loads the address bar reads plain `/checkout`, with no token. Do not refresh (rule 9).
- [NEVER] Type in the card fields, press "Pay".

### 7.4 /join/[token] (sign-up link)
- [SAFE] /join/abc -> "This link is no longer active", "This link is no longer active. Contact your clinic."
- [SAFE] The Sunrise link from 2.10 -> "Sign up as a new patient", "{Clinic} uses this form to register new patients. It takes about 3 minutes.", step 1 has "Mobile number".
- [WRITES DATA, skip] "Submit" creates a real patient.

### 7.5 Invite pages
- [SAFE] /onboard/clinic/abc and /onboard/join/abc -> "This invite link is not valid", "Check that you copied the whole link, or ask for a new one.", "Go to sign in".
- [SAFE] The revoked test invite from 2.9 -> "This invite was withdrawn".
- [SAFE] /onboard/pharmacy/abc -> "This link is not valid", "Check that you opened the full link from your invitation, or ask CompoundIQ to send a new one."
- [WRITES DATA, skip] "Create account" on a live invite.

---

### 7.6 (new) Phone width, 390 px
- [SAFE] In a private window, set the browser to 390 × 844 (dev tools device mode). Open:
  - /plan/<a test link>;
  - /intake/abc and /join/<the Sunrise link>;
  - /checkout/expired;
  - an active checkout only if 7.3 was done (no refresh, no card).
- Expect:
  - no sideways scrolling;
  - long drug names wrap, while prices stay on one line;
  - "HSA / FSA" stays on one line;
  - checkboxes and links are easy to tap (44 px);
  - error pages are phone-sized "Something went wrong" with "Try again".
- Nothing is submitted.

## 8. Patient protocol choice, end to end (9 min)

Uses the QA Clickthrough patient (opt-in false, fictional number), so nothing is texted. Signing in 8.6 is optional and needs Sam's go-ahead.

- [SAFE] **(changed)** 8.1 /plan/abc -> "This link is no longer active", "Plan links stop working after 7 days, once your plan is settled, or after too many incorrect dates of birth. Please contact your clinic if you need a new link or have questions." The same page shows for expired, locked, signed and closed links.
- [WRITES DATA] 8.2 **Provider proposes.** As Dr. Chen, New Prescription -> QA Clickthrough -> add two medications -> Review -> tick "Send the patient a plan to choose from, instead of signing now". Name "Option A" and add "Option B" ("Add an option"); mark one line "★ Required". Press "Send to patient for choice" -> "The plan was sent for the patient to choose. Nothing is signed or charged until you sign what they choose." Region "Share the plan link", "Share this link with the patient. It works until {date}.", texting line "The patient has not agreed to texts, ..." (or "Texting is not set up, ..."); must not: "The link was also texted to the patient."
- [WRITES DATA] 8.3 **Copy link / QR.** "Copy link" -> "Link copied."; "Show QR code" -> QR appears; "Hide QR code". (Each logs one event row.) "Go to the dashboard" -> /dashboard?tab=proposed.
- [SAFE] 8.4 **Proposed tab** lists the plan. Open it -> "Patient choice", "Awaiting patient choice", lines "{option}, required" / "optional (the patient can untick it)". [NEVER on a real plan] "Cancel the plan"; here open it and press "Keep the plan".
- 8.5 **Patient chooses.** Open the copied link in a private window:
  - [SAFE] -> clinic logo only, "Your provider has a plan ready", "To keep your health information private, enter your date of birth to see it.", "Date of birth", "Continue"; must not: clinic name, medication or patient data before the DOB.
  - [WRITES DATA] Wrong DOB (1990-01-02) -> "That date of birth doesn't match. 4 tries left." Stop at one wrong try (five lock the link: "This link is locked").
  - [WRITES DATA] Right DOB (1990-01-01) -> "Choose your plan", one card per option, the required line "Included: your provider marked this as essential", "Estimate: final price confirmed when your provider approves.", "Choose this plan", "None of these / I want to talk to my clinic".
  - [SAFE] Untick an optional line -> total re-quotes.
  - [SAFE] "Choose this plan" -> "Confirm your choice", "Estimated total", "Confirm", "Back".
  - [WRITES DATA] "Confirm" -> "Sent to your provider for final approval", "Your clinic will send you a secure payment link, usually the same day.", "Change my choice". Reload -> "You chose {label}. You can change your choice until your provider approves it."
- [SAFE] 8.6 **Provider signs.** As Dr. Chen, the dashboard shows "Plans ready to sign" with "QA chose {Option} (n of m items)" and "Review and sign" -> /new-prescription/sign?proposal=... -> region "The patient's choice", "These are the prescriptions the patient chose. Signing sends them one payment link; the items they did not choose are cancelled, never signed.", "Chosen lines (N)"; must not: checkboxes, "Edit", "Remove" or "+ Add prescription".
  - [NEVER without Sam's go-ahead] "Sign & Send N Prescription(s)". It creates a live Stripe payment and sends the order toward the pharmacy (no text, as opt-in is false). After it, /plan/<token> shows the neutral "This link is no longer active" **(changed)**.
- 8.7 **Leave it clean.** If you did not sign: as Dr. Chen, open the plan in the Proposed tab -> "Cancel the plan" -> "Yes, cancel the plan" (this is the test plan, so allowed). /plan/<token> then shows "This link is no longer active" **(changed)**.
- **(new)** 8.8 The DOB lockout, on a throwaway plan only:
  - [WRITES DATA] Send a second plan to the test patient (never use a real patient's link for this).
  - Enter a wrong DOB five times -> "This link is locked" and "Too many incorrect dates of birth were entered. Please contact your clinic."
  - Reload -> "This link is no longer active".
  - Then cancel that plan ("Cancel the plan" -> "Yes, cancel the plan").

---

## 9. Afterwards

Record, for Sam:
- The texting line seen in 7.1 / 8.2 (is Twilio live on prod?).
- Whether the face-sheet fieldset showed (is the Anthropic key set on prod?).
- Whether Demo Tools and the pharmacy-admin account exist.
- Every row created: QA Clickthrough patient, QA protocol, test provider (left deactivated), revoked MA invite, cancelled test plan, any optional writes from 5.
- "Show the practice dashboard to providers" is back off.

## Known gaps found while writing this (from the code, not prod)

1. The pipeline tier dropdown has no "T3 Hybrid" option, though DEMO-1012 and DEMO-1013 are T3 Hybrid; the URL parameter works (`ops/pipeline/_components/pipeline-view.tsx`).
2. The adapters Status filter has no "Idle" option.
3. Demo orders have no SLA rows, so SLA views only show empty states.
4. The hidden "Ops Demo Data" orders have no order number and all show as "a6000000" in the pipeline.
5. POST /api/ops/catalog/sync/[pharmacyId] has no cross-site check, unlike the other ops write routes.
6. No Sunrise demo order is AWAITING_PAYMENT, so the active checkout page cannot be checked without signing a new order.
7. The intake link is texted on patient create even when the patient has not opted in (by design: opt-in is collected in intake), so "Add patient" is never safe with a real number.
8. /checkout/success?payment_intent=<unknown> says "Payment Received", which is misleading for an unknown id.
9. **(changed)** Three of the migration branches need their migration on prod, or the feature fails:
   - the fax viewer needs 20261024000003 for its access-log row (without it the PDF still shows, but no audit row is written);
   - signup-squatting needs 20261024000006, or provider inserts and Approve fail;
   - rate-limit-db needs 20261024000007.
10. **(new)** Quantity and its unit ("Quantity: 2 vials", "Quantity: 30 capsules") are on the pharmacy outputs and the fax PDF only, never on a clinic screen. On prod they can only be checked by submitting an order, which this checklist never does.
