# Cofounder review run sheet v3.0: source

Source content for the Word run sheet. A click-by-click demo script for a 45 to 60 minute walk-through with the cofounder on production.

**Assumes the merge queue has landed:** rx-quantity-shipping, rx-allergies-required, favorites-frequent, error-boundaries, token-pages-hardening, checkout-token-out-of-url, ops-fax-viewer-documo, signup-squatting, security-followups-2 (and settings-notifications if it lands; the branch was not on origin when this was written).

**Updated 2026-10-26: also assumes the security and privacy work has landed.**
- bundle-hipaa: in-app Help, password reset and change, failed sign-in alerts, the PHI access log, ops access review and emergency access.
- clinical-difference-saved: saved clinical difference statements.
- signed-order-freeze, which includes order-transmission-integrity: orders refused unless signed and unchanged, and clinical fields locked after signing.

Their steps are marked **(branch security)**.

- Labels come from main (2696ff2) plus those branches' code. A label marked **(branch)** exists only once that branch merges.
- Before the call, check every step that depends on a branch on prod.
- Companion docs: `docs/qa/prod-clickthrough-checklist.md` (every button, SAFE / WRITES DATA / NEVER) and `docs/qa/practitioner-requirements-coverage.md` (what is built against what was asked).

## Rules for the whole call

**NEVER on production:**
- Typing in the card fields or pressing "Pay" on a checkout page (Stripe is live).
- "Reset Credentials" on /ops/demo-tools (signs everyone out, including you).
- "Re-run NPI check" or "Save license" on Dr. Chen or any demo provider.
- "Approve" on any real clinic or pharmacy.
- "Start Onboarding" in Settings (creates a real Stripe account).
- Anything that texts, faxes or emails a real person:
  - "Add patient" with a real number;
  - "Resend link";
  - "Send to patient for choice" for an opted-in patient;
  - "Confirm & Send" or "Sign & Send" for anyone but the run-sheet test patient;
  - ops "Retry", "Force Fax", "Retry Fax", "Reject Order".
- **(branch rx-allergies-required)** On the sign page, "Save allergies" inside the "Record allergies or mark NKDA before signing" prompt signs and sends straight away. Only save there for the test patient, and only if you mean to sign.
- "Yes, delete <clinic>" on a clinic review page **(branch signup-squatting)**. It is irreversible.
- **(branch security)** "Send reset link" on the forgot-password page with a real person's address. It emails them a live reset link. Show the page only.
- **(branch security)** "Open order" with "Emergency access (break-glass): urgent patient safety" chosen. It alerts the security team at once and starts a 24-hour review.
- **(branch security)** Mistyping the ops password. Any failed sign-in on the ops account alerts the team. Use the password manager and paste it.

**Two rules for patient pages:**
- **Do not refresh a checkout tab (branch checkout-token-out-of-url).** The address bar becomes plain `/checkout` and a refresh shows "Please reopen your payment link". Reopen the copied link instead.
- Opening an active checkout link creates a live Stripe payment record (nothing is charged). Open it once.

## 1. Before the call (15 minutes, the day before or one hour ahead)

**Accounts.** Passwords are in the password manager, not here. **(branch security)** The server reads them from the POC_*_PASSWORD settings. After the planned rotation, take the new ones from whoever set them.

| Window | Account | Lands on |
|---|---|---|
| A: normal browser | Clinic admin, admin@sunrise-clinic.com (Sunrise Functional Medicine) | /practice |
| B: second browser profile | Provider, dr.chen@sunrise-clinic.com | /dashboard |
| C: third profile | Ops admin, ops@compoundiq-poc.com (two-step code ready) | /ops/pipeline |
| D: private window | Patient pages (no login) | |

**Tabs to open:**
- In A: /practice, /settings/team, /settings/patients/signup-link, /help **(branch security)**.
- In B: /dashboard.
- In C: /ops/pipeline, /ops/onboarding, /ops/fax, /ops/access-review and /ops/security **(branch security)**.

**Demo data to check (window C, /ops/pipeline):**

