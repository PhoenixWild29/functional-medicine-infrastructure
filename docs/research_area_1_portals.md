# Research Area 1: Compounding Pharmacy Ordering Portals — UX & Workflow Analysis

**Date:** April 7, 2026  
**Scope:** Prescriber-facing ordering portals for major U.S. compounding pharmacies — catalog structure, form design, titration handling, and UX patterns.

---

## Executive Summary

The compounding pharmacy ordering portal landscape is bifurcated between two dominant paradigms:

1. **Fixed-catalog / pre-configured SKU portals** (503B office-use ordering): Prescribers or clinic staff browse a defined product catalog with pre-set concentrations, volumes, and formulations. The order process resembles an e-commerce checkout. Empower Pharmacy's 503B portal and Olympia Pharmacy's DrScript-powered portal are the clearest examples.

2. **LifeFile-based prescription portals** (503A patient-specific ordering): Prescribers write individual patient prescriptions using a pharmacy-hosted web app. Medications are searchable within the pharmacy's catalog, and the prescriber sets quantity, sig (dosage instructions), refills, and day supply. LifeFile is the dominant platform powering this workflow, used by Empower Pharmacy (503A), Belmar Pharmacy, Strive Pharmacy, University Compounding Pharmacy, and others.

Titration schedules (e.g., Semaglutide 10-week escalation) are generally **not handled by the portal itself** — they are managed via free-text SIG/directions fields, or by issuing sequential prescriptions at different dose levels, or through the pharmacy's "multi-order" batch function.

---

## 1. DrScript / Olympia Pharmacy Network

### Platform Identity
DrScript is a proprietary portal software built by **503 Success LLC** (domain: `503success.com`), deployed under the subdomain `olympiapharmacy.drscriptportal.com`. It powers the prescriber ordering interface for Olympia Pharmaceuticals, a major 503B outsourcing facility based in Orlando, FL. The same platform is licensed to other 503 pharmacies.

