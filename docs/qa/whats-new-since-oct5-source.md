# What's new since October 5: source

Source content for a short Word summary for the cofounder (Lauren Perkins). Written for a non-technical reader.

- **Coverage:** everything merged since the October 5 run-through (main at 2696ff2, 78 changes, 2026-10-05 to 10-25), checked in the code. It also covers the work still in the merge queue, marked **(finishing)**, including the security and privacy work finished on October 25 and 26.
- **Queue status:** the October 25 merge dry run found every queued item merges, with small fixes.
- **Accuracy:** "is" means it works in the product today. "(finishing)" means it is built and reviewed and waiting to be merged.

---

## Your questions from October 5, answered

**How do we add patients?** Four ways, and staff type very little.
- **Text a link.** Staff enter only the patient's mobile number. The patient gets a secure link and fills in their own details on their phone: name, date of birth, sex, address, allergies, current medications, and consent to texts. They can scan their driver's license instead of typing.
- **Sign-up QR code.** Each clinic has a sign-up link and a printable QR code. A new patient scans it in the waiting room and registers themselves.
- **Upload a list.** Upload a spreadsheet of existing patients. The common EHR export formats are recognised.
- **Face sheet.** Drop in a patient face sheet and the form fills itself (this needs the AI service switched on).

**How do we add providers?** In Settings, Team, the clinic admin adds a provider (name, email, NPI, state licenses) or invites a medical assistant or another admin. No email is sent: the admin copies a one-time link to them. Every provider's NPI is checked against the national registry. Nobody can sign a prescription without a verified NPI and a current license in the right state.

**How are new clinics and pharmacies added?** Two ways for each:
- **Self sign-up.** Anyone can sign up as a solo provider, a clinic or a pharmacy from the sign-in page ("Get started").
- **Invite.** CompoundIQ can invite them instead.

Either way they get a guided setup:
- **Clinics:** practice details, providers, staff, agreements.
- **Pharmacies:** licenses, how they receive orders, shipping, agreements, catalog.

Nothing can be ordered, signed or received until CompoundIQ reviews and approves them.

**Is the admin dashboard set up?** Yes. The clinic admin now lands on the Practice dashboard: scripts, revenue collected, clinic payout and margin by provider, pharmacy and medication, plus a "Needs attention" list. Settings holds the practice details, team, patients, the access log, the EHR connection and the agreements.

**Do we connect to an EHR?** Partly.
- **What works:** patients flow in automatically and live from the clinic's EHR through Keragon, one patient at a time as they are added or changed there.
- **Not yet:** pulling in a whole existing patient list through Keragon (the spreadsheet upload covers that today), sending anything back into the EHR, and a direct connection to Cerbo.
- **Open question:** which EHR do the pilot clinics use?

**Are orders sent to pharmacies?** Yes, behind an on/off switch.
- Each paid order goes to its pharmacy exactly once, by that pharmacy's method: straight into its system, its web portal, or a faxed signed prescription.
- On the live site every pharmacy is a demo pharmacy.

---

## Adding patients
- **Add a patient by mobile number.** The patient completes their own details by secure link, including consent to texts, sex and current medications. A license scan is optional.
- **Prescribe now, hold the order.** A provider can write the prescription before the patient finishes. It is held as a draft and cannot be signed or paid until the patient's details are in.
- **Clinic sign-up link and QR code** for walk-in patients, with a printable sheet.
- **Spreadsheet upload** of existing patients, with column matching, a check before anything is saved, and a 4 MB limit.
- **Face sheet fill:** drop in a face sheet and the new-patient form fills in. It only appears when the AI service is switched on.
- **Possible duplicates** are flagged for staff to confirm, never merged automatically.
- **Patient pages work well on phones** (finishing): bigger tap areas, long drug names that wrap, and a clear "Something went wrong, Try again" page.

## Team and onboarding
- **Settings, Team:** add providers, invite medical assistants and admins, and turn off access for anyone who leaves. Their history is kept, and they can be reactivated.
- **Prescriber checks:**
  - NPI registry check and state licenses for every provider.
  - CompoundIQ must confirm the license with the state board before approving a provider whose NPI is not in the registry.
  - Expiring licenses are flagged.
- **Self sign-up** for solo providers, clinics and pharmacies, with CompoundIQ approval before anything can be ordered.
- **Protection against impersonation** (finishing): a sign-up using an NPI that already belongs to an approved clinic cannot be approved. CompoundIQ can delete a fake sign-up, and repeated sign-up attempts from one place are slowed down.
- **Clinic onboarding:** a guided setup that saves as you go, then BAA and terms acceptance, then CompoundIQ review.
  - Each clinic gets a demo payout account on approval until real payouts are set up.
  - A banner tells the clinic it is under review, and when it has been submitted.