| Order | Patient | Pharmacy (tier) | Status | Use it for |
|---|---|---|---|---|
| DEMO-1011 | Noah Kim | Express Digital Rx (T1 API) | SUBMISSION_FAILED | failure reason (clinic drawer), ops triage |
| DEMO-1013, 1014, 1015 | Ethan Brooks, Grace O'Connor, Liam Carter | Hybrid Labs, Portal Plus, Quick Rx | shipped / paid this month | Practice dashboard, payables |
| DEMO-1001 to 1010 | Sunrise demo patients | Strive (T4 Fax), Quick Rx, Express Digital, Portal Plus | delivered to paid | Status timeline, tier filters |

- If they look stale, use "Refresh Demo Data" on /ops/demo-tools (WRITES DATA, demo rows only). Never "Reset Credentials".
- Every seeded patient has a fictional 555-01xx number and texts opted in, so seeded patients are never used for anything that sends.

**Prepare the run-sheet test patient (WRITES DATA, once):**
1. Window B, "+ New Prescription", then "+ New patient":
   - first name "Demo", last name "Runsheet";
   - "Mobile number" +1 512 555 0142 (fictional);
   - "Add patient".
2. The panel says either "Texted to the patient's mobile..." or "Texting is not set up, so nothing was texted...". Note which: it tells you whether texting is live on prod. Press "Copy link".
3. Window D: open the link and complete "Complete your details":
   - DOB 1990-01-01, any address;
   - "No known drug allergies";
   - **leave "I agree to receive text messages..." unticked**;
   - "Submit". Expect "Thank you".

   The test patient now has intake done, NKDA recorded and texts off.
4. Have a one-row CSV ready (`First name,Last name,Date of birth` with a fake person) for the import step. Keep a second copy over 4 MB if you want to show the size check.
5. Close the session ("Start Over").

## 2. The story (about 50 minutes)

### 2.1 Clinic admin lands on Practice (3 min), window A
- **Click:** sign in.
- **Point at:** the page opens on "Practice Dashboard", not the order list.
- **Click:** "Month to date". Cards "Scripts", "Patient revenue (collected)", "Clinic payout", "Avg margin" (DEMO-1013 to 1015 count here). Then the tabs "By provider", "By pharmacy", "By medication"; "Needs attention".
- **Point at:** "CompoundIQ's monthly fee is billed separately and is not taken from orders."
- **Why it matters:** the owner sees scripts, collected revenue and payout without exporting anything.
- **Optional (branch error-boundaries):** type /settings/no-such-page. Expect "Page not found" with "Back to dashboard", not a raw 404.

### 2.2 Team and invites (5 min), window A, /settings/team
- **Point at:** "Team members" (Name, Email, Role, Status), "Provider credentials" with the NPI status and state licenses.
- **Click (WRITES DATA):** "Invite a medical assistant or clinic admin", email `demo-ma@compoundiq.test`, role medical assistant, "Create invite". Expect "Invite link ready", "...It works once, for 7 days. No email is sent from CompoundIQ.", "Copy link".
- **Click:** "Revoke" on that invite (clean up).
- **Point at:** "Add a provider" with First name, Last name, Email, NPI and "State licenses". The NPI is checked against the national registry, and a provider with an unverified NPI or a missing license cannot sign.
- **NEVER:** "Re-run NPI check" or "Save license" on Dr. Chen; "Yes, deactivate" on a real person.
- **Why it matters:** the admin adds providers and staff without calling us, and nobody unverified can sign.

### 2.3 Adding patients (6 min)
**Intake link.** Show the test patient's link from setup in window D: the "Complete your details" steps on a phone-sized window. Do not submit again.
- **Point at:** "Scan my license" or "Type my details", the "Sex" choice, "Current medications (optional)", and the texts checkbox (opt-in).

**Sign-up link and QR,** window A, /settings/patients/signup-link.
- **Point at:** the QR code, "Copy link", "Print" (sheet "Scan to sign up as a new patient"), "On. Made {date}. Used N times."
- **NEVER:** "Turn off", "Yes, make a new link" (breaks printed QR codes). Do not submit the /join form.

