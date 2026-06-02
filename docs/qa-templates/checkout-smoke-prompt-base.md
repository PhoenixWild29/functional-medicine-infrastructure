# Checkout Smoke Prompt Base Template

This is the **reusable base structure** for browser-agent **focused smoke prompts** that target the patient-facing Checkout page only. Use this whenever a dependency campaign (Next.js bump, Stripe SDK bump, postcss/CSP-related change) needs a fast human-driven verification that CI doesn't cover.

**Different from `walkthrough-prompt-base.md`:**

| Aspect | `walkthrough-prompt-base.md` | `checkout-smoke-prompt-base.md` (this file) |
|--------|-------------------------------|----------------------------------------------|
| Scope | Full end-to-end demo (all 4 roles, every Part) | Checkout page only (1 role login + drawer + /checkout/[token]) |
| Duration | 30–60 minutes | ~10 minutes |
| When to use | Major release rounds (R7, R8, R9…) | Dependency campaigns, Stripe-touching PRs, post-merge gates |
| Verbosity | Concats with full POC-DEMO-DETAILED.md | Self-contained — no concat needed |
| Audience | Browser-agent + product-aware reviewer | Browser-agent that has never seen the app |

**Provenance:** Captured 2026-05-27 after the post-security-campaign (PRs #59, #62, #64, #65) demo-readiness gate flagged by Codex pass 2. First version of the prompt assumed product literacy ("log in as Clinic Admin", "find an AWAITING_PAYMENT order") and was rewritten to be literal step-by-step after a user critique. The verify-before-report guardrail block is inherited verbatim from `walkthrough-prompt-base.md`.

## How to use

1. **Copy the entire `=== PROMPT START ===` … `=== PROMPT END ===` block** below into a new campaign-specific file at `docs/qa-reports/qa-checkout-smoke-{campaign-tag}-prompt.md`.

2. **Fill in the campaign-specific deltas** marked `<!-- CAMPAIGN: ... -->`:
   - **What changed and why this test exists**: name the PRs/commits that motivate the smoke, and the specific risk surface they touch (e.g., "Next bump → CSP nonces affect Stripe iframe", "Stripe SDK bump → PaymentElement options changed").
   - **Targeted regression checks**: any specific behavior the campaign's PRs might have broken that requires an explicit check beyond the generic Steps 6A–6J.

3. **Paste directly into a browser-agent session.** This prompt is self-contained — no concat needed.

## When to use this vs. the full walkthrough

Use this prompt:
- ✅ After a Next.js / postcss / Tailwind / Stripe-SDK / CSP-related dependency bump
- ✅ After any PR that touches `src/app/checkout/[token]/**`, `src/app/api/orders/[orderId]/checkout-link/**`, or `src/app/api/checkout/payment-intent/**`
- ✅ As a pre-demo gate when you have no other reason to do a full walkthrough but want to verify the patient payment path still works
- ✅ When Codex review flags "demo-readiness needs manual smoke" but the change isn't broad enough to justify R-N

Use `walkthrough-prompt-base.md` instead:
- 🅿 After a feature release affecting multiple roles
- 🅿 After EPCS, prescription builder, ops dashboard, or fax-related changes
- 🅿 On a scheduled cadence (monthly R-N rounds)

---

## The base prompt

Below is the full prompt. Campaign-specific placeholders are wrapped in `<!-- CAMPAIGN: ... -->` HTML comments. Replace each placeholder block with the campaign's content; leave everything else verbatim.

```
=== PROMPT START ===

You are a fresh browser-driving QA agent. You have **never used this application before**. You have **no knowledge** of its UI, vocabulary, layouts, or feature names beyond what this prompt tells you. Treat every instruction below as literal.

You have access to a full web browser, mouse, keyboard, and DevTools. You can take screenshots, read the DOM, inspect network requests, and read the JavaScript console.

═══════════════════════════════════════════════════════════════
ABOUT THE PRODUCT (so you understand what you're looking at)
═══════════════════════════════════════════════════════════════

This is **CompoundIQ**, a SaaS product used by compounding-pharmacy
clinics. It does two things:

1. Clinic staff log in to a "Clinic App" and create prescription
   orders for patients.
2. Patients receive a public link to a "Checkout" page where they
   pay for the prescription via Stripe (credit card).

You will be testing the **patient-facing Checkout page** to make
sure it still works after a recent change.

To reach the Checkout page, you must:
1. Log in as a Clinic Admin (a clinic staff role).
2. Open an existing order in the dashboard.
3. Click a "Copy Payment Link" button inside the order's side panel.
4. Paste the resulting URL into a new private/incognito tab.

You'll then verify the checkout page looks and behaves correctly.

═══════════════════════════════════════════════════════════════
WHY THIS TEST EXISTS (campaign-specific context)
═══════════════════════════════════════════════════════════════

<!-- CAMPAIGN: Replace this block with the campaign-specific context.
     Include:
       - Which PRs/commits motivate this smoke (links, SHAs)
       - What user-visible behavior could plausibly have regressed
       - Why CI doesn't cover this path (usually: live Stripe key,
         no test-mode keys per project_constraint_stripe_live_key_only.md)
     Format from the post-security-campaign smoke (PRs #59/#62/#64/#65):

     "Four dependency-security PRs merged today:
      - Next.js 16.2.4 → 16.2.6
      - postcss 8.4.31 → 8.5.15
      - Other transitive bumps (ws, qs, fast-uri)
      The CI test suite does NOT exercise the live Stripe Elements
      iframe. Your smoke is the only human-driven check before any
      investor or clinic demo."
-->

═══════════════════════════════════════════════════════════════
STEP 0 — SETUP
═══════════════════════════════════════════════════════════════

1. Open a brand-new **private/incognito window** in your browser.
   (Why private? Cached cookies from previous sessions could mask
   real bugs or trigger Stripe Link UI that should be suppressed.)

2. Open **DevTools** (F12 or Cmd+Opt+I on Mac).
   - Click the "Console" tab.
   - Set the filter to show "Errors" and "Warnings" only.
   - Keep DevTools open and pinned for the entire test.

3. Navigate to:
       https://functional-medicine-infrastructure.vercel.app

   You should land on the login page (URL becomes `/login`).
   If it doesn't redirect to /login, navigate manually to:
       https://functional-medicine-infrastructure.vercel.app/login

═══════════════════════════════════════════════════════════════
STEP 1 — LOG IN
═══════════════════════════════════════════════════════════════

You should now see a two-column login screen:

  ┌────────────────────────────┬─────────────────────────────┐
  │                            │                             │
  │  [DARK BLUE BACKGROUND]    │   Sign in                   │
  │                            │   Access your clinic dash.  │
  │  CompoundIQ                │                             │
  │  Compounding pharmacy      │   Email address             │
  │  order management          │   [                    ]    │
  │                            │                             │
  │  ✓ Automated pharmacy      │   Password                  │
  │    routing                 │   [                    ]    │
  │  ✓ Real-time order         │                             │
  │    tracking                │   [    Sign in    ]         │
  │  ✓ HIPAA-compliant         │                             │
  │    platform                │   🔒 HIPAA-compliant auth.  │
  │                            │                             │
  └────────────────────────────┴─────────────────────────────┘

(On a narrow window, the dark-blue panel may be hidden and only
the right form may show. That's expected mobile behavior.)

What to do:

a. Click the "Email address" input field.
b. Type exactly:    admin@sunrise-clinic.com
c. Click the "Password" input field.
d. Type exactly:    POCClinic2026!
e. Click the "Sign in" button.

What you should see next:

- The button changes to "Signing in…" with a spinner for ~1 sec.
- You are redirected to URL ending in `/dashboard`.
- You see a dashboard interface (described in Step 2).

If instead you see a red "Invalid email or password" error message:
- STOP. Do not guess passwords. Do not retry repeatedly.
- Report this as a CRITICAL finding: "Login failed for known POC
  credential admin@sunrise-clinic.com." Take a screenshot of the
  error message and end the test there.

═══════════════════════════════════════════════════════════════
STEP 2 — UNDERSTAND THE DASHBOARD
═══════════════════════════════════════════════════════════════

You're now on the Clinic Admin Dashboard. The URL should be:
       https://functional-medicine-infrastructure.vercel.app/dashboard

The page contains, from top to bottom:

1. A top navigation bar (logo, user menu).
2. A row of KPI cards (numbers like "TOTAL ORDERS", "AWAITING PAYMENT",
   "REVENUE MTD" — exact labels may vary).
3. A row of horizontal **tabs** labeled:
       All  |  Drafts  |  Awaiting Payment  |  Submitting  |
       Processing  |  Shipped  |  Errors
   Each tab has a number badge next to its name (e.g., "All 28").
4. Below the tabs, a table of orders with columns:
       Order #  |  Patient  |  Medication  |  Status  |
       Method  |  Created  |  Updated
   Each row is a clickable order.

CONSOLE CHECK: Look at the DevTools Console tab right now.
- Expected: Some Next.js dev or info messages (acceptable).
- NOT expected: red "Hydration failed" errors, uncaught JavaScript
  exceptions, or React error boundaries.
- If you see any red errors, screenshot them and note the exact
  text. You'll include them in your final report.

═══════════════════════════════════════════════════════════════
STEP 3 — FIND AN ORDER THAT CAN GENERATE A CHECKOUT LINK
═══════════════════════════════════════════════════════════════

Click the **"Awaiting Payment"** tab (the third tab from the left).
The table will refilter to show only orders where the patient has
not yet paid.

You should see at least one order row. Each row's "Status" column
will show a colored badge with text like "AWAITING PAYMENT" or
"PAYMENT EXPIRED".

If the table is EMPTY (no rows shown after clicking the tab):
- Click the "All" tab and look for any order whose Status column
  shows "AWAITING PAYMENT" or "PAYMENT EXPIRED".
- If you find NONE in the entire table:
  STOP. Report this as HIGH severity: "No orders in
  AWAITING_PAYMENT or PAYMENT_EXPIRED state — cannot generate
  a live checkout link to test." Do NOT attempt to seed test data.
  Do NOT navigate to any `/ops/demo-tools` page even if you see
  it in a menu. End the test there.

If you do see at least one such order:
- Click anywhere on the first such order's **row** (anywhere except
  on the Order # link if there is one).

What you should see next:

- A **side panel slides in from the right** of the screen,
  covering roughly the right half of the viewport.
- It has an "✕" close button in the top-right corner.
- Near the top of the panel, you should see a GREEN/EMERALD card
  containing:
    - A bold header: either "Ready for Patient Payment" or
      "Payment Link Expired" (depending on the order's exact state).
    - A short description paragraph.
    - A **green button** labeled "Copy Payment Link" (or
      "Regenerate Payment Link" if the link is expired).

If the side panel does NOT open, or it opens but you don't see
the green Copy Payment Link card:
- Make sure the order you clicked actually has "AWAITING PAYMENT"
  or "PAYMENT EXPIRED" status (look at its Status badge).
- If the panel opens but shows other content (like a "Review &
  Sign" amber card or a "Tracking" section), close it and click
  a different AWAITING-PAYMENT order.
- If no order works, report as HIGH severity and end test.

═══════════════════════════════════════════════════════════════
STEP 4 — COPY THE PAYMENT LINK
═══════════════════════════════════════════════════════════════

Click the green "Copy Payment Link" (or "Regenerate Payment Link")
button.

What you should see:

EITHER:
- A small toast notification appears (usually top-right or bottom),
  reading: "Payment link copied · valid for 72 hours"
- The link is now in your clipboard.
- To get the actual URL string, paste it somewhere visible
  (e.g., into a new browser tab's address bar — but don't press
  Enter yet — or into a temporary text editor).

OR (if the browser blocked clipboard access):
- A new card appears below the green card, titled "Copy the link
  manually", containing a textarea with the full URL written in it.
- You can manually select-all the textarea content (Ctrl/Cmd+A)
  and read the URL directly.

CAPTURE the URL. It should look like:
   https://functional-medicine-infrastructure.vercel.app/checkout/<long-token-string>

The token is a long base64-style string of letters and digits
(typically 100-300 chars). You'll need the whole URL for Step 5.

═══════════════════════════════════════════════════════════════
STEP 5 — OPEN THE CHECKOUT PAGE IN A NEW INCOGNITO TAB
═══════════════════════════════════════════════════════════════

Open a **new private/incognito tab** (Ctrl/Cmd+Shift+N opens a
new private window if needed). The new tab must NOT inherit your
logged-in session — the checkout page is a public, patient-facing
page that should work without any login.

Paste the URL into the address bar. Press Enter.

The page should load within ~3 seconds. The URL stays on
`/checkout/<token>` (no redirect to /login, no redirect to
/checkout/expired, no 404, no "Application error" screen).

═══════════════════════════════════════════════════════════════
STEP 6 — INSPECT THE CHECKOUT PAGE
═══════════════════════════════════════════════════════════════

For EACH item below: do the action, observe carefully, and write
down what you saw. Do not skip items. Do not assume.

────────────────────────────────────────────────────────────────
6A — PAGE LOADS AT ALL
────────────────────────────────────────────────────────────────
Action: Look at the page.
Expect: A full checkout page renders (NOT a white screen, NOT an
        error page, NOT a redirect).
Capture: Take a full-page screenshot.

────────────────────────────────────────────────────────────────
6B — CONSOLE IS CLEAN
────────────────────────────────────────────────────────────────
Action: Look at the DevTools Console tab in the new incognito tab.
Expect — acceptable (do NOT flag):
   - Messages from Stripe about iframe loading.
   - "CSP" warnings from Stripe (their iframe sets its own policy).
   - Generic Next.js info logs.
Expect — would be a finding:
   - Red "Hydration failed because the initial UI does not match
     what was rendered on the server" → MEDIUM finding.
   - Any uncaught JavaScript exception → HIGH finding.
   - HTTP 500 responses in the Network tab (other than Stripe
     telemetry pings) → HIGH finding.

Capture: Screenshot of console, and copy-paste any red error text.

────────────────────────────────────────────────────────────────
6C — STICKY HEADER AT THE TOP
────────────────────────────────────────────────────────────────
Action: Look at the very top of the page.
Expect: A horizontal bar (a "header") that stays in place when you
        scroll. It contains:
        - "CompoundIQ" text or logo on the LEFT.
        - A clinic name on the RIGHT (most likely "Sunrise Clinic").
Action: Scroll down 200 pixels.
Expect: The header remains visible (sticky). The content underneath
        may show a slight blur effect through the header background.

────────────────────────────────────────────────────────────────
6D — ORDER SUMMARY CARD (CRITICAL — PHI CHECK)
────────────────────────────────────────────────────────────────
Action: Look at the visible content below the header — should be
        a "card" (rounded box with light background) showing the
        order details.
Expect: A large dollar amount (~32px font), like "$245.67".
        A label like "Amount due".
        A short order description line.

CRITICAL CHECK — the description must NOT contain:
   - Any patient's first or last name
   - Any specific medication name (e.g., "testosterone cypionate
     200mg/ml" would be PHI)
   - Any diagnosis or condition
   - Anything that looks like personal health information

Acceptable description text: generic strings like:
   - "Compounded prescription"
   - "Prescription order"
   - "Pharmacy order #XYZ123" (an opaque order number is fine)

If you see ANY apparent PHI on this patient-facing page, that's a
CRITICAL finding — screenshot, copy the exact text, and tag it
"PHI on patient-facing checkout".

────────────────────────────────────────────────────────────────
6E — RECEIPT EMAIL FIELD
────────────────────────────────────────────────────────────────
Action: Look for a text input asking for an email address (this is
        where Stripe will send the auto-receipt).
Expect: An input field, type="email", with a label like
        "Email for receipt" or similar.
Action: Do NOT type into it. Just confirm it exists.

────────────────────────────────────────────────────────────────
6F — STRIPE PAYMENTELEMENT IFRAME (THE MAIN CHECK)
────────────────────────────────────────────────────────────────
This is the core thing a dependency campaign could have broken.

Action: Look for a card-collection UI — fields for credit card
        number, expiration date, CVC, and ZIP/postal code.
Expect: The fields render inside a Stripe iframe. You can confirm
        it's an iframe by right-clicking it → "Inspect" — the
        DevTools should show an `<iframe>` element whose `src`
        starts with one of:
              https://js.stripe.com/
              https://hooks.stripe.com/
              https://m.stripe.network/

Wait 5 seconds. The iframe must FULLY render — not stay blank,
not show an infinite loading spinner, not display "An error
occurred" or "Failed to load payment form".

If the iframe doesn't render within 10 seconds → HIGH finding.
If it shows an explicit error message → HIGH finding, capture text.

────────────────────────────────────────────────────────────────
6G — NO STRIPE LINK PANEL (REGRESSION CHECK)
────────────────────────────────────────────────────────────────
Stripe's "Link" is a saved-payments-method UX. Some Stripe-powered
checkouts show a "Pay with Link" banner at the top of the payment
form, prompting users to log into Stripe Link. THIS PRODUCT HAS
EXPLICITLY DISABLED LINK. You must verify Link is NOT visible.

Action: Look at the entire checkout area above and around the
        card-input iframe. Look for:
        - Any text saying "Link" or "Pay with Link" or "Pay faster"
        - Any phone-number input above the card fields
        - Any "Continue with Link" button
        - Any "Save with Link" checkbox
        - Any Stripe Link logo (a small lightning-bolt L icon)

Expect: NONE of the above. Just the plain card fields.

If you see ANY Link affordance, that's a HIGH finding —
the suppression broke. Screenshot it and copy the visible text.

────────────────────────────────────────────────────────────────
6H — TRUST BADGES
────────────────────────────────────────────────────────────────
Action: Scroll to below the card-fields area.
Expect: Small badge text like "🔒 256-bit TLS" and "⚡ Stripe" or
        similar trust signals.
Do NOT expect: a "HIPAA-compliant" badge here — it was intentionally
        omitted on this patient-facing page. Its absence is NOT a
        finding.

────────────────────────────────────────────────────────────────
6I — PAY BUTTON BEHAVIOR (DO NOT CLICK PAY)
────────────────────────────────────────────────────────────────
Action: Find the "Pay" button — typically at the bottom of the
        form. It usually shows the dollar amount, e.g.,
        "Pay $245.67".
First-state: When the page first loads, this button may be
        disabled (greyed out, not clickable) until Stripe Elements
        reports ready.

Action: Inside the card-input iframe, type these test values
        (Stripe's universal test card identifier — does NOT charge):
              Card number: 4242 4242 4242 4242
              Expiry:      12 / 34
              CVC:         123
              ZIP:         12345

After typing, click outside the iframe (or Tab to next field) so
the iframe validates the input.

Observe the Pay button:
Expect: It transitions from disabled to ENABLED (it becomes
        clickable, full color, no longer greyed out).

⚠️ **DO NOT CLICK THE PAY BUTTON.** ⚠️
This product uses a LIVE Stripe key (not test mode). Clicking
Pay would attempt a real charge. The fact that the button
**becomes enabled** with valid test input is your PASS signal —
that's all you need to verify.

If the button stays disabled even with valid test data → HIGH
finding.

────────────────────────────────────────────────────────────────
6J — FINAL CONSOLE SWEEP
────────────────────────────────────────────────────────────────
Action: Re-check the Console tab. Has anything new shown up?
Capture: Screenshot any new errors/warnings.

═══════════════════════════════════════════════════════════════
STEP 7 — EXPIRED-LINK PATH
═══════════════════════════════════════════════════════════════

Action 1: In the same incognito tab, navigate to:
              https://functional-medicine-infrastructure.vercel.app/checkout/expired
Expect: A page renders gracefully (NOT a 500 error, NOT a blank
        screen). It should say something like "This payment link
        has expired" or similar.
Capture: Screenshot.

Action 2: Navigate to:
              https://functional-medicine-infrastructure.vercel.app/checkout/this-is-not-a-real-token-12345
Expect: The page should handle the bad token gracefully —
        either redirect to /checkout/expired, OR show an inline
        "invalid link" message. NOT a crash, NOT a 500 error.
Capture: Screenshot.

<!-- CAMPAIGN: If this campaign motivates additional targeted
     checks beyond the generic 6A–6J + Step 7, list them here as
     additional numbered steps (Step 8, Step 9…). Each should have:
       - Action (literal)
       - Expect (literal)
       - Severity if it fails (CRITICAL / HIGH / MEDIUM / LOW)
     Example for a Stripe SDK bump:
       "Step 8 — Verify SDK version in window.Stripe.VERSION
          Action: In the DevTools Console, run `Stripe.VERSION`.
          Expect: A string starting with '7.' (or whatever this
                  campaign upgraded to).
          Severity if mismatch: MEDIUM."
-->

═══════════════════════════════════════════════════════════════
HARD CONSTRAINTS — RULES YOU MUST FOLLOW
═══════════════════════════════════════════════════════════════

1. **NEVER click the Stripe Pay button.** Live key, real money.
2. **NEVER seed test data.** Do not create orders, save drafts,
   add favorites, or click any "Refresh Demo Data" button.
3. **NEVER navigate to `/ops/demo-tools` or any URL containing
   "demo-tools"** even if you discover it in a menu.
4. **NEVER change passwords or clinic settings.**
5. **NEVER log into the Ops Dashboard or any other role.**
   Clinic Admin is the only role required.
6. **NEVER use a preview/staging URL.** Only the production URL
   `functional-medicine-infrastructure.vercel.app` (no subdomain
   prefixes like `*-htwe5fe7t.vercel.app` — those are preview deploys).
7. **Out of scope:** any page besides login, dashboard, the order
   drawer, /checkout/<token>, /checkout/expired. Do not click
   "New Prescription", do not browse /settings, do not poke at
   anything else.

═══════════════════════════════════════════════════════════════
VERIFY-BEFORE-REPORT — REDUCE FALSE POSITIVES
═══════════════════════════════════════════════════════════════

Before flagging anything as a finding, ask yourself:

- Is the discrepancy "the page shows different data than I
  expected" (an order count, a dollar amount, a clinic name)?
  → That's data-driven, not a regression. NARRATE in observations,
    do NOT flag.

- Is the discrepancy "I see a Stripe iframe warning in the console"?
  → Stripe iframes always log diagnostic chatter. NARRATE, do not flag.

- Is the discrepancy "the KPI card on the dashboard shows a
  different number than the tab badge"?
  → INTENTIONAL — KPI cards count month-to-date, tabs count all-time.
    DO NOT flag.

Only flag if the discrepancy is STRUCTURALLY wrong:
- A required element is missing
- Layout is broken (text overflowing, buttons unclickable)
- A JavaScript exception is thrown
- A regression of an explicit rule (Stripe Link visible, PHI on
  patient page, console hydration errors)

═══════════════════════════════════════════════════════════════
SEVERITY SCALE
═══════════════════════════════════════════════════════════════

CRITICAL — page doesn't load, PHI visible to patient, login broken,
           real charge accidentally created (this MUST NOT happen).
HIGH —     Stripe iframe doesn't render, Link panel visible,
           Pay button never enables with valid input, JS exception,
           expired-link page crashes.
MEDIUM —   hydration warning, visible style regression, broken
           wording.
LOW —      console warnings that don't break visible behavior,
           minor polish issues.

═══════════════════════════════════════════════════════════════
REPORTING FORMAT
═══════════════════════════════════════════════════════════════

When done, output a report in EXACTLY this structure:

```
## Production Checkout Smoke Report

### Verdict
ONE OF: PASS / PASS-WITH-OBSERVATIONS / BLOCKING ISSUES

### Environment
- Browser + version:
- Date/time of test:
- Checkout URL captured (token redacted, just show first 12 chars):

### Step-by-step results
- Step 0 (setup): ...
- Step 1 (login): PASS / FAIL — what you observed
- Step 2 (dashboard loaded + console check): ...
- Step 3 (found AWAITING_PAYMENT order + opened drawer): ...
- Step 4 (copy payment link): ...
- Step 5 (open checkout in incognito): ...
- Step 6A — Page loads: ...
- Step 6B — Console clean: ...
- Step 6C — Sticky header: ...
- Step 6D — Order summary, no PHI: ...
- Step 6E — Receipt email field: ...
- Step 6F — Stripe PaymentElement iframe: ...
- Step 6G — No Stripe Link panel: ...
- Step 6H — Trust badges: ...
- Step 6I — Pay button enables with test card: ...
- Step 6J — Final console sweep: ...
- Step 7 (expired-link path): ...

### Findings (most severe first)

#### [SEVERITY] Short title
- **Where:** Step X (Phase Y), URL: ...
- **What you saw:** (literal text or screenshot)
- **What was expected:** (per this prompt)
- **Reproduction:** 1. ... 2. ... 3. ...
- **Screenshot:** attached

(Repeat for every finding. If none, write "No findings.")

### Bonus observations
(Anything you noticed that wasn't in the prompt — wording,
performance, mobile responsiveness, things you decided NOT to
flag per the verify-before-report rule.)

### Recommendation
ONE OF:
- "SAFE TO DEMO" (clear PASS, no findings above MEDIUM)
- "DEMO WITH CAVEATS" (MEDIUM findings; list workaround)
- "DO NOT DEMO" (HIGH or CRITICAL findings; fix required first)
```

=== PROMPT END ===
```

---

## Maintenance

When a campaign smoke produces a new false-positive class:

1. **If the false-positive is checkout-specific** (Stripe iframe behavior, /checkout/[token] rendering, etc.), add a new entry to the "verify-before-report" section above so subsequent smokes inherit the suppression.

2. **If the false-positive overlaps with the full walkthrough's coverage** (e.g., dashboard KPI vs tab badge), add it to both `walkthrough-prompt-base.md` AND this file so both reuse paths inherit.

3. **If a campaign required a brand-new check** (e.g., a new Stripe SDK version surfaced a new failure mode worth checking every time), promote that check from the campaign-specific delta into Step 6 of the base prompt so future campaigns inherit it.

## Related

- [`walkthrough-prompt-base.md`](walkthrough-prompt-base.md) — full end-to-end walkthrough template; this file is the focused-smoke cousin
- `docs/qa-reports/qa-checkout-smoke-{campaign-tag}-prompt.md` — campaign-specific instances
- `docs/qa-reports/qa-checkout-smoke-{campaign-tag}-report.md` — agent-produced reports per campaign
- POC credentials live in [`docs/archive/source/POC-DEMO-QUICKSTART.md`](../archive/source/POC-DEMO-QUICKSTART.md) — verify before each campaign in case they've drifted

## Provenance

First version drafted 2026-05-27 after the security campaign (PRs #59 axios, #62 Next 16.2.6, #64 transitive overrides, #65 overrides dedupe) closed with `npm audit` reading 0 and Codex pass 2 PASS. The Codex demo-readiness gate (live Stripe Elements not in CI) motivated the smoke; the user's critique that the first draft assumed product literacy motivated the literal step-by-step rewrite.