- **Pharmacy onboarding:** a guided setup with license documents, ordering method, shipping, BAA, terms and catalog upload. Pharmacy admins always use two-step sign-in.
- **Setup checklist and tips:** each role sees a short "Get set up" checklist. A provider sees tips on their first prescription.
- **Agreements:** clinics and pharmacies can read the exact text they accepted, and accept new versions. Public Privacy Policy and Patient Terms pages are live.

## Writing prescriptions
Gina's list, all on the prescription the pharmacy receives:
- **Days supply.**
- **Quantity with the real vial count** (finishing). The number of vials is worked out for the dose and duration. Each vial size is priced, and several vials of one size are suggested when one is not enough.
- **Refills,** 0 to 12 everywhere (finishing).
- **Clinical difference statement** for GLP-1s, required and opened automatically.
- **Syringes,** or none.
- **Shipping type:** standard or cold chain (GLP-1s default to cold chain).
- **Allergies or "no known allergies,"** now required before signing (finishing).
- **Diagnosis.**
- **Special instructions.**

Building and signing:
- **Shipping costs** are shown with the medication price and at review. Each pharmacy card shows the shipping it adds (finishing).
- **Two-pharmacy warning:** splitting one patient across two pharmacies shows a warning that shipping is charged twice. Review offers to move everything to one pharmacy when that is cheaper. The warning also shows on the price page and when signing saved drafts (finishing).
- **Edit at Review:** a line can be changed in place. Saved drafts can be edited and have prescriptions added.
- **Sign all:** sign every draft for a patient with one signature.
- **Protocols** can be created on their own, without a patient, and loaded into any prescription.
- **Favorites:**
  - one card per drug with its common doses as one-click choices that open the dose step filled in;
  - sorted by category and A to Z;
  - can be saved for the practice or for one patient.
- **Frequently used** (finishing): the doses a provider orders most in the last 90 days, with how many times each was used and a one-click "Make favorite" that asks practice or this patient and which doses.
- **Compliance built in:**
  - controlled substances cannot be prescribed here (use EPCS);
  - ingredients the FDA does not allow for compounding are blocked;
  - ingredients still pending FDA review can be ordered, with a warning;
  - orders only go to a pharmacy licensed in the patient's state, with sterile coverage for injectables;
  - the order status rules are checked strictly (finishing), so a draft missing part of its record cannot be signed.

## Patient choice of protocol
- **Options:** the provider proposes one or more options (for example Option A and Option B), marks which items are required, and sends the plan.
- **Sharing:** the patient gets a link by text when texting is on. Otherwise staff copy the link or show a QR code.
- **The patient's side:** the patient confirms their date of birth (five wrong tries lock the link), sees the options with estimated prices, can untick optional items, and chooses.
- **Signing:** the provider sees "Plans ready to sign" and signs only what the patient chose. Everything not chosen is cancelled, never signed.
- **Links:** they expire after 7 days. A closed or expired link shows one neutral page and reveals nothing (finishing).

## Payments and checkout
- **Stripe is live.** The patient pays on a CompoundIQ checkout page that shows the amount but no name, medication or diagnosis.
  - HSA and FSA cards work like any card.
  - Several prescriptions can be combined into one payment link.
- **Fee:** CompoundIQ takes no percentage of orders. Its fee is a flat monthly fee billed separately. The pharmacy is paid wholesale plus shipping, and the clinic keeps the rest.
- **Ledger:** every paid order's split (patient charge, clinic share, pharmacy owed) is recorded. A daily check compares Stripe against it and alerts CompoundIQ to any mismatch.
- **Payment links:** they expire after 72 hours. A paid, cancelled or expired link now shows one neutral "no longer active" page (finishing).
- **Card page safety** (finishing): the payment page removes the link's secret from the address bar as soon as it opens. If refreshed, it asks the patient to reopen the link from their text.
- **Payouts:** demo clinics show a "Demo payout account"; real clinic payouts are not live.

## Pharmacy delivery
How pharmacies receive orders, by tier:
- **API:** straight into the pharmacy's system, with automatic status updates.
- **Portal:** CompoundIQ fills in the pharmacy's web portal.
- **Fax:** a signed prescription PDF.
- **Hybrid:** shown as "Not available yet" in pharmacy setup (finishing).

What the pharmacy receives:
- **Quantity now means one thing** (finishing).
  - Capsules, tablets, troches and similar: the number of units dispensed (two bottles of 30 capsules is 60 capsules).
  - Injectables, creams and liquids: the number of containers (two 5 mL vials is 2 vials).
  - The unit is always sent with the number, and the fax reads "Quantity: 2 vials". Before, every order said quantity 1.
- **When sending fails:** the clinic sees a plain reason on the order (for example "the pharmacy's system did not respond"). CompoundIQ is alerted to re-route or retry.
- **Sending is behind an on/off switch,** and nothing is sent to a pharmacy unless it is on.

