# CompoundIQ — Clinic Onboarding Playbook

**Version:** 1.0 | **Date:** April 5, 2026
**Audience:** CompoundIQ operations team, clinic administrators

---

## Overview

This playbook walks through every step of onboarding a new clinic onto the CompoundIQ platform — from initial setup through their first successful order. Follow these steps in order. Each step has a verification checkpoint before moving to the next.

**Estimated total time:** 30–45 minutes (with clinic admin present for Stripe onboarding)

---

## Pre-Onboarding Requirements

Before starting, confirm the following with the clinic:

- [ ] Clinic name and business address
- [ ] Clinic admin email address (will be their login)
- [ ] At least one provider with a valid NPI number and state license
- [ ] At least one medical assistant who will use the platform daily
- [ ] Clinic logo file (PNG or JPG, for patient checkout branding)
- [ ] Clinic contact phone number and/or email (displayed on patient checkout)
- [ ] Bank account information ready for Stripe Connect onboarding
- [ ] Understanding of the per-transaction platform fee model (15% of margin spread)

---

## Step 1 — Create the Clinic Record

**Who does this:** CompoundIQ ops team

1. Log in to the Ops Dashboard as ops_admin
2. Create the clinic record in Supabase with:
   - `name`: Clinic's full business name
   - `stripe_connect_status`: PENDING
   - `logo_url`: Upload the clinic's logo to Supabase Storage and set the URL
3. Note the generated `clinic_id` UUID — this will be needed for user creation

**Verification:** Clinic appears in the clinics table with status PENDING.

---

## Step 2 — Create User Accounts

**Who does this:** CompoundIQ ops team

Create Supabase Auth users for each clinic team member:

### Clinic Admin
```
Email: [clinic admin's email]
Password: [generate a strong temporary password]
user_metadata: {
  app_role: "clinic_admin",
  clinic_id: "[clinic_id from Step 1]"
}
```

### Provider(s)
```
Email: [provider's email]
Password: [generate a strong temporary password]
user_metadata: {
  app_role: "provider",
  clinic_id: "[clinic_id from Step 1]"
}
```

Also create a provider record in the `providers` table:
- `clinic_id`: from Step 1
- `npi_number`: Provider's 10-digit NPI
- `name`: Provider's full name
- `credentials`: MD, DO, NP, or PA

### Medical Assistant(s)
```
Email: [MA's email]
Password: [generate a strong temporary password]
user_metadata: {
  app_role: "medical_assistant",
  clinic_id: "[clinic_id from Step 1]"
}
```

**Verification:** Each user can log in at `/login` and lands on `/dashboard`. Send temporary passwords securely (not via email — use a secure channel).

---

## Step 3 — Stripe Connect Onboarding

**Who does this:** Clinic admin (with CompoundIQ ops support)

This is the critical step that enables the clinic to receive patient payments.

1. The clinic admin logs into CompoundIQ
2. They will see a banner: "Stripe onboarding must be completed" and the "+ New Prescription" button is disabled
3. Navigate to Settings or click the Stripe onboarding banner
4. Click "Set Up Payments" — this redirects to Stripe's hosted Express onboarding flow
5. The clinic admin completes Stripe's requirements:
   - Business information (legal name, EIN/SSN, address)
   - Bank account for payouts
   - Identity verification
6. After completion, Stripe redirects back to CompoundIQ
7. The system receives an `account.updated` webhook from Stripe
8. If `charges_enabled = true` AND `payouts_enabled = true` AND no outstanding requirements:
   - `stripe_connect_status` transitions to **ACTIVE**
   - The "+ New Prescription" button becomes enabled
   - The clinic is ready to create orders

**If Stripe requires additional information:**
- `stripe_connect_status` transitions to **RESTRICTED**
- New order creation is blocked
- Existing orders continue processing
- The clinic admin sees a banner with specific requirements from Stripe

**Verification:** `stripe_connect_status = ACTIVE` in the clinics table. The "+ New Prescription" button is enabled on the dashboard.

---

## Step 4 — Configure Clinic Settings

**Who does this:** Clinic admin

1. Navigate to **Settings** in the Clinic App
2. **Upload clinic logo** — This appears on the patient checkout page for white-label branding
3. **Set default markup percentage** — e.g., 2.0 for 2x markup. This pre-populates the Margin Builder for all MAs
4. **Verify clinic contact info** — Phone/email displayed on patient checkout success page

**Verification:** Logo appears in settings. Default markup is set.

---

## Step 5 — Verify Pharmacy Access

**Who does this:** CompoundIQ ops team or clinic MA

