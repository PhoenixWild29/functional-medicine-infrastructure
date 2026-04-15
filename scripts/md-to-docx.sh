#!/usr/bin/env bash
# ============================================================
# md-to-docx.sh — regenerate Word (.docx) versions of all
# investor/demo/launch-kit markdown docs using pandoc.
# ============================================================
#
# Usage:  npm run docs:docx
#
# Requires: pandoc installed on PATH. Install once:
#   scoop install pandoc    (Windows)
#   brew install pandoc     (macOS)
#   apt install pandoc      (Linux)
#
# Output: one .docx per listed .md, written alongside the source.

set -euo pipefail

# Add scoop shims to PATH if pandoc isn't already there (Windows).
if ! command -v pandoc >/dev/null 2>&1; then
  export PATH="$HOME/scoop/shims:$PATH"
fi

if ! command -v pandoc >/dev/null 2>&1; then
  echo "❌ pandoc not found. Install it first:"
  echo "   Windows: scoop install pandoc"
  echo "   macOS:   brew install pandoc"
  echo "   Linux:   apt install pandoc"
  exit 1
fi

DOCS=(
  "docs/BUSINESS-ACTION-PLAN"
  "docs/CLINIC-ONBOARDING-PLAYBOOK"
  "docs/COMPOUNDIQ-EXECUTIVE-OVERVIEW"
  "docs/INVESTMENT-STRATEGY-MEMO"
  "docs/PHARMACY-INTEGRATION-GUIDE"
  "docs/POC-DEMO-DETAILED"
  "docs/POC-DEMO-QUICKSTART"
  "docs/SYSTEM-ARCHITECTURE-OVERVIEW"
  "docs/launch-kit/README"
  "docs/launch-kit/clinic-outreach-email"
  "docs/launch-kit/pharmacy-outreach-email"
  "docs/launch-kit/legitscript-application-checklist"
  "docs/launch-kit/design-partner-agreement"
)

for doc in "${DOCS[@]}"; do
  if [[ -f "${doc}.md" ]]; then
    pandoc "${doc}.md" -o "${doc}.docx"
    echo "✓ ${doc}.docx"
  else
    echo "⚠ ${doc}.md not found — skipping"
  fi
done

echo ""
echo "Done. $(ls -1 docs/*.docx docs/launch-kit/*.docx 2>/dev/null | wc -l) docx files generated."
