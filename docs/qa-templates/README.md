# QA Walkthrough Templates

Reusable prompt structures for browser-agent walkthroughs of the live POC.

## Files

| File | Purpose |
|------|---------|
| [`walkthrough-prompt-base.md`](walkthrough-prompt-base.md) | Stable base template for round-N full end-to-end walkthrough prompts (R7, R8, R9…). Includes the verify-before-report guardrail that dropped R7's 28% false-positive rate to R8's 0%. |
| [`checkout-smoke-prompt-base.md`](checkout-smoke-prompt-base.md) | Focused **patient-checkout smoke** template for dependency campaigns and Stripe-touching PRs. ~10-minute scope: log in as Clinic Admin → copy payment link → inspect `/checkout/[token]`. Use this when you need a fast human-driven gate that CI doesn't cover (live Stripe Elements). |

## Which template to use

| Trigger | Template |
|---------|----------|
| Major monthly release round, multi-role behavior changed | `walkthrough-prompt-base.md` |
| Dependency campaign (Next/Stripe/postcss/CSP), checkout-touching PR, pre-demo gate flagged by reviewer | `checkout-smoke-prompt-base.md` |
| Both apply | Run the smoke first; if PASS, schedule the full walkthrough at the next cadence point |

## How to start a new walkthrough round

1. **Copy the base template's `=== PROMPT START ===` … `=== PROMPT END ===` block** into a new round-specific file at `docs/qa-reports/qa-poc-demo-round{N}-prompt.md`.

2. **Fill in the round-N placeholders** (HTML comments marked `<!-- ROUND-N: ... -->`):
   - "What's specifically been changed since the last walkthrough" — list the PRs/WOs that shipped in the prior cycle and the user-visible behavior the agent should verify.
   - "Targeted regression checks" — one checkbox per shipped fix the agent should explicitly verify in the report.

3. **Inherit the existing "DO NOT report" entries** from the template. These are accumulated false-positive suppressions from prior rounds. If the round surfaces new false positives, add a new entry to the template (not the round-specific prompt) so the next round inherits it.

4. **Concatenate the canonical demo doc body** before pasting to the agent:
   ```bash
   cat docs/qa-reports/qa-poc-demo-round{N}-prompt.md \
       docs/archive/source/POC-DEMO-DETAILED.md
   ```
   Do NOT duplicate the demo doc body inside the prompt file — drift between the canonical doc and prompt copies caused R7's false-positive findings on the redirect target.

## How to update the template after a round

If a round produced false-positive findings, add a new `### **DO NOT report:**` entry to the template's verify-before-report section so subsequent rounds inherit the suppression. Update notes are tracked in `STATUS.md` per-session.

If the round did NOT produce false positives, no template update needed — the cost of maintenance is approximately zero per round when the guardrail keeps working.

## Why this template exists

R7's walkthrough produced 7 reported findings, of which 2 turned out to be intentional behavior (KPI MTD vs all-time scope difference; post-EPCS `/dashboard?sent=N` redirect target). 28% false-positive rate.

R8's walkthrough used the same prompt structure but added an explicit verify-before-report guardrail forbidding the two known non-bugs and adding a general "narrate-as-observation when in doubt" rule. R8 produced 1 LOW finding + 1 observation, both legitimate. 0% false-positive rate.

The 30-line guardrail block compounds across every future walkthrough cycle. Capturing it in a template prevents drift, prevents re-derivation cost, and prevents regression of the false-positive suppression.

WO-95 (filed in MCP, HIGH priority) tracks this template. See the WO description for the full rationale and acceptance criteria.

## Related

- `docs/archive/source/POC-DEMO-DETAILED.md` — canonical demo doc body, concat'd at prompt-assembly time
- `docs/qa-reports/` — round-specific prompt files + walkthrough reports
- `STATUS.md` — campaign + round outcomes