## Ops tools (CompoundIQ staff)
- **Pipeline filters:**
  - filter by status, clinic, pharmacy, tier and date;
  - each filter shows as a removable chip;
  - filters stay in the page address, so a view can be shared or reloaded.
- **Approvals:**
  - review of self sign-ups ("Signed up on their own");
  - a required state-board license check for an unverified NPI;
  - impersonation warnings (finishing).
- **Fax viewer** (finishing): ops open an inbound fax in the page. Every view is recorded.
- **Pharmacy payables:** what is owed to each pharmacy, marked scheduled or paid, with a remittance download. Money itself is paid outside the app.
- **Also:** a licensure matrix, ingredient compounding status, EHR connection status, SLA tracking and demo-data tools.

## Security and compliance
**What is protected**
- **Access log:** every view or change of a patient record is logged (who, role, what, when). Clinic admins can see it in Settings.
- **Sign-in:** two-step sign-in with an authenticator app is available for all staff and required for pharmacy admins. It can be required for everyone with one switch.
- **Automatic logoff:** staff are signed out after 15 minutes idle, with a warning first.
- **Stripe:** Stripe never receives patient or drug details, only an order reference.
- **Alerts and error reports:** Slack alerts and error reports are scrubbed of patient details.
- **Texts:** patients can reply STOP, START or HELP, and every text checks consent first.
- **Strict page security:** no trackers or analytics. Patient links expire, and they are kept out of search engines and are not passed on to other websites (finishing).
- **Each clinic sees only its own data,** and that is enforced in the database. Writing through the database directly is locked down further (finishing).
- **Abuse limits:** every form and API checks its input, and sign-up and link pages are rate limited (finishing).
- **Friendlier errors:** clear "Something went wrong" and "Page not found" pages replace raw errors (finishing).

## Security and privacy hardening (finishing)
A security review against the HIPAA technical rules found gaps. Most are now fixed and waiting to be merged.

**Passwords and sign-in**
- **Forgot password and change password.**
  - "Forgot password?" on the sign-in page emails a one-time link to set a new password. The answer is the same whether or not the email has an account, so it reveals nothing.
  - Signed-in staff change their password in Settings, Account. They must enter their current one, and every other device is then signed out.
  - A reset link only works for 15 minutes after it is opened.
- **No admin-chosen passwords.** Adding a provider no longer sets a password for them. The provider gets an invite and chooses their own. The same password rules now apply everywhere a password is set.
- **Failed sign-in alerts.**
  - Every failed sign-in and wrong two-step code is recorded.
  - CompoundIQ is alerted on any of these:
    - 5 failures on one account in 15 minutes;
    - 20 failures from one network;
    - any failure on a CompoundIQ or pharmacy admin account.
  - After repeated failures, sign-in pauses for a few minutes. Nobody is locked out for good.
  - CompoundIQ staff see the alerts on a Security page.
- **Combined payment links need two-step sign-in.** Combining prescriptions into one payment link could be done without finishing two-step sign-in where it is required; now it follows the same two-step rule as every other staff action.
- **Demo passwords are out of the code and the documents.** Each demo account's password is now set privately on the server. The four demo accounts will get new passwords after the cofounder demo, because the old ones were visible in the project's history.

**Patient data**
- **Every view of patient data is logged.** That covers lists and single records, every send to a pharmacy, fax, the AI services, and patient link pages.
  - Who looked, their role, what and when are recorded, without copying the patient data itself.
  - If a send to a pharmacy cannot be recorded, it does not go out.
- **Access review.** CompoundIQ staff have an access review page that shows who viewed, changed or exported patient data across every clinic. Unusual activity is flagged, and the review can be exported.
- **Emergency access.**
  - When CompoundIQ staff open a clinic's order, they must say why. The reason is logged, and the clinic sees it in its access log.
  - "Emergency access" is reserved for urgent patient safety. It alerts the team at once and is reviewed within 24 hours, under a written procedure.

**Prescriptions**
- **Orders are refused unless signed and unchanged since signing.** Before any order goes to a pharmacy, it is checked: it must be signed, and its content must still match what the provider signed. Anything else is held back and CompoundIQ is alerted.
- **Clinical fields are locked after signing.** Once a prescription is signed, its dose, directions, quantity, days supply, refills, substitution, instructions, patient, provider and medication cannot be changed.
- **Pharmacy addresses must be secure.** Orders are only sent to pharmacy systems and portals at secure (https) addresses.

**Also**
- **Saved clinical difference statements.**
  - A statement typed for a GLP-1 can be saved for the practice, or for one patient, and picked with one click next time.
  - Nothing is pre-selected: the provider still chooses each time.