**CSV import,** /settings/patients/import.
- **Point at:** "A .csv file up to 4 MB and 5,000 patients, with a header row."
- **Click:** "Choose a file" (the one-row file) → "Upload and check columns" → "Match the columns" → "Check rows". Expect "N ready, N need fixing, N possible duplicates, of N rows."
- Stop before "Import N patients", or import the one fake row (WRITES DATA).
- **Why it matters:** staff type almost nothing. The patient fills in their own details, a QR in the waiting room signs up walk-ins, and an existing list comes in as a CSV. Cerbo and Healthie column names are recognised.

### 2.4 The provider writes an Rx with every field the NP asked for (10 min), window B
- **Click:** "+ New Prescription" → the test patient → "Continue to Pharmacy Search".
- **Click:** search "Sema", pick Semaglutide, then the 5 mg/mL injectable.
  - Dose step: "Dose amount" 80, "Dose unit" units, "Frequency" Once weekly, "Duration" For 90 days.
  - **Point at** the sig preview: it states the dose with its mL and mg, computed from the concentration.
- **Point at the pharmacy cards:**
  - each shows the price with the suggested vials ("2 × 5 mL vials");
  - each shows its shipping **(branch rx-quantity-shipping)**, for example "+ $22.00 shipping (cold chain)";
  - the "Refills" select runs 0 to 12 **(branch)**.
- **Click:** a pharmacy with priced vials (Strive) → "Continue to Set Retail Price".
- **Point at:**
  - "Dispense" 9.6 mL, "Days supply" with "Override";
  - "Package: 2 × 5 mL vials (suggested for 90 days) · $570.00" and "Number of packages";
  - the line "Shipping (cold chain): $X, charged once for Strive Pharmacy...".
- **Click:** "Review & Send (1)". On the card, open "Rx details" and point at each field:
  - "Days supply", "Dispense: 9.6 mL (2 × 5 mL vials)", "Refills";
  - "Syringe option" (SubQ syringe kit), "Shipping" (Cold chain);
  - "Clinical difference (required)" ("Select a reason…"). Nothing is pre-selected, on purpose.
    - **(branch security) Saved statements (WRITES DATA, demo patient only):**
      1. Pick "Other (describe)" and type a statement, for example "Glycine added to help maintain muscle mass (demo)".
      2. Under "Save this statement for next time:", press **"Save for Demo Runsheet only"**, not "Save for the practice". There is no delete button in the app, so the statement stays with the test patient only.
      3. On the next Rx for this patient, it appears under "Saved statements" as a one-click choice.
  - "Diagnosis code" / "Diagnosis", "Special instructions (optional)".
- **Point at:** the fax and every pharmacy API now carry "Quantity: 2" with "Dispense: 9.6 mL (2 x 5 mL vials)" **(branch rx-quantity-shipping)**. Before, every order said quantity 1.
- **Allergies (branch rx-allergies-required):** the test patient shows NKDA, so signing is allowed. Explain: for a patient with nothing recorded, pressing Sign & Send shows "Record allergies or mark NKDA before signing", with "Confirm NKDA", "Record allergies" and "Save allergies". An Rx can no longer reach the pharmacy without allergies or NKDA.
- **Edit at Review:** "Edit" on the card → change the dose → "Save Changes and Back to Review". The card updates in place.
- **Save, do not send:** "Save as Draft: Provider Signs Later" if offered, or open the signature pad, then "Sign & Send Payment Link" → read the confirm text → **"Cancel"**.
- **Why it matters:** every field Gina listed is on the Rx the pharmacy receives, and the vial count and shipping are worked out for her.

### 2.5 Favorites and Frequently used (4 min), window B
- **Click:** "+ New Prescription" → the test patient → "Favorites (N)".
- **Point at:**
  - one card per drug with dose chips ("10 units (0.5 mg) weekly · 20 units ... · Custom"), grouped by category, A to Z;
  - the patient's own favorites first.
