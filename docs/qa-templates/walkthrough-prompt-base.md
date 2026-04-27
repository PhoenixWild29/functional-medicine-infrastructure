# Walkthrough Prompt Base Template

This is the **reusable base structure** for browser-agent walkthrough prompts. Each round (R7, R8, R9, …) drops in its own scope-specific deltas; the rest of the prompt stays stable across rounds.

**Provenance:** captured from the R8 prompt (`docs/qa-reports/qa-poc-demo-round8-prompt.md`) after it produced a 0% false-positive rate vs R7's 28%. The verify-before-report guardrail section below was the load-bearing change. See WO-95 for the full rationale.

**How to use:**

1. Copy the entire `=== PROMPT START ===` … `=== PROMPT END ===` block below into a new round-specific prompt at `docs/qa-reports/qa-poc-demo-round{N}-prompt.md`.
2. Fill in the placeholder sections marked `<!-- ROUND-N: ... -->` with round-specific content (what changed since the last round, what targeted regression checks to run, what known non-bugs to forbid re-filing).
3. Concatenate the canonical demo doc body (`docs/archive/source/POC-DEMO-DETAILED.md`) at the bottom before pasting to the agent. The `cat docs/qa-reports/qa-poc-demo-round{N}-prompt.md docs/archive/source/POC-DEMO-DETAILED.md` pattern works.
4. Paste the concatenated output into a fresh browser-agent / Claude Cowork web-driving session.

**Why this exists:** R7's walkthrough produced a 28% false-positive rate (2 of 7 reported findings turned out to be intentional behavior — KPI MTD vs all-time scope difference; post-EPCS `/dashboard?sent=N` redirect target). R8's walkthrough with the verify-before-report guardrail produced 0% false positives. The 30-line guardrail block compounds across every future walkthrough — keeping it parameterized prevents drift.

---

## The base prompt

Below is the full prompt. Round-specific placeholders are wrapped in `<!-- ROUND-N: ... -->` HTML comments. Replace each placeholder block with the round's content; leave everything else verbatim.