- **In-app Help.** A "Help" link in the sidebar opens short guides to the everyday tasks, with button names exactly as they appear:
  - adding a patient;
  - writing and signing;
  - favorites;
  - treatment plans;
  - payment links;
  - order status;
  - team;
  - settings;
  - who to contact.
- **Keyboard and screen-reader fixes.**
  - Prescriptions, favorites and the order details can be done with the keyboard alone.
  - Pop-up windows keep the keyboard inside them, close with Escape and return you to where you were.
  - Messages are read out by screen readers.
- **Faster, more reliable automated tests.** The checks that run before each release finish sooner and no longer fail at random on a busy computer.

## What is still outstanding
**Before any real patient data**
- **No BAAs are signed yet** with vendors or clinics. The BAA template is a draft pending legal review. So the live site holds **demo data only**.
  - Vendors that receive patient data and need a BAA: the database host, the web host, texting, fax, the two AI services, the EHR link and error reporting.
- **Real patients on a separate system.** The recommendation is a second, separate copy of CompoundIQ for real patients, with the demo left where it is. Then a demo order can never reach a real pharmacy or a demo text a real phone. Until then, every newly approved clinic gets a demo payout account.
- **Two-step sign-in for everyone.** It is one switch, recommended on for the real system from day one and left off for the demo.
- **Rotate the four demo passwords** after the demo.
- **Hosted security settings** that the code cannot set:
  - an idle and maximum session length on the server;
  - password strength and leaked-password checks;
  - backups with point-in-time restore, and a tested restore.

**Security work still open**
- **Two-step sign-in is checked by the app, but not yet by the database itself.** The database check is built and ready. It waits only on Sam's decision to require two-step sign-in for everyone, and is switched on together with that switch.
- **Prescription signature check.** It needs two more fixes before it can be relied on:
  - the check can still be imitated by someone who can edit an order directly;
  - some details the pharmacy receives are not yet covered: the patient's name and date of birth, the prescriber's details, and which pharmacy the order goes to.

  Closing direct database edits for clinic staff is built and waiting.
- **The patient-data log** has a few gaps being fixed now:
  - texts to patients are not yet logged as disclosures;
  - some changes are saved before their log entry, and should not be;
  - the dashboard's 30-second refresh writes too many log rows.
- **The two AI services.**
  - The face sheet reader is on by default. The plan is to make it opt-in.
  - The portal confirmation screenshots go to an AI vendor that has no BAA.
- **Error reporting** is very likely not running yet, and needs switching on.
- **Failed sign-in alerts** cover the app's own sign-in page. Attempts made straight against the sign-in service need a setting at the vendor.
- **The provider invite link** is still handed to the admin to pass on. Options for Sam:
  - email it straight to the provider (needs email set up);
  - force a password change at first sign-in;
  - keep trusting the admin.

**Product decisions (recommended)**
- **Texting:** start the texting BAA and US carrier registration now, because they take weeks. Switch texting on after them. No patient email at launch; texts only.
- **Notification preferences:** keep the read-only "See what is sent" page now. Add switches per clinic once texting is live.
- **Data retention:** keep counting only. Switch deletion on rule by rule once real data is separate.
- **Pharmacy home page:** not needed for launch, because pharmacies receive orders by fax, system or portal. Add a small page later.
- **Hybrid pharmacies:** leave them off, and stop offering "Hybrid" in pharmacy search.
- **Clinical difference:** do not pre-select a reason. Saved statements cover the repeat typing.
- **Order status:** do not require tracking numbers from pharmacies. Fix how portal pharmacies' status is read.
- **Deleting saved statements and favorites:** only the person who created one, or a clinic admin.
- **Help:** add a support email address to "Who to contact", one per environment.

## What is not built yet
- **Direct EHR connection to Cerbo** (or whichever EHR the pilots use). Today the EHR link is Keragon, inbound patients only.
- **Writing back into the EHR** (orders or notes), and **pulling a whole patient list through Keragon**.
- **The Hybrid pharmacy tier.**
- **A home page for pharmacies** after they are live. Today a pharmacy only sees setup and agreements.
- **Notification preferences.** A read-only "See what is sent" page is finishing: it lists every text patients receive and says whether texting is on. Clinics cannot yet turn individual notifications on or off, and nothing is emailed.
- **Clinical difference:** for GLP-1s the reason is required and is not pre-filled, by decision. Saving statements for reuse is finishing (see above).
- **Clinic payouts:** real payouts in clinic onboarding are not live (demo payouts for now).
- **Patient's mobile number:** staff still type it when adding a patient, unless a face sheet is read.
- **Demo versus real records:** the system cannot yet mark a clinic, pharmacy or patient as demo or real.

## Open questions (from October 5)
- Which EHR do the pilot clinics use? This decides the first direct connector.
- Weekly dosing for 90 days: 12 or 13 doses?
- Revenue model and markup (with healthcare counsel).