- **Point at (branch favorites-frequent):** "Frequently used (last 90 days)" with entries such as "... · Strive Pharmacy · used 4 times".
- **Click:** "Make favorite" on an entry. The dialog offers "The practice" or "Only for Demo Runsheet" and the doses (the used one ticked, the drug's other doses offered, "Add dose"). "Save favorite" writes a favorite (WRITES DATA, demo clinic), or "Cancel".
- **Click:** a dose chip. It opens the dose step with the dropdowns filled in, not a free-text box.
- **Why it matters:** common doses are one click and grouped under the drug, and the favorites list builds itself from what she actually prescribes.

### 2.6 Sign all (3 min), window B, /dashboard
- **Click:** the "Drafts" tab → "Sign all (N)" (or "Sign selected (N)") → "Review & Sign Prescriptions".
- **Point at:**
  - one signature pad for every draft;
  - per-pharmacy shipping lines;
  - the multi-pharmacy warning when the drafts span pharmacies **(branch rx-quantity-shipping)**: "2 pharmacies → 2 shipping charges ($X)."
- **Stop.** Do not press "Sign & Send N Prescriptions" unless every selected draft is the test patient's. It creates the payment, texts an opted-in patient and starts the pharmacy send.

### 2.7 Patient protocol choice, end to end (8 min), windows B and D
1. **Window B:** New Prescription → the test patient → add two medications → Review.
   - Tick "Send the patient a plan to choose from, instead of signing now".
   - Name "Option A", "Add an option" for "Option B", mark one line "★ Required".
   - "Send to patient for choice" (WRITES DATA; no text, since the test patient has texts off).
   - Expect "The plan was sent for the patient to choose. Nothing is signed or charged until you sign what they choose."
2. **Point at:** the region "Share the plan link". Press "Copy link", then "Show QR code".
   - Expect the texting line "The patient has not agreed to texts, ..." and never "The link was also texted to the patient."
3. **Window D:** open the link.
   - Expect "Your provider has a plan ready" with only the clinic logo, then "Date of birth" → 1990-01-01 → "Continue".
   - Expect "Choose your plan": the required line reads "Included: your provider marked this as essential". Untick an optional line and the total re-quotes.
   - "Choose this plan" → "Confirm". Expect "Sent to your provider for final approval".
4. **Window B:** /dashboard shows "Plans ready to sign" with "Demo chose Option ..." and "Review and sign".
   - Open it. Expect "The patient's choice", "...the items they did not choose are cancelled, never signed.", "Chosen lines (N)", and no Edit or Remove.
   - Show the "Proposed" tab.
5. **Sign or stop:**
   - Signing ("Sign & Send N Prescription(s)") is safe only for this test patient. It creates a live payment record and starts the pharmacy send to a demo pharmacy, with no text. Do it only if you want the checkout step live.
   - If you stop, cancel the plan afterwards: "Cancel the plan" → "Yes, cancel the plan".
- **Why it matters:** the patient picks from options on their phone after a date-of-birth check, and the provider signs only what was chosen.

### 2.8 Checkout page (3 min), window D
- **If 2.7 was signed:** window B, open that order's drawer → "Copy Payment Link" ("Payment link copied · valid for 72 hours"; no text is sent) → open it once in window D.
- **Point at:**
  - "Amount due", "HSA / FSA", the Stripe card form, "Pay $X";
  - "256-bit TLS Encryption", "Powered by Stripe";
  - no patient name, medication or diagnosis on the page;
  - the address bar now reads plain `/checkout` **(branch checkout-token-out-of-url)**.
- **NEVER:** type in the card fields or press "Pay". Do not refresh.
- **If not signed:** open /checkout/expired. Expect "This payment link is no longer active" and "Payment links stop working after 72 hours or once they have been used..." **(branch token-pages-hardening)**.
- **Why it matters:** the patient pays on a page that shows nothing about their health.

### 2.9 Order drawer and the failure reason (3 min), window A or B, /dashboard
- **Click:** the "Errors" tab → DEMO-1011.
- **Point at:** "Sending to Express Digital Rx failed: {plain reason}. CompoundIQ ops has been alerted and will re-route or retry." No error code, and no retry button for the clinic.
- **Click:** DEMO-1005 → "Status Timeline", "Financial Split", "Rx details".
- **Why it matters:** the clinic knows what happened in plain words, and ops owns the fix.

### 2.10 Ops (6 min), window C
**Pipeline, /ops/pipeline:**
- Click the "Submission Failed" row: DEMO-1011, chip "Submission Failed".
- Tier "T4 Fax": DEMO-1001, 1002, 1008.
- "From date" = the 1st: DEMO-1013 to 1015.
- Reload: the filters stay (they are in the URL). "Clear all filters".
- Click DEMO-1011.
  - **(branch security)** The drawer first asks "Why are you opening this order?". Choose "The order is stuck, failed or needs rerouting" → "Open order". The reason is logged, and the clinic sees it in its access log.
  - Then the tabs: "Detail", "History", "Submissions" ("[PHARMACY_API_UNAVAILABLE] Express Digital Rx API returned 503 Service Unavailable on 3 attempts...").
- **NEVER:** "Retry", "Force Fax", "Retry Fax", "Cancel" (refund). "Reroute" uses up DEMO-1011's demo state.

**Approval with the license check, /ops/onboarding:**
- Open a "Submitted for review" self sign-up.
- **Point at:**
  - "Signed up on their own. Confirm the email and phone with them before approving.";
  - for an unverified NPI, "...NPI was not found in the national registry. Check their license with the state board before approving." and the checkbox "I checked this provider's license with the state board". "Approve ..." stays disabled until it is ticked;
  - **(branch signup-squatting)** an NPI already used at an approved clinic shows a red notice, and Approve is refused.
- **NEVER:** "Approve" a real clinic; "Yes, delete <clinic>".

**Fax viewer, /ops/fax (branch ops-fax-viewer-documo):**
- Click a row's "View" → "Open fax". The PDF opens in the page, fetched from Documo; each view is recorded in the access log.
- Seeded demo faxes have no real Documo copy, so expect "This fax is no longer available." That is the honest state on demo data.

### 2.11 Pharmacy onboarding (3 min), window C
- **Click:** "Pharmacy onboarding" → "Applications" → "Review" on any application.
- **Point at:**
  - "Details", "How they receive orders", "State licenses" (each "Verify" / "Reject", "View {ST} license document");
  - "Agreements" (BAA, Terms of service), "Catalog";
  - Approve stays disabled until every license is verified, both agreements are accepted and, for API or portal pharmacies, the adapter is marked configured.
- **Also:** /get-started (window D) → "I run a compounding pharmacy". The self-serve form: "Pharmacies set up two-step verification the first time they sign in." Do not submit.
- **NEVER:** "Approve", "Load into catalog".
- **Why it matters:** a pharmacy can join on its own, and nothing reaches prescribers until its licenses and agreements are checked.

### 2.12 Security and privacy (5 min max), windows A and C **(branch security)**
1. **Window A, sidebar "Help":**
   - "Help" lists 9 short guides: "Add a patient", "Write and sign a prescription", "Favorites and Frequently used", "Send a treatment plan for the patient to choose", "Payment links", "Order status", "Team", "Settings", "Who to contact".
   - Open one; "All help topics" goes back.
2. **Window D, /forgot-password (view only):**
   - Point at "Reset your password", "Email address" and "Send reset link".
   - Explain: the answer is the same whether or not the email has an account, and the link works once, for 15 minutes.
   - **NEVER** press "Send reset link" with a real address.
3. **Window A, /settings, section "Account":**
   - Point at "Change password", with "Current password", "New password" and "Confirm new password".
   - Explain: the current password is checked, and every other device is signed out.
   - Do not change it: the demo password is shared.
4. **Window C, /ops/access-review:**
   - "Access review": who viewed, changed or exported patient data across every clinic.
   - Filters "From", "To", "Clinic", "Actor role", "Resource", "Action"; flags on unusual rows; "Flagged rows only".
   - Do not press "Export CSV" on the call: it is logged as an export.
5. **Window C, /ops/security:**
   - "Security": the failed sign-ins of the last 24 hours, and any alerts from the last 7 days.
   - Accounts appear as the start of a keyed hash, never the email.
6. **Window C, /ops/pipeline, the emergency reason:**
   - Click any order. Point at the reasons in "Why are you opening this order?".
   - Choose "Emergency access (break-glass): urgent patient safety". Show the warning "Emergency access is reviewed within 24 hours...".
   - Then press "Close detail". **NEVER** press "Open order" with that reason.
- **Why it matters:**
  - every look at patient data is recorded and reviewed;
  - passwords are the user's own;
  - break-ins are noticed;
  - emergency access is possible but always accounted for.

## 3. Expected questions and short answers

**Do we connect to the clinic's EHR?**
- Yes for patients, through Keragon: a live, inbound sync of patient demographics, one patient per event. Duplicates are flagged and never merged, and a patient's own answers are never overwritten. The clinic admin manages it at Settings → "EHR sync".
- Not yet: a bulk pull of an existing EHR's patients (the CSV import covers that today), writing anything back to the EHR, and a direct Cerbo connector.
- Open question for the pilots: which EHR do they use? That decides the first direct connector.

**Where are we on HIPAA?**
- **What is now protected:**
  - **Every look at patient data is recorded:** lists, single records, and every send to a pharmacy, fax or AI service. Clinics see their own in "Access log". CompoundIQ reviews all of it on an access review page, with unusual activity flagged.
  - **Staff must say why they open a clinic's order.** Emergency access exists, alerts the team, and is reviewed within a day.
  - **Passwords:**
    - people set and reset their own passwords;
    - a change asks for the current password and signs out other devices;
    - failed sign-ins are tracked, and repeated ones are slowed down and alerted;
    - the demo passwords are out of the code.
  - **Prescriptions:**
    - an order only reaches a pharmacy if it is signed and unchanged since signing;
    - its clinical details are locked once signed;
    - pharmacies are only reached at secure addresses.
  - **Still true from before:**
    - patient pages show no health details, and their links expire;
    - two-step sign-in is available to every staff member;
    - staff are logged out after 15 minutes idle.
- **What is still outstanding:**
  - **No BAAs are signed yet** with vendors or clinics. So the live site holds demo data only.
  - **Two-step sign-in for everyone.** It is one switch, recommended on from the first real clinic.
  - **A separate system for real patients.** The recommendation is a second copy of CompoundIQ for real data, with the demo left as it is, so a demo order can never reach a real pharmacy or patient. This is Sam's decision.
  - **Texting registration.** Texts need a signed agreement with the texting provider and US carrier registration. That takes weeks, so it should start now. No texts are sent until then.
  - **A few finishing items are being fixed now:**
    - logging texts to patients;
    - the database also checking two-step sign-in;
    - making the signature check impossible to imitate.

**How do pharmacies receive orders?**
By tier:
- **API (T1):** straight into the pharmacy system, with automatic status updates.
- **Portal (T2):** we fill the pharmacy's web portal.
- **Hybrid (T3):** not available yet.
- **Fax (T4):** a signed Rx PDF.

The Method column on the dashboard shows which. Sending is behind an on/off switch; on prod every pharmacy is a demo pharmacy.

**Payments?**
- Stripe is live: the patient pays on our checkout page and the clinic is paid through Stripe Connect.
- Sunrise and new demo clinics use a "Demo payout account", so no real payout is set up.
- CompoundIQ's monthly fee is billed separately, not taken from orders.

**What is not built yet?** (from the coverage audit, assuming the queue above has merged)
- The GLP-1 clinical difference opens on its own and nothing is pre-selected (a deliberate decision). Patient-specific statements can now be saved for the practice or one patient and picked with one click (finishing). Saved statements cannot yet be deleted in the app.
- Direct Cerbo connector; bulk import through Keragon; anything written back to the EHR.
- Staff still type the patient's mobile number on "+ New patient", unless a face sheet is read (the face sheet needs the AI key on prod).
- Settings → Notifications is a placeholder, unless settings-notifications lands.
- Ops cannot see whether pharmacy sending is on until an action is refused.
- The data model has no demo/real flag; demo data is told apart only by its demo payout ids and seed markers.
- The ops pipeline tier filter has no "T3 Hybrid" option (the URL works).
- Payouts are not live in clinic onboarding (demo payout on approval).

## 4. After the call
- Cancel any test plan that was not signed.
- Revoke any test invite.
- Note what was created: the test patient, a favorite, drafts, an imported row, and the saved clinical statement (for Demo Runsheet only; it cannot be deleted in the app yet).
- **(branch security)** Note any failed sign-in alerts that appeared on /ops/security during the call.
- Note what the texting line said (is Twilio live on prod?), and whether "Drop a face sheet" showed (is the AI key set?).
