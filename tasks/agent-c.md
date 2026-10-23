task-id: C-2026-10-23-03
status: ready
---
PR #248 (your branch `lauren-polish-oct23`, now head 296e18c with main merged) failed E2E on one test, all 3 attempts:

`e2e/clinic-app.spec.ts:2160` "Clinic App, WO-102: shipping once per pharmacy per order > when re-routing would change a medication price, the notice says so with the net and offers no losing re-route", at line 2165:
  Locator: getByTestId('multi-pharmacy-message')
  Expected: "2 pharmacies → 2 shipping charges ($34.00). Routing all to Test Pharmacy Tier4 would save $9.00 on $11.00 more overall, so it is not suggested."
  Received starts: "2 pharmacies → 2 shipping charges ($34.00). Routing all to Test Pharmacy Tier4 would save $9.00 on ..." (the rest differs; most likely your em-dash rewrite of this message produced different wording than the spec expects).

1. `git fetch origin && git merge origin/lauren-polish-oct23` (I updated it from main) so you are on 296e18c.
2. Find the multi-pharmacy message's source and make the on-screen copy and the E2E expectation agree, with no em dash. Keep the meaning: says the saving, says the extra cost overall, says it is not suggested.
3. Check every other E2E `toHaveText`/`getByText` that matches copy you changed for the same kind of mismatch (exact strings, not regexes), and fix them in the same commit.
4. Lint, tsc, Jest, build green. Push. Put the full report (head SHA, what the message now says, any other specs fixed) in the body of your final commit message.