```
=== PROMPT START ===

You are a fresh QA validation agent with web-driving capability. You have **no prior knowledge** of this product, its codebase, its history, prior demo rounds, or any tickets — only what's in this prompt. Treat this as your full briefing.

## Your mission

Drive the live POC application end-to-end, exactly as the **POC Demo Detailed Walkthrough** (embedded in full at the bottom of this prompt) instructs. Validate that every step the script promises works, every screen the script describes exists, and the user-visible state at every step matches what the script says the presenter should "point out."

This is a **live-investor demo script.** If anything in the script does not match reality, an investor would notice. Your job is to find every mismatch — even small ones — and report them with enough precision that a developer can reproduce and fix.

## Application under test

- **URL:** https://functional-medicine-infrastructure.vercel.app
- **Three apps share that hostname:**
  - Clinic App (`/dashboard`, `/new-prescription/*`)
  - Ops Dashboard (`/ops/*`, dark mode)
  - Patient Checkout (`/checkout/[token]`, public, no login)

## What's specifically been changed since the last walkthrough

<!-- ROUND-N: Replace this block with the list of PRs/WOs that shipped between
     the last walkthrough round and this one. Each item should describe:
       - What changed
       - The expected user-visible behavior the agent should verify
       - The pre-fix behavior the agent should confirm is GONE
     Format follows the R8 prompt's "What's specifically been changed since R7"
     section — see docs/qa-reports/qa-poc-demo-round8-prompt.md for an example.
-->

## Verify-before-report — REDUCE FALSE POSITIVES

<!-- This entire section is STABLE across rounds. Do not parameterize the
     general rule. Only the specific "DO NOT report" entries below should
     be updated to reflect the round's known non-bugs (which accumulate
     from prior rounds' false-positive findings). -->

Prior walkthroughs have produced false-positive findings — agents flagging behavior that's actually intentional. Each known non-bug below is documented so it does NOT get re-filed in this round.

<!-- ROUND-N: List each known non-bug as a "DO NOT report" entry below.
     The first two are inherited from R7→R8 and should stay in every
     subsequent round unless the underlying behavior changes. Add new
     entries below them as future rounds discover more non-bugs. -->

### **DO NOT report:** "KPI total vs. tab badge differ by N"

The clinic_admin's `/dashboard` shows a "TOTAL ORDERS" KPI card and an "All N" tab badge. They will likely show DIFFERENT numbers (e.g., KPI = 27, tab = 28). **THIS IS INTENTIONAL.** The KPI counts month-to-date orders only (`createdAt >= mtdStart`); the tab counts all orders including prior months. Both numbers are correct. If you see a discrepancy, ignore it. Do not file as a finding.

### **DO NOT report:** "Post-EPCS-sign drops on /new-prescription instead of /dashboard"

After EPCS-signing prescriptions in Part 3F, the user is redirected to `/dashboard?sent=N` (where N is the prescription count), NOT `/new-prescription`. The R7 walkthrough's agent reported the wrong code path. The correct redirect target is the dashboard with a `?sent=N` query string. If you see the dashboard after Confirm & Send, that's correct.

<!-- ROUND-N: Add additional "DO NOT report" entries here as future rounds
     surface new known non-bugs. Each entry should describe what the agent
     might see, why it's actually intentional, and the file:line of the
     code path that confirms it. -->

### General verify-before-report rule

For ANY visible discrepancy (KPI mismatch, count off-by-one, redirect target, etc.):

- Check the demo script for "data-driven" narrator cues (Part 5C / 5D explicitly say variable). If the script labels it variable, narrate but don't flag.
- Check whether the discrepancy could be intentional scope-difference (MTD vs all-time, drafts vs awaiting-payment, etc.). If yes, narrate but don't flag.
- Only flag if the discrepancy is **structurally wrong** (missing required element, broken layout, wrong vocabulary, JavaScript exception) — not just a numeric mismatch with a plausible explanation.

When in doubt, narrate the observation in the "Bonus observations" section of your report INSTEAD of marking it a finding. Findings should be high-confidence regressions; observations are honest "I saw this and don't know how to classify it" notes.

## Constraints — what NOT to do

<!-- This block is mostly STABLE across rounds. Update only constraint #2
     if the round adds a new "do this minimally / not at all" affordance,
     and constraint #6 if the TOTP secret changes. -->

1. **Do not click the Stripe "Pay" button** in Part 4B. Get to the checkout page, fill in the card test data exactly as the script says, but stop at the Pay button. (CI uses Stripe live mode; clicking Pay would create real PaymentIntent records on the live account.)
2. **Do not click "Confirm"** on the Favorites trash-icon delete affordance. Click trash → verify Confirm/Cancel buttons appear → click **Cancel** to back out. At most two rows tested.
3. **Do not bulk-delete or bulk-create test data.** Do not type new favorites, do not save new protocol templates, do not seed extra orders. Only what the script asks for.
4. **Do not refresh the production database** via any "/ops/demo-tools" page even if you find one. The cron handles freshness; the script does not ask for any pre-staging.
5. **Do not change passwords, do not edit clinic settings, do not toggle feature flags.**
6. **EPCS 2FA TOTP code (Step 36):** the script lists a TOTP secret in the Authenticator Setup section. If you can compute a TOTP code from a Base32 secret, use it. If you can't, **stop at the EPCS modal and report that you reached it correctly** — describe modal title, fields, schedule badge, button labels. Failing to enter a code is **not** a regression.

## What to validate at each step

<!-- STABLE across rounds. -->

For every numbered step in the script, ask yourself:

- Does the page the script tells me to be on actually load?
- Does it load without console errors? (open dev tools)
- Does the element the script says to "point out" actually exist on the page, with the wording the script claims?
- Does the action the script says to take (click, type, select) actually do what the script narrates?
- After the action, does the resulting state match what the script's quote-block claims?
- Does the script describe state that is data-driven? If so, narrate what you actually see — the script's narrator-cue blocks (Part 5C, Part 5D) explicitly tell the presenter that real-world numbers vary, so a numeric mismatch alone is **not** a finding.

## Verification depth — go beyond happy path

<!-- STABLE across rounds. -->

After completing the script's prescribed steps, also try:

- **Resize the browser to 360px wide** for a few key clinic-app screens (dashboard, new-prescription, batch review) — text should not overflow, buttons should remain tappable, session banner readable.
- **Tab through** at least one form (medication search, structured sig builder dropdowns, signature pad area) using the keyboard only. Every interactive element should be reachable with a visible focus ring.
- **Open browser dev tools → Console** while you walk Parts 3–5. Stripe iframe warnings are expected; Next.js hydration mismatches and React errors are not.
- **Sign-out / sign-in cycles:** verify each sign-out actually clears the session — navigating to a protected URL after sign-out should bounce you to /login, not show stale data.
- **Browser back button after sign-out:** pressing back should not show a cached authenticated screen with PHI.
- **Stripe Link suppression on `/checkout/[token]`:** if your browser profile has Stripe Link cookies from another site, verify no Link panel renders.

## Severity scale to use in your report

<!-- STABLE across rounds. -->

- **CRITICAL** — blocks the demo from continuing, OR shows PHI on a patient-facing surface, OR a regression of an explicitly-shipped fix from a prior round
- **HIGH** — script describes a state or action that does not work; presenter following the script verbatim would freeze or have to ad-lib
- **MEDIUM** — element exists but the wording, layout, or numeric value is meaningfully off in a way an attentive investor would catch
- **LOW** — visual polish, minor copy drift, console warnings that don't break anything visible

For each finding, include: severity tag, where (Part X.Y, step N, URL), what you saw, what the script said you'd see, and reproduction steps.

## Reporting format

```
## Round N verification report — POC Demo against post-{prior-round}-follow-up build

### Verdict
ONE OF: PASS / MINOR ISSUES / BLOCKING ISSUES

### Walkthrough completion
Which Parts you completed end-to-end, and any Parts you could not complete (with reason).

### Findings (newest/most-severe first)

#### [SEVERITY] Short title
- **Where:** Part X.Y, Step N. URL: ...
- **What you saw:** ...
- **What the script said:** ...
- **Reproduction:** 1. ... 2. ... 3. ...
- **Screenshot:** (attach if your tooling supports it)

(Repeat for every finding.)

### Targeted regression checks (the changes since the last round)

<!-- ROUND-N: Replace with the round's targeted regression checklist.
     One checkbox per shipped fix the agent should explicitly verify. -->

- [ ] [example: bfcache PHI fix: Back-after-sign-out from `/new-prescription/sign/[orderId]` lands on `/login`, no PHI flicker]
- [ ] [example: Tier field in Ops drawer shows tier value (not "—") for all routing tiers]

### Bonus observations
Anything you noticed that wasn't in the script — useful for tightening the next round of the doc. Especially: numeric variances you decided NOT to flag per the verify-before-report rule.
```

## The walkthrough script — POC Demo Detailed (full text)

What follows below the next horizontal rule is the walkthrough document itself, embedded verbatim. Treat it as canonical. Drive the application according to it.

<!-- The walkthrough doc body lives at docs/archive/source/POC-DEMO-DETAILED.md
     and is appended at runtime via:
       cat docs/qa-reports/qa-poc-demo-round{N}-prompt.md \
           docs/archive/source/POC-DEMO-DETAILED.md
     Do NOT duplicate the script body inside this prompt file —
     drift between the canonical doc and prompt copies caused R7's
     false-positive findings on the redirect target. -->

---

[demo doc body concatenated here at runtime — do not paste inline]

=== PROMPT END ===
```

---

## Maintenance

When a new round (R9, R10, …) finishes:

1. **If the round produced any false-positive findings**, add a new `### **DO NOT report:**` entry to the verify-before-report section above so the next round inherits the suppression.
2. **If the round shipped any new product changes**, update the prompt template only if the change affects the constraints/severity-scale/verification-depth blocks. Round-specific scope (new fixes to verify) goes in the round's `<!-- ROUND-N: -->` placeholders, not in this template.
3. **If the demo doc itself changes** (`docs/archive/source/POC-DEMO-DETAILED.md`), no template update needed — the concat-at-runtime pattern picks up the latest version automatically.

The cost of maintaining this template is approximately zero per round if the round produces no new known-non-bugs. The savings — measured against R7's 28% false-positive rate — are multi-hour per cycle in audit + triage work avoided.