### Portal Structure
- **Type:** Fixed-catalog / SKU-based (503B outsourcing facility model)
- **Access:** Prescribers must set up an account with Olympia; the portal is free for registered customers.
- The portal URL `olympiapharmacy.drscriptportal.com` currently shows "Ordering has been disabled" — reflecting the FDA enforcement action on compounded GLP-1s that began in early 2025. The portal infrastructure remains live. ([Olympia DrScript Portal](https://olympiapharmacy.drscriptportal.com/profile/loading))

### Medication Catalog
The Olympia medication directory at `olympiapharmacy.com/medication-directory` provides the publicly visible catalog structure: ([Olympia Medication Directory](https://www.olympiapharmacy.com/medication-directory/))

| Field | Description |
|---|---|
| Medication Name | Full compound name (e.g., "Biest (80/20) 0.25%") |
| Category | Therapeutic area tags (e.g., Hormones, Weight Management, IV Kits) |
| Route | IV, IM, Oral, Topical |
| Concentration | Per-mL specification (e.g., "Estradiol 0.5mg, Estriol 2mg") |
| Volume | Vial/container size (e.g., 30mL, "Other") |

Catalog filters include Category, Route, and Volume dropdowns. Each distinct SKU (concentration × volume combination) is a separate catalog entry. For example, Anastrozole exists as four separate line items: 0.25mg, 0.5mg, 0.75mg, and 1.5mg.

### Ordering Workflow
Based on 503 Success's description of its platform and Olympia's provider documentation:
1. **Log in** to portal (account required, set up via sales/marketing contact)
2. **Browse or search catalog** — filtered by Category, Route, or Volume; or search by medication name
3. **Select a SKU** — a specific pre-formulated concentration and container
4. **Enter patient/order details** — patient name, shipping destination (clinic or patient), quantity, billing profile (credit card on file)
5. **Review and submit** — preview order before submission
6. **Order management** — view order history, track shipments, check expiration dates ([IPC Partnership page](https://www.ipcrx.com/pharmacy-vendors/pharmacy-supplies/olympia-pharmaceuticals/))

### Key UX Characteristics
- **Catalog-based:** No customization of formulation — prescribers select from pre-defined SKUs.
- **Dropdown/selection-driven:** Medication type, concentration, and volume are chosen from list, not typed.
- **503B model means no individual patient Rx required** for office-use; orders go to clinic stock.
- **Favorites/templates:** Not publicly documented but typical of the 503 Success platform.
- **Titration handling:** Not handled in-portal. Providers order different vial strengths as needed for dose escalation; each is a separate SKU.

### Provider Resources
Olympia offers custom prescription forms for many medications and provides online walkthrough tutorials via screen-sharing for new accounts. ([Olympia Provider Resources](https://www.olympiapharmacy.com/providers/))

---

## 2. WellsPx3 / Wells Pharmacy Network

### Platform Identity
**WellsPx3** is Wells Pharmacy Network's proprietary prescriber portal, accessible at `orders.wellsrx.com`. Wells also operates **WPNScripts** (`wplscripts.wellsrx.com`), a newer electronic prescribing portal. Wells Pharmacy is a 503A/503B compounding pharmacy based in Ocala, FL. The portal is **free for all registered Wells customers**. ([WellsPx3 Home](https://orders.wellsrx.com))

Wells is notable for being the **only DEA 1311-certified solution** for electronic ordering of both controlled and non-controlled compounded substances. ([WellsPx3 About](https://orders.wellsrx.com/Home/About))

### Dual-Portal Architecture
- **WellsPx3 Electronic Ordering** — For physicians only; active Rx submission.
- **WellsPx3 Order Management** — For both physicians and veterinary prescribers; post-order tracking. Patients of BodyLogicMD practices may also access Order Management.
- **WPNScripts** — Newer portal (`wplscripts.wellsrx.com`, version 2026-03-27) for electronic prescription submission, potentially replacing WellsPx3 for some functions.

### Ordering Workflow (WellsPx3 EHR Integration via P2P)
The most documented workflow is through a **P2P (Practice to Practice) EHR integration**, where Wells appears as an embedded iframe within the EHR: ([Wells Pharmacy: Order New Rx — YouTube](https://www.youtube.com/watch?v=iDCYOXflukk))

1. In the patient chart, navigate to **Ordering → Medications → select "Wells Pharmacy"** from the drop-down
2. The Wells iframe opens. If the user is linked to multiple Wells locations, select the appropriate location.
3. Click **"New RX"** to initiate a prescription.
4. **Patient name and date of birth auto-populate** from the EHR chart.
5. Select the **date the patient was last seen**.
6. Select **visit method**: In-office or Telehealth.
7. **Type the medication or drug name** → an auto-populated drop-down list appears → select the correct option (e.g., "Tirzepatide 4.5 mL").
8. Once medication is selected:
   - Prescription details populate (dose, directions auto-generate based on entered values)
   - Optionally include **injection supplies** (checkbox)
   - Add **notes to pharmacy** (free text)
   - Choose shipping destination: **patient** or **clinic** (address auto-fills from EHR)
9. Click **"Save and Ready to Sign"** → prescriber reviews and clicks **"Sign and Send to WPN"** → prescription goes live.
10. Wells prescriptions appear in **blue** in the EHR medication history for visual identification.

**Clone (reorder) workflow:** Click the clone icon next to an existing prescription → all details auto-populate → edit as needed → sign and send.

### Order Management Dashboard Fields
Post-submission, the Order Management dashboard shows: ([Wells Px3 Order Management PDF](https://orders.wellsrx.com/Training.pdf))

| Field | Description |
|---|---|
| Order Number | Unique identifier (also invoice number) |
| Patient | Patient name |
| Line Count | Number of Rx items in the order |
| Added | Date entered into system |
| State | Workflow stage (Entered → Verified → Adjudicated → Printed/Processed → Approved → Shipped) |
| Shipping | Shipping terms (Ground, 2nd Day, O/N, etc.) |
| Shipping Date | Date order left facility |
| Tracking No | UPS/FedEx tracking link |
| Expected by | Estimated arrival date |

### EPCS (Controlled Substances)
Wells Px3 is DEA 1311-certified for EPCS. The workflow adds: ([Wells EPCS Training PDF](https://orders.wellsrx.com/OOTraining2.pdf))
- Two-factor authentication setup (software or hardware token via Experian identity proofing)
- Access Control Setup requiring two authorized users
- When writing a controlled substance Rx, "e-Send" is enabled only for EPCS-registered pharmacies
- Two-factor "Sign" screen appears for final authentication

### Key UX Characteristics
- **Hybrid:** Catalog-driven medication selection (type-ahead dropdown from Wells formulary) + free-text fields for directions and pharmacy notes.
- **EHR-embedded:** The preferred workflow runs inside the provider's existing EHR (P2P integration) rather than requiring a separate portal login.
- **Clone/reorder function:** Reduces friction for repeat prescriptions.
- **Titration handling:** No dedicated titration tool. Each dose escalation = new Rx via New RX flow or clone with modified dose. Wells accepts multi-refill prescriptions with SIG notes for provider-managed dose changes.
- **Templates/favorites:** Not explicitly documented in public materials; the clone feature serves a similar purpose.
- **Color coding:** Wells medications highlighted in blue within the integrated EHR view.

---

## 3. LifeFile / ePowerRx — The Dominant Platform

### Platform Identity
**LifeFile** (lifefile.net) is a cloud-based pharmacy management system founded in 2006, widely recognized as the dominant e-prescribing platform in the compounding pharmacy sector. It is used by some of the largest compounding pharmacies in the nation. ([LifeFile website](https://www.lifefile.net)) ([RXinsider profile](https://rxinsider.com/market-buzz/21091-lifefile-llc-an-advanced-cloud-pharmacy-system/))

LifeFile provides **four portals**: Pharmacy Portal, Provider Portal, Patient Portal App, and Sales Portal.

**Note:** LifeFile and the older "ePowerRx" are both compounding e-prescribing platforms. LifeFile is the more widely deployed modern system; the name "ePowerRx" appears in historical references to compounding e-prescribing. For most active deployments, LifeFile is the operational platform.

### Pharmacies Using LifeFile Provider Portal
- Empower Pharmacy (503A patient-specific)
- Belmar Pharmacy (all locations)
- Strive Pharmacy
- University Compounding Pharmacy (San Diego)
- South End Pharmacy
- Numerous other independent compounding pharmacies

### Provider Portal — Detailed Step-by-Step Workflow
The following is reconstructed from Strive Pharmacy's documented LifeFile training session ([Strive Sessions Ep. 2 — YouTube](https://www.youtube.com/watch?v=TctLL2EdSqc)) and South End Pharmacy's LifeFile tutorial ([Prescribe in a Flash — YouTube](https://www.youtube.com/watch?v=Z_g81rAyrg0)):

**Login:** Accessible via the pharmacy's website (e.g., strivepharmacy.com → person icon → username/password).

**Homepage tabs:**
1. Announcements / Critical Updates
2. Billing (phone/email contacts)
3. Shipping policies & turnaround times
4. **Digital Catalog** (all products and pricing, updated in real time, 24/7 access)
5. Help Center (resources and guides)

**New Order Workflow:**

**Step 1 — Select/Create Patient**
- Click the large **"Select Patient"** box
- Search existing patients by last name → info auto-populates
- OR click **"New Patient"** and enter required fields:
  - First name, Last name
  - Patient address and shipping address
  - Patient email address
  - Date of birth
- Click **"Save Patient"**

**Step 2 — Patient "Bubble Screen"**
- After selecting the patient, a set of action bubbles appears
- For new orders, click the first bubble: **"ERX"**

**Step 3 — Order Processing Information**
- **Pick-up or Ship?** Select delivery type
- Patient info section auto-populates from profile
- **Delivery address:** Click "Copy Patient Information" (ship to patient) OR "Copy Doctor Information" (ship to clinic)

**Step 4 — Select Medication**
- Browse the digital catalog or search by medication name
- Click the medication to select it
- Choose **strength** and **vial size** from dropdowns
- The rest of the prescription partially auto-populates

**Step 5 — Complete Prescription Fields**
- **Quantity** (in milliliters, not number of vials)
- **Refills** (prescriber's discretion)
- **Day supply** (prescriber's discretion)
- **Directions (SIG):** Preloaded popular options available as buttons; can type custom directions if none match
- **Include syringes?** Checkbox for applicable injectable medications
- Any special instructions

**Step 6 — Add to Cart & Submit**
- Click green **"Add to Order"** button
- Cart counter shows "Medications in current order: X"
- Can add additional medications for the same patient
- Click **"Review and Sign"** → review draft order → click **"Submit"**

**Refill Workflow:**
- Navigate to patient → locate previous order → click to open → "Review and Sign" → submit
- Alternatively: edit/update details if dosing has changed

**Advanced Features:**

**Order Linking** (ship multiple orders together):
- Place multiple orders normally, but use **"Save and Continue Later"** instead of Submit
- Return to saved orders, check boxes for orders to link, click **"Link Shipping"** → Submit together
- All linked orders ship in the same package to the same address

**Multi-Order Management** (same medication for multiple patients):
- From left control panel: **"Multi-Order Management"** → "New Multi-Order"
- Select delivery/shipping information (usually shipping to clinic)
- Set recipient type (prescriber) and payer
- Add patients from a list
- Click "Edit RX List" → "Add RX" → configure the medication, strength, directions (same for all patients in the batch)
- Click "Submit Order" → batch is sent to pharmacy

**Custom Order:**
- For non-catalog formulations, same ERX flow but medication is entered as a custom/free-text compound
- Must include clinical difference statement if a commercially available equivalent exists (per FDA 503A requirements)

### Key UX Characteristics
- **Primarily catalog-based** with custom order option: Standard prescriptions use a searchable catalog of pre-defined formulations; custom orders allow free-text entry of formulation components.
- **Mostly dropdown-driven:** Medication, strength, and vial size use dropdowns; SIG directions have a hybrid of preloaded options + free text.
- **MyRX List:** A personal favorites list of frequently used prescriptions for one-click reuse.
- **Real-time pricing:** Digital catalog displays current pricing, updated regularly.
- **EPCS compliant:** Supports electronic prescriptions for Schedule II–V controlled substances.
- **Patient compliance management:** Built-in features to track patient adherence.
- **B2B API integration:** EMR systems can push orders directly to LifeFile via API (e.g., Cer.bo EHR integration). ([FxMedSupport LifeFile Integration](https://fxmedsupport.com/lifefile-compounding-pharmacy-integration/))

### Titration Handling
No dedicated titration schedule builder exists within LifeFile as of current public documentation. Dose escalation is managed by:
1. Writing sequential prescriptions at each dose level (new ERX for each step)
2. Using detailed free-text SIG (e.g., "Week 1-4: inject 0.25mg weekly; Week 5-8: inject 0.5mg weekly...")
3. Multi-order function to batch-send the same dose to multiple patients simultaneously
4. "Save and Continue Later" + order linking to group sequential dose prescriptions

---

## 4. Empower Pharmacy Ordering Portal

### Platform Identity
Empower Pharmacy (Houston, TX) is one of the largest compounding pharmacies in the U.S., operating both a 503A compounding pharmacy (PCAB-accredited) and a 503B outsourcing facility (FDA-registered). It accordingly offers **two separate ordering portals** for providers. ([Empower Portal Login](https://www.empowerpharmacy.com/empower-pharmacy-portal-login/))

### Two-Portal Architecture

**Portal 1: 503A Patient-Specific Orders → LifeFile**
- Providers use a LifeFile account (auto-created for all Empower customers) to submit individual patient prescriptions.
- Step-by-step instructions are provided on the 503A Orders page. ([Empower 503A Orders](https://www.empowerpharmacy.com/503a-orders/))
- Features: Real-time product availability, order tracking, EPCS-compliant technology, robust reporting, patient compliance management.
- Ordering methods for 503A: Portal (LifeFile), fax to (832) 678-4419, call in at (346) 229-5386, or via EMR integration.

**Portal 2: 503B Office-Use Bulk Orders → Proprietary Office-Use Portal**
- Separate login from LifeFile: "Office-Use Account Login."
- Designed for bulk ordering of pre-manufactured batches for clinic stock (no individual patient Rx required).
- Ordering methods for 503B: Portal, fax to (832) 678-4419, call at (346) 229-5385, or email officeuse@empowerpharmacy.com.

### Custom Order Form Program (503B)
Empower offers a **Custom Order Form Program** that allows clinics to request a personalized, clinic-branded order form configured to their specific prescribing patterns: ([Empower Custom Order Form Program](https://www.empowerpharmacy.com/custom-order-form-program/))

1. Clinic fills out a request form
2. Dedicated Empower representative contacts clinic to gather product preferences
3. Empower team creates a custom form tailored to that clinic
4. Clinic receives a ready-to-use, clinic-branded order form

This effectively creates a filtered/curated sub-catalog for high-volume clinics, reducing the cognitive load of browsing the full formulary.

### Formulary Structure
Empower describes itself as having "the nation's largest compounding formulary." Products are browsable on the website by category. The 503B portal presents a catalog of available bulk SKUs. The 503A LifeFile portal presents the 503A formulary within the LifeFile catalog interface. ([Empower Providers page](https://www.empowerpharmacy.com/compound-medication/empowering-providers/))

Notable formulary categories include: GLP-1 agonists (Semaglutide/Cyanocobalamin, Tirzepatide/Niacinamide), hormones (Testosterone, Progesterone), peptides (Sermorelin, NAD+), IV nutrition, sexual health, dermatology.

### Semaglutide Handling
Empower's 503A catalog includes Semaglutide/Cyanocobalamin Injection in multiple concentrations (1 mg/mL and 5 mg/mL; 1 mL and 2.5 mL vials) and Semaglutide/Methylcobalamin ODT in three strength combinations (2mg/0.1mg, 5mg/0.1mg, 12mg/0.1mg). ([Semaglutide/Cyanocobalamin product page](https://www.empowerpharmacy.com/compounding-pharmacy/semaglutide-cyanocobalamin-injection/))

For titration, Empower's product documentation describes a standard escalation protocol but notes prescribers set the actual titration through the SIG on individual prescriptions. The standard approach: 0.25mg weekly × 4 weeks → 0.5mg × 4 weeks → 1mg × 4 weeks → up to 2.5mg maximum. The portal does not build a titration schedule; each dose level requires a separate prescription through LifeFile.

### Key UX Characteristics
- **Dual portal model** cleanly separates 503A (patient-specific) from 503B (office-use/bulk).
- **503A uses LifeFile** — same UX as other LifeFile pharmacies described above.
- **503B portal is catalog-based** — browse pre-manufactured batch SKUs.
- **Custom order forms** are available as a clinic-specific overlay on the 503B catalog.
- **No templates or titration builders** evident in public documentation.
- Account qualification required for controlled substances.

---

## 5. ReviveRX Ordering Interface

### Platform Identity
ReviveRX is a 503A licensed mail-order compounding pharmacy based in Houston, TX (3831 Golf Dr., Houston, TX 77018), serving 45 states plus Puerto Rico. It positions itself as a "partnership-first" pharmacy for healthcare providers in hormone therapy, wellness, weight management, functional medicine, and concierge/telehealth practices. ([ReviveRX website](https://reviverx.com)) ([ReviveRX About](https://reviverx.com/about))

### Portal Documentation
ReviveRX's prescriber portal has very limited public documentation. The available information suggests:

- **Onboarding process:** Provider submits a short provider form → dedicated representative contacts them → account is set up → prescribing can begin. Ordering preferences and clinical considerations are discussed during account setup.
- **Prescription submission:** "Your practice can begin sending prescriptions, according to your instructions, as soon as onboarding is complete."
- **Portal quality:** One provider testimonial states: "their interface dashboard for ordering is my favorite." No further specification available.
- **Direct-to-patient shipping:** All orders ship directly to patients within ~3 days.
- **Support model:** Dedicated representative + pharmacy support team for each provider; providers are not expected to self-serve without support.

### Inferred Characteristics
ReviveRX's 503A-only model (no 503B mentioned) and emphasis on personalized partnerships suggests a **prescription-driven workflow** rather than a fixed-SKU catalog. The "ordering preferences" discussed during onboarding suggest some degree of protocol or template configuration. Given ReviveRX's Houston location and 503A focus, the portal may be LifeFile-based (LifeFile is heavily used by Houston-area compounding pharmacies), but this is not confirmed in public sources. ([ReviveRX Partners](https://reviverx.com/partners))

### Key UX Characteristics
- **Prescription-driven** (503A, patient-specific)
- **High-touch onboarding** with dedicated representative
- **Ordering preferences** configured at account setup (suggests some template/protocol capability)
- **Minimal self-service documentation** — support-forward model

---

## 6. Belmar Pharmacy Ordering System

### Platform Identity
Belmar Pharma Solutions is a multi-location 503A compounding pharmacy network with locations in Colorado (Golden), Arizona, Florida, Wisconsin, Kansas, and Utah (as MedQuest Pharmacy). Their prescriber portal is **powered by LifeFile**. ([Belmar Portal Login](https://www.belmarpharmasolutions.com/portal-login/))

### Portal Structure
- **Platform:** LifeFile (titled "LifeFile | Belmar Provider Portal" on their portal page)
- **Free** for all registered prescribers
- Two specific login endpoints: **Belmar Select Outsourcing Portal** and **Belmar Pharmacy – Colorado Portal**
- One-on-one training available by contacting `lifefile@belmarpharmasolutions.com`

### Portal Features
As documented on Belmar's portal page and prescription submission guide: ([Belmar Portal Login page](https://www.belmarpharmasolutions.com/portal-login/)) ([Belmar How to Write a Prescription](https://www.belmarpharmasolutions.com/clinicians/benefits-of-compounding/how-to-write-a-compounded-prescription/))

- Sends new prescriptions and refills securely and accurately
- Real-time order status and tracking
- EPCS-compliant capabilities
- User-friendly prescribing tools for quick, easy ordering
- Easy refill entry
- Delivery tracking for patients
- **Personalized medication lists customizable to your practice** (indicates a "MyRX"-style favorites list)

**Handy How-To's on the portal page:**
1. How to Add a New Patient
2. How to Submit a New Order
3. How to Submit an ezRefill

### Required Prescription Fields
For any compounded prescription at Belmar, providers must supply: ([Belmar Submit a Prescription](https://www.belmarpharmasolutions.com/clinicians/working-with-belmar/submit-a-patient-prescription/))

| Category | Fields Required |
|---|---|
| Patient Information | First name, last name, DOB, gender, address, cell phone, email, known drug allergies, patient identifier (applicable states) |
| Prescription Information | Date, drug(s), dose, dosage form, directions (frequency + route), quantity, refills |
| Prescriber Information | First/last name, practice address, phone, fax, NPI#, state license#, DEA license, state controlled substance registration (where applicable) |
| Prescriber Signature | Pen-to-paper for controlled substances; EPCS preferred |
| Payment Type | Patient pay or clinic pay |

### Submission Methods
1. Phone (toll-free numbers by location)
2. Fax (toll-free numbers by location)
3. EMR e-prescribe (via NCPDP number by location)
4. **LifeFile Prescriber Portal** (contact required to set up access)

### Pellet/Testosterone Injectable Office-Use Orders
For pellet and testosterone injectable bulk orders, Belmar uses a separate **Belmar Select Outsourcing Portal** (also LifeFile-based). New customers must apply separately for this account. ([Belmar Patient-Specific 503A page](https://www.belmarpharmasolutions.com/clinicians/benefits-of-compounding/patient-specific-503a-compounding/))

### Key UX Characteristics
- **LifeFile-based** — same UX as described in Section 3.
- **Personalized medication lists** per practice (LifeFile's MyRX feature).
- **EPCS-compliant** for controlled substances.
- **Multi-location complexity:** Six separate pharmacy locations with different phone/fax numbers; portal may allow location selection.
- **Titration handling:** Not built into the portal; handled via free-text SIG or sequential prescriptions.

---

## 7. Additional Compounding Pharmacy Portals

### 7.1 Strive Pharmacy

**Portal platform:** LifeFile (confirmed), accessed via strivepharmacy.com → person icon login.

Strive Pharmacy is notable for providing the most comprehensive public documentation of the LifeFile provider portal through their **Strive Sessions webinar series**, including a full step-by-step prescribing walkthrough ([Strive Sessions Ep. 2 — YouTube](https://www.youtube.com/watch?v=TctLL2EdSqc)) and a blog post summarizing LifeFile features. ([Strive LifeFile Webinar Blog](https://www.strivepharmacy.com/blog/lifefile-webinar))

Key features documented by Strive:
- Digital catalog tab (all products and pricing, updated daily)
- Multi-Order Management for batch same-medication orders across multiple patients
- Order linking (shipping multiple orders in one package)
- Custom Order entry for non-catalog formulations
- Clinical difference statement documentation (required per 503A rules when a commercial equivalent exists)
- MyRX list for frequently prescribed medications

Strive's webinar included an example of prescribing **semaglutide sublingual drops** via the multi-order management workflow.

### 7.2 Tailor Made Compounding (TMC)

**Portal platform:** Proprietary EMR/portal system. TMC launched a **new Provider Portal in November 2024**, replacing a legacy portal at `emr.tailormadecompounding.com`. ([TMC Legacy Portal Page](https://emr.tailormadecompounding.com))

- Access via: `tailormadecompounding.com` → secure, HIPAA-compliant online ordering portal
- Features: Electronic prescriptions, patient record tracking, order management
- Account setup requires: Clinic name, prescriber information (multiple prescribers can be added), license uploads, communication preference selection ([TMC Account Request page](https://emr.tailormadecompounding.com/register.aspx))
- TMC is a 503A-only pharmacy (all prescriptions must be patient-specific)
- Serves 46 states including Puerto Rico
- Account manager provides email notifications on order status changes

**Key UX characteristic:** Account-manager-centric model with dedicated support. New portal (2024) suggests active investment in UX.

### 7.3 University Compounding Pharmacy (UCP) — San Diego

**Portal platform:** LifeFile (confirmed — "Lifefile Login" button on provider page). ([UCP Provider Rx Form page](https://www.ucprx.com/provider-prescription-request))

- Prescribers submit via phone (direct pharmacist line), fax, or e-prescribe through their EMR.
- **Patient-side workflow:** Provider submits prescription → UCP contacts patient within 24 hours via text/email with a link to complete the order online (delivery address, billing, medications/allergies). 
- **Quick Refill** available on website: patients can self-refill without calling. ([UCP FAQs](https://www.ucprx.com/frequently-asked-questions))
- **Auto-refill program** available via email enrollment.
- **503A only** — no office-use/bulk compounds to providers.
- Most prescriptions ship within 2–3 business days.

### 7.4 ScriptWorks Pharmacy (California, PCAB-accredited)

ScriptWorks offers a notable prescriber portal with several well-documented UX features: ([ScriptWorks Prescriber Portal blog](https://scriptworksrx.com/blog/prescriber-portal-best-compounding-pharmacy-california/))

- **Practice-specific drug catalog** curated to the prescriber's patterns and patient needs
- Submit prescriptions online without requiring an EMR system
- Choose **patient-ship or provider-ship** at the order level
- **Adherence monitoring** — visibility into patient progress and medication timelines
- Direct pharmacist communication from within the portal
- **Structured order fields** to prevent errors associated with handwritten/faxed orders
- LegitScript-certified and HIPAA-compliant

This is one of the few pharmacies to explicitly describe a **customized practice-level catalog** as a portal feature.

### 7.5 CareFirst Specialty Pharmacy

**Portal platform:** No dedicated prescriber portal documented publicly. Prescriptions accepted via fax, phone, or e-prescribe (NCPDP# 3151266, searching "CareFirst Specialty Pharmacy" in prescriber's EMR). ([CareFirst Prescribers page](https://www.cfspharmacy.pharmacy/prescribers))

Prescribers can complete a prescriber form online for account registration, but form registration is not required to submit prescriptions. Pharmacist consultation available by phone.

### 7.6 My Practice Connect ERX Platform (Multi-Pharmacy Aggregator)

**My Practice Connect** is a notable aggregator platform that stands apart from single-pharmacy portals: ([My Practice Connect ERX Platform](https://mypracticeconnect.com/rx-platform/))

- Single web-based portal with access to **multiple FDA-registered 503A and 503B pharmacies** simultaneously, including Empower Pharmacy, Wells Pharmacy, and others
- **Real-time inventory and pricing across pharmacies**
- Providers can place individual or bulk orders
- Automated refill reminders for patient compliance
- Order history and tracking across all connected pharmacies
- Secure messaging directly with pharmacy teams
- Interaction alerts for drug/allergy risks
- EPCS-compliant, HIPAA-compliant
- **No recurring monthly or annual fees**; multiple prescribers/locations at no extra cost

Connected pharmacies include: 1st Choice Compounding, Brooksville Pharmaceuticals, Empower Pharmacy, Grand Ave Pharmacy, Liquivida, Meta Pharmacy Services, Partell Pharmacy, PharmaLabs, Safe Chain Solutions, Wells Pharmacy, WP PharmaLabs, and others.

This aggregator model is a significant UX pattern — it removes pharmacy-specific portal fragmentation for providers who work with multiple compounding pharmacies.

---

## 8. Cross-Platform UX Analysis

### 8.1 Catalog Architecture: Fixed SKU vs. Custom Build

| Platform | Architecture | Notes |
|---|---|---|
| Olympia/DrScript (503B) | Fixed catalog | SKUs defined by concentration × volume; no customization |
| Empower 503B portal | Fixed catalog | Pre-manufactured batch SKUs; custom order forms per clinic |
| LifeFile (all 503A pharmacies) | Catalog + custom | Primary catalog of pre-formulated compounds; custom order option for off-catalog formulations |
| WellsPx3 | Catalog with type-ahead | Medication selection from Wells formulary via type-ahead dropdown |
| Tailor Made Compounding | Unknown (proprietary) | New portal (Nov 2024), 503A patient-specific |
| ReviveRX | Likely catalog-based | Configuration discussed at onboarding; 503A model |

### 8.2 Field Sequence by Portal Type

**LifeFile standard order sequence:**
1. Patient lookup/creation (name, DOB, address, email)
2. Order type (ERX)
3. Delivery type (pickup vs. ship)
4. Delivery address (copy patient or copy doctor)
5. Medication selection (search/browse catalog → select strength → select vial size)
6. Quantity (in mL)
7. Refills
8. Day supply
9. Directions/SIG (preloaded options or free text)
10. Injection supply add-on (checkbox)
11. Billing profile selection
12. Review and submit

**WellsPx3 (P2P EHR-integrated) sequence:**
1. Navigate to Medications in patient chart → select Wells Pharmacy
2. Click "New RX"
3. Patient info (auto-populated from EHR)
4. Last visit date
5. Visit method (in-office/telehealth)
6. Medication name (type-ahead dropdown)
7. Prescription details (auto-populate + manual completion)
8. Injection supplies (checkbox)
9. Notes to pharmacy (free text)
10. Shipping destination (patient/clinic)
11. Save and Ready to Sign → prescriber signs and sends

**503B office-use catalog sequence (Olympia/Empower):**
1. Login to portal
2. Browse catalog (Category/Route/Volume filters)
3. Select medication SKU
4. Enter quantity (units/vials)
5. Select patient or clinic shipping
6. Enter billing information
7. Review and confirm

### 8.3 Input Methods

| Input Type | Use Case |
|---|---|
| Dropdown/selector | Medication name, strength, vial size, delivery type, billing profile |
| Type-ahead search | Medication name lookup from formulary (WellsPx3, LifeFile) |
| Pre-loaded SIG buttons | Common directions (LifeFile) |
| Free text | Custom SIG/directions, notes to pharmacy, custom compound ingredients |
| Checkbox | Include injection supplies, auto-refill enrollment |
| Auto-populate | Patient data from profile, address fields, prescription details from selected medication |

### 8.4 Protocol Templates and Favorites

| Feature | Platform | Implementation |
|---|---|---|
| MyRX List | LifeFile (all pharmacies) | Personal catalog of saved prescriptions for one-click reuse |
| Clone/Reorder | WellsPx3 (P2P integration) | Duplicates a previous prescription with all details |
| Custom Order Forms | Empower Pharmacy (503B) | Clinic-branded filtered sub-catalog; created by Empower team |
| Practice-Specific Catalog | ScriptWorks | Curated catalog matching prescriber's typical patterns |
| Multi-Order Management | LifeFile (all pharmacies) | Batch same-medication orders across multiple patients; effectively a protocol template |
| Account Setup Preferences | ReviveRX | Ordering preferences configured at onboarding |
| Prescription Templates | SiCompounding platform | Prescribers create templates with one or multiple prescriptions; available for multi-patient batching ([SiCompounding Release Notes](https://www.sicompounding.io/release-notes)) |

### 8.5 Titration Schedule Handling

**No compounding pharmacy portal currently reviewed has a dedicated titration schedule builder.** The standard approaches across platforms:

| Approach | Platform | Notes |
|---|---|---|
| Free-text SIG | All (LifeFile, WellsPx3, DrScript) | Write complete titration instructions in the SIG field: "Weeks 1-4: inject 0.25mg; Weeks 5-8: inject 0.5mg; Weeks 9-12: inject 1mg..." |
| Sequential prescriptions | All | Write one Rx per dose level; patient receives separate fills |
| Multi-vial concentration selection | All catalog-based | Order vials at different concentrations for different phases; each is a separate SKU |
| Multi-Order batch | LifeFile | Prescribe same dose to many patients simultaneously |
| "Save and Link Later" | LifeFile | Write sequential dose prescriptions for same patient, save drafts, then link and submit together for one shipment |

The **most common real-world approach** for a 10-week semaglutide escalation (e.g., 0.25mg × 4 weeks, 0.5mg × 4 weeks, 1mg × 2 weeks) is to:
1. Issue a multi-vial prescription for the starting dose with a free-text SIG describing the escalation
2. OR issue monthly prescriptions at each dose level
3. The SIG conveys the protocol to the patient; the pharmacy fulfills each Rx as written

---

## 9. Key Findings and Design Implications

### 9.1 The LifeFile Monopoly Problem
LifeFile dominates 503A compounding prescriber portals, but the platform has known usability issues. Strive Pharmacy's trainer explicitly warned: **"LifeFile is finicky. I do not want you to worry about it."** This is a significant signal. Despite being the market-leading platform, LifeFile's UX generates enough friction that pharmacies build training infrastructure around managing provider frustration.

### 9.2 No Dedicated Titration UX Exists
The absence of a native titration schedule builder across all platforms is a significant gap. Clinicians managing GLP-1 weight management protocols, hormone optimization, or peptide therapy typically have multi-week dose escalation plans. The current state — writing paragraph-length SIG instructions or placing sequential single-dose prescriptions — is error-prone and cumbersome.

### 9.3 EHR Embedding Reduces Friction
WellsPx3's EHR-embedded (iframe) workflow is a notably better UX than requiring providers to leave their EHR and log into a separate portal. Patient data auto-populates, medication history is visible in context, and color-coded Wells prescriptions are visually distinct. The downside: it requires EMR-level integration agreements.

### 9.4 Catalog-Based 503B Portals Are Simpler
503B office-use portals (Olympia, Empower 503B) are functionally e-commerce stores. The ordering flow is closer to an Amazon checkout than a clinical prescription process. This simplicity is appropriate for the 503B model (no individual patient Rx required), but the tradeoff is zero customization.

### 9.5 Multi-Order / Batch Capabilities Are Underserved
For clinics running high-volume GLP-1 or hormone optimization programs, the ability to prescribe the same protocol to many patients simultaneously is critical. LifeFile's Multi-Order Management feature addresses this, but the UX is complex enough that Strive dedicates webinar time to teaching it. A cleaner batch-prescription experience would serve this use case well.

### 9.6 The Aggregator Pattern (My Practice Connect) Points to Future Direction
The existence of a multi-pharmacy aggregator (My Practice Connect) that normalizes ordering across Empower, Wells, and others suggests provider demand for a single-pane-of-glass interface. The pharmaceutical equivalent of a marketplace or GPO portal. No single pharmacy portal meets this need.

### 9.7 Input Hybrid is Standard
Every modern portal reviewed uses a hybrid of dropdowns (for catalog items) and free text (for SIG, notes, custom compounds). Pure free-text entry (fax/phone) is still widely supported as a fallback, reflecting the diversity of provider technical sophistication.

---

## Sources

- [Olympia Pharmacy Provider Resources](https://www.olympiapharmacy.com/providers/)
- [Olympia Medication Directory](https://www.olympiapharmacy.com/medication-directory/)
- [Olympia DrScript Portal](https://olympiapharmacy.drscriptportal.com/profile/loading)
- [IPC / Olympia Partnership Page](https://www.ipcrx.com/pharmacy-vendors/pharmacy-supplies/olympia-pharmaceuticals/)
- [503 Success LLC](https://503success.com)
- [WellsPx3 Home](https://orders.wellsrx.com)
- [WellsPx3 About](https://orders.wellsrx.com/Home/About)
- [Wells Physician Resources](https://wellsrx.com/compounding-pharmacy/physician-resources/)
- [Wells Order Management Training PDF](https://orders.wellsrx.com/Training.pdf)
- [Wells EPCS Training PDF](https://orders.wellsrx.com/OOTraining2.pdf)
- [Wells Pharmacy: Order New Rx — YouTube](https://www.youtube.com/watch?v=iDCYOXflukk)
- [Wells Pharmacy: Managing Medications — YouTube](https://www.youtube.com/watch?v=cqhn1DWIMxg)
- [WPNScripts Portal](https://wplscripts.wellsrx.com/Identity/Account/Login)
- [LifeFile Website](https://www.lifefile.net)
- [LifeFile Provider Portal](https://www.lifefile.net/provider-portal)
- [LifeFile RXinsider Profile](https://rxinsider.com/market-buzz/21091-lifefile-llc-an-advanced-cloud-pharmacy-system/)
- [FxMedSupport LifeFile-Cerbo Integration](https://fxmedsupport.com/lifefile-compounding-pharmacy-integration/)
- [Strive Sessions Ep. 2: LifeFile Walkthrough — YouTube](https://www.youtube.com/watch?v=TctLL2EdSqc)
- [Strive LifeFile Webinar Blog](https://www.strivepharmacy.com/blog/lifefile-webinar)
- [South End Pharmacy LifeFile Tutorial — YouTube](https://www.youtube.com/watch?v=Z_g81rAyrg0)
- [Empower Pharmacy Portal Login](https://www.empowerpharmacy.com/empower-pharmacy-portal-login/)
- [Empower 503A Orders](https://www.empowerpharmacy.com/503a-orders/)
- [Empower Custom Order Form Program](https://www.empowerpharmacy.com/custom-order-form-program/)
- [Empower Providers](https://www.empowerpharmacy.com/compound-medication/empowering-providers/)
- [Empower Semaglutide/Cyanocobalamin Product Page](https://www.empowerpharmacy.com/compounding-pharmacy/semaglutide-cyanocobalamin-injection/)
- [Empower FAQs](https://www.empowerpharmacy.com/who-we-serve/faqs/)
- [ReviveRX Website](https://reviverx.com)
- [ReviveRX About](https://reviverx.com/about)
- [ReviveRX Partners](https://reviverx.com/partners)
- [Belmar Portal Login](https://www.belmarpharmasolutions.com/portal-login/)
- [Belmar How to Write a Compounded Prescription](https://www.belmarpharmasolutions.com/clinicians/benefits-of-compounding/how-to-write-a-compounded-prescription/)
- [Belmar Submit a Prescription](https://www.belmarpharmasolutions.com/clinicians/working-with-belmar/submit-a-patient-prescription/)
- [Tailor Made Compounding Join Us](https://tailormadecompounding.com/join-us/)
- [Tailor Made Compounding Legacy Portal](https://emr.tailormadecompounding.com)
- [Tailor Made Compounding Account Request](https://emr.tailormadecompounding.com/register.aspx)
- [University Compounding Pharmacy](https://www.ucprx.com)
- [UCP FAQs](https://www.ucprx.com/frequently-asked-questions)
- [UCP Provider Rx Forms](https://www.ucprx.com/provider-prescription-request)
- [ScriptWorks Prescriber Portal Blog](https://scriptworksrx.com/blog/prescriber-portal-best-compounding-pharmacy-california/)
- [CareFirst Specialty Pharmacy Prescribers](https://www.cfspharmacy.pharmacy/prescribers)
- [My Practice Connect ERX Platform](https://mypracticeconnect.com/rx-platform/)
- [SiCompounding Release Notes](https://www.sicompounding.io/release-notes)
- [Strive Pharmacy Homepage](https://www.strivepharmacy.com)
- [GobyMeds Semaglutide Dosing](https://www.gobymeds.com/articles/understanding-a-compounded-semaglutide-dosing-schedule)
