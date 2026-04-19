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

# Source layout after 2026-04-16 reorg:
#   .md source lives in docs/archive/source/ (and docs/archive/source/launch-kit/)
#   Rendered .pdf lives in docs/ root (for investor/demo docs — partner-facing)
#   Rendered .docx for investor/demo docs is archived alongside source (kept for
#   reference, not surfaced in the clean docs/ folder)
#   Rendered .docx for launch-kit lives in docs/launch-kit/ (editable working docs)
# Each entry is "source_path_without_ext|output_path_without_ext"

DOCS=(
  "docs/archive/source/BUSINESS-ACTION-PLAN|docs/archive/source/BUSINESS-ACTION-PLAN"
  "docs/archive/source/CLINIC-ONBOARDING-PLAYBOOK|docs/archive/source/CLINIC-ONBOARDING-PLAYBOOK"
  "docs/archive/source/COMPOUNDIQ-EXECUTIVE-OVERVIEW|docs/archive/source/COMPOUNDIQ-EXECUTIVE-OVERVIEW"
  "docs/archive/source/INVESTMENT-STRATEGY-MEMO|docs/archive/source/INVESTMENT-STRATEGY-MEMO"
  "docs/archive/source/PHARMACY-INTEGRATION-GUIDE|docs/archive/source/PHARMACY-INTEGRATION-GUIDE"
  "docs/archive/source/POC-DEMO-DETAILED|docs/archive/source/POC-DEMO-DETAILED"
  "docs/archive/source/POC-DEMO-QUICKSTART|docs/archive/source/POC-DEMO-QUICKSTART"
  "docs/archive/source/SYSTEM-ARCHITECTURE-OVERVIEW|docs/archive/source/SYSTEM-ARCHITECTURE-OVERVIEW"
  "docs/archive/source/launch-kit/README|docs/launch-kit/README"
  "docs/archive/source/launch-kit/clinic-outreach-email|docs/launch-kit/clinic-outreach-email"
  "docs/archive/source/launch-kit/pharmacy-outreach-email|docs/launch-kit/pharmacy-outreach-email"
  "docs/archive/source/launch-kit/legitscript-application-checklist|docs/launch-kit/legitscript-application-checklist"
  "docs/archive/source/launch-kit/design-partner-agreement|docs/launch-kit/design-partner-agreement"
  "docs/archive/source/launch-kit/pre-launch-checklist|docs/launch-kit/pre-launch-checklist"
  "docs/archive/source/launch-kit/mobile-validation-test-plan|docs/launch-kit/mobile-validation-test-plan"
)

for entry in "${DOCS[@]}"; do
  src="${entry%%|*}"
  out="${entry##*|}"
  if [[ -f "${src}.md" ]]; then
    pandoc "${src}.md" -o "${out}.docx"
    echo "✓ ${out}.docx"
  else
    echo "⚠ ${src}.md not found — skipping"
  fi
done

echo ""
TOTAL=$(ls -1 docs/archive/source/*.docx docs/launch-kit/*.docx 2>/dev/null | wc -l)
echo "Done. $TOTAL docx files generated (launch-kit in docs/launch-kit/, investor/demo in docs/archive/source/)."