1. Log in as the medical assistant
2. Click "+ New Prescription"
3. Select the patient's shipping state (e.g., TX)
4. Search for a common medication (e.g., "Semaglutide")
5. Verify pharmacy results appear with:
   - Pharmacy names
   - Wholesale pricing
   - Integration tier badges
   - Turnaround times

**If no results appear:**
- Verify pharmacies have active state licenses for the selected state in `pharmacy_state_licenses`
- Verify catalog items exist for those pharmacies
- Verify pharmacy `regulatory_status = ACTIVE`

**Verification:** At least one pharmacy appears in search results with correct pricing.

---

## Step 6 — First Test Order (Internal)

**Who does this:** CompoundIQ ops team with clinic admin observing

Walk through the complete order flow to verify everything works:

1. **MA creates order:**
   - Search for a medication and select a pharmacy
   - Set retail price using the 2x multiplier
   - Enter prescription directions (Sig)
   - Proceed to review

2. **Provider signs:**
   - Log in as the provider
   - Review the order details
   - Digital signature on the signature pad
   - Click "Sign & Send Payment Link"

3. **Verify order created:**
   - Order appears on dashboard as "Awaiting Payment"
   - Checkout URL generated (visible in order detail)
   - Three SLA timers created (24h reminder, 48h reminder, 72h expiry)

4. **Complete test payment:**
   - Open the checkout URL
   - Verify clinic branding appears
   - Pay with Stripe test card: `4242 4242 4242 4242`
   - Verify success page displays correctly

5. **Verify fulfillment triggered:**
   - Order transitions to PAID_PROCESSING
   - Prescription routed to pharmacy via the appropriate tier
   - Adapter submission logged

**Verification:** Full order lifecycle completes without errors.

---

## Step 7 — Train the Team

**Who does this:** CompoundIQ ops team with clinic staff

### Medical Assistant Training (15 minutes)

Walk the MA through:
1. Logging in and navigating the dashboard
2. Creating a new prescription (search, price, send)
3. Understanding status badges and SLA indicators
4. Using the Kanban view
5. What happens after they send the payment link (automated reminders, expiry)

### Provider Training (5 minutes)

Walk the provider through:
1. Receiving a signature request
2. Reviewing order details
3. Signing with the digital signature pad
4. Understanding that their NPI and signature are locked after signing

### Clinic Admin Training (10 minutes)

Walk the admin through:
1. Revenue dashboard — viewing payouts, margins, order history
2. Settings — logo, default markup
3. Stripe Connect — checking payout status
4. What to do if Stripe status becomes RESTRICTED

---

## Step 8 — Go Live

- [ ] All user accounts created and tested
- [ ] Stripe Connect status = ACTIVE
- [ ] Clinic logo uploaded
- [ ] Default markup configured
- [ ] First test order completed successfully
- [ ] MA trained on daily workflow
- [ ] Provider trained on signature flow
- [ ] Admin trained on settings and revenue
- [ ] Emergency contact exchanged (CompoundIQ ops phone/email)
- [ ] Clinic understands the platform fee structure

**The clinic is now live on CompoundIQ.**

---

## Post-Onboarding Support

### First Week Check-In

After the first week, schedule a 15-minute check-in:
- How many orders have been created?
- Any issues with the workflow?
- Any pharmacy results missing or incorrect?
- Any patient payment issues?
- Feedback on the margin builder and pricing tools

### Ongoing Support

| Need | How to Get Help |
|------|----------------|
| Order stuck in a status | Contact ops — we monitor the SLA dashboard |
| Payment issue | Contact ops — we can check Stripe Connect status |
| New provider needs an account | Contact ops — we create the user and provider record |
| Catalog pricing seems wrong | Contact ops — we can check catalog version and sync status |
| Technical issue or bug | Contact ops — we escalate to engineering |

---

## Troubleshooting Common Onboarding Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| User can't log in | Wrong password or email | Reset via Supabase Auth dashboard or seed script |
| "+ New Prescription" disabled | Stripe Connect not ACTIVE | Complete Stripe onboarding or check for outstanding requirements |
| No pharmacies in search results | No licensed pharmacies for selected state | Verify pharmacy_state_licenses entries |
| Margin builder shows $0 wholesale | Catalog not loaded for pharmacy | Upload catalog CSV or trigger API sync |
| Patient didn't receive SMS | TWILIO_ENABLED=false (POC) or phone number issue | Verify Twilio is enabled and phone number is valid |
| Provider can't sign | Signature pad not rendering | Clear browser cache, try a different browser |
| Stripe payout failed | Bank account issue on Stripe side | Clinic admin checks Stripe Express dashboard |

---

*CompoundIQ — Your clinic is 30 minutes away from a better workflow.*
