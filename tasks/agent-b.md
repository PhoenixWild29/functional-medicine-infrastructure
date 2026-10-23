task-id: B-2026-10-23-03
status: ready
---
CI: the E2E job's "Install Playwright OS dependencies" step (`npx playwright install-deps`) hung on an apt download twice today (#247 at 16:14Z, #248 at 18:17Z), ran to the job's 30-minute cap and cancelled the job before any test ran.

On a new branch `ci-install-deps-timeout` from origin/main, in `.github/workflows/ci.yml` only:
1. Give that step `timeout-minutes: 6`.
2. Make it retry: run the install up to 3 times, each attempt wrapped in `timeout 300` (5 minutes), with a short sleep between attempts, and fail the step only if all 3 fail. Keep using the same command and the same browsers/deps; change nothing else in the workflow.
3. Add a one-line comment saying why (apt mirror hangs, Oct 23 2026).
4. No app code, no tests needed beyond YAML being valid; run `npx --yes yaml-lint .github/workflows/ci.yml` or equivalent if available, otherwise check with a YAML parser in node.
5. Push the branch. Do not open a PR. Put the full report (head SHA, the new step text) in the body of your commit message.
