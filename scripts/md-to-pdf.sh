#!/usr/bin/env bash
# ============================================================
# md-to-pdf.sh — regenerate PDFs for all partner-facing docs.
# ============================================================
#
# Usage: npm run docs:pdf
#
# Each entry is "source_path_without_ext|output_path_without_ext".
# md-to-pdf writes PDFs next to the source file, so we run it on
# the source and then move the output to the desired location.
#
# Source layout (post-2026-04-16 reorg):
#   All .md source lives in docs/archive/source/
#   All .pdf output lives in docs/ root (partner-facing, easy access)
#
# Batching: md-to-pdf uses puppeteer which navigates a headless
# Chromium for each page. Running too many in parallel hits the
# 30s navigation timeout. Batches of 4-5 are the sweet spot.

set -uo pipefail  # intentionally no -e — md-to-pdf can fail on one file in a batch and we want to continue

# Entries: source_path_without_ext|output_path_without_ext
DOCS=(
  "docs/archive/source/BUSINESS-ACTION-PLAN|docs/BUSINESS-ACTION-PLAN"
  "docs/archive/source/CLINIC-ONBOARDING-PLAYBOOK|docs/CLINIC-ONBOARDING-PLAYBOOK"
  "docs/archive/source/COMPOUNDIQ-EXECUTIVE-OVERVIEW|docs/COMPOUNDIQ-EXECUTIVE-OVERVIEW"
  "docs/archive/source/INVESTMENT-STRATEGY-MEMO|docs/INVESTMENT-STRATEGY-MEMO"
  "docs/archive/source/PHARMACY-INTEGRATION-GUIDE|docs/PHARMACY-INTEGRATION-GUIDE"
  "docs/archive/source/POC-DEMO-DETAILED|docs/POC-DEMO-DETAILED"
  "docs/archive/source/POC-DEMO-QUICKSTART|docs/POC-DEMO-QUICKSTART"
  "docs/archive/source/SYSTEM-ARCHITECTURE-OVERVIEW|docs/SYSTEM-ARCHITECTURE-OVERVIEW"
  "docs/archive/source/launch-kit/pre-launch-checklist|docs/pre-launch-checklist"
  "docs/archive/source/launch-kit/mobile-validation-test-plan|docs/mobile-validation-test-plan"
)

# Process in batches of 2 to avoid puppeteer parallel-navigation timeouts.
# md-to-pdf uses a single Chromium instance per invocation; more than 2-3
# concurrent page loads regularly hit the 30s waitForNavigation timeout.
BATCH_SIZE=2
count=0
batch=()

process_batch() {
  if [[ ${#batch[@]} -eq 0 ]]; then return; fi
  local srcs=()
  for entry in "${batch[@]}"; do
    local src="${entry%%|*}"
    srcs+=("${src}.md")
  done
  # Run md-to-pdf; swallow non-zero exit so one bad doc doesn't abort the whole run.
  npx --yes md-to-pdf "${srcs[@]}" 2>&1 | grep -E "(started|completed|TimeoutError|Error)" | head -20 || true
  for entry in "${batch[@]}"; do
    local src="${entry%%|*}"
    local out="${entry##*|}"
    if [[ -f "${src}.pdf" ]]; then
      mv "${src}.pdf" "${out}.pdf"
      echo "✓ ${out}.pdf"
    else
      echo "⚠ ${out}.pdf — generation failed; will retry solo"
      # Retry this one file solo, which is the most reliable path.
      if npx --yes md-to-pdf "${src}.md" 2>&1 | grep -qE "completed"; then
        if [[ -f "${src}.pdf" ]]; then
          mv "${src}.pdf" "${out}.pdf"
          echo "✓ ${out}.pdf (retry solo)"
        fi
      else
        echo "❌ ${out}.pdf — solo retry also failed"
      fi
    fi
  done
  batch=()
}

for entry in "${DOCS[@]}"; do
  src="${entry%%|*}"
  if [[ ! -f "${src}.md" ]]; then
    echo "⚠ ${src}.md not found — skipping"
    continue
  fi
  batch+=("$entry")
  count=$((count + 1))
  if [[ ${#batch[@]} -ge $BATCH_SIZE ]]; then
    process_batch
  fi
done

# Process any remaining docs in the final partial batch.
process_batch

echo ""
echo "Done. $count PDFs generated in docs/ root."
