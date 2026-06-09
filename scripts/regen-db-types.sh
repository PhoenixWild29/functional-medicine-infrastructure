#!/usr/bin/env bash
# ============================================================
# regen-db-types.sh — regenerate src/types/database.types.ts
# from the linked Supabase project, deterministically.
# ============================================================
#
# Codex Section 1 follow-up (session 2026-06-09): the previous
# `db:types` script was:
#
#   supabase gen types typescript --project-id your-project-ref \
#     > src/types/database.types.ts
#
# That had three problems:
#   1. "your-project-ref" placeholder was never replaced → script
#      silently emitted empty / error output on real runs
#   2. Raw `>` redirection captured the Supabase CLI's upgrade-
#      warning footer ("A new version of Supabase CLI is
#      available…") at the end of the file, breaking TypeScript
#   3. The custom type aliases at the bottom of database.types.ts
#      (OrderStatusEnum, StripeConnectStatusEnum, IntegrationTierEnum)
#      were silently dropped on every regen, requiring manual
#      post-processing
#
# This script fixes all three:
#   - Hard-codes the production project ref (it's not a secret;
#     it's a public Supabase project ID)
#   - Captures stdout only, then validates the body
#   - Strips any trailing CLI chatter lines
#   - Re-appends the custom type aliases footer
#   - Atomic write (only overwrites the real file on success)
#
# Usage:
#   npm run db:types     # calls this script
#   bash scripts/regen-db-types.sh
#
# Override the project ref via env var if you need to regen
# against a different project:
#   SUPABASE_PROJECT_REF=other-ref bash scripts/regen-db-types.sh

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-rhrgtwmeowicohclkxlz}"
OUT_PATH="src/types/database.types.ts"
TMP_PATH="${OUT_PATH}.tmp"
ERR_PATH="${OUT_PATH}.stderr.tmp"

# ── 1. Run the Supabase CLI; capture stdout and stderr separately ──
# stderr captures the CLI's upgrade warnings + any real errors so we
# can inspect them without polluting the TS file.
echo "[regen-db-types] Generating types for project ${PROJECT_REF}..."
if ! supabase gen types typescript --project-id "${PROJECT_REF}" > "${TMP_PATH}" 2> "${ERR_PATH}"; then
  echo "[regen-db-types] ERROR: supabase gen types failed. stderr:"
  cat "${ERR_PATH}" >&2
  rm -f "${TMP_PATH}" "${ERR_PATH}"
  exit 1
fi

# ── 2. Sanity-check the captured stdout ──────────────────────
# The generated file MUST start with `export type Json` and contain
# `export type Database`. Anything else means the CLI emitted error
# text to stdout instead of valid TS.
if ! head -1 "${TMP_PATH}" | grep -q "^export type Json"; then
  echo "[regen-db-types] ERROR: generated file does not start with 'export type Json'."
  echo "[regen-db-types] First 3 lines:"
  head -3 "${TMP_PATH}" >&2
  rm -f "${TMP_PATH}" "${ERR_PATH}"
  exit 1
fi

if ! grep -q "^export type Database" "${TMP_PATH}"; then
  echo "[regen-db-types] ERROR: generated file missing 'export type Database'."
  rm -f "${TMP_PATH}" "${ERR_PATH}"
  exit 1
fi

# ── 3. Detect + strip CLI chatter that leaks into stdout ─────
# The CLI's upgrade-warning line(s) sometimes leak into stdout
# instead of stderr. They're plain English starting with capital
# letters, NOT valid TypeScript. We detect by looking for lines
# after the closing `} as const` that don't start with `//`, `/*`,
# `export`, `import`, or whitespace.
LAST_VALID_LINE=$(grep -n "^} as const" "${TMP_PATH}" | tail -1 | cut -d: -f1)
if [ -z "${LAST_VALID_LINE}" ]; then
  echo "[regen-db-types] ERROR: could not find '} as const' anchor in generated file."
  rm -f "${TMP_PATH}" "${ERR_PATH}"
  exit 1
fi

TOTAL_LINES=$(wc -l < "${TMP_PATH}")
if [ "${TOTAL_LINES}" -gt "${LAST_VALID_LINE}" ]; then
  # There are lines after `} as const`. Check whether they're CLI chatter.
  TRAILING=$(tail -n +$((LAST_VALID_LINE + 1)) "${TMP_PATH}")
  # Anything not starting with //, /*, export, import, or whitespace is
  # almost certainly CLI chatter.
  CHATTER=$(echo "${TRAILING}" | grep -vE '^(\/\/|\/\*|export|import|\s*$)' || true)
  if [ -n "${CHATTER}" ]; then
    echo "[regen-db-types] Detected CLI chatter in stdout; stripping:"
    echo "${CHATTER}" | sed 's/^/  > /' >&2
    head -n "${LAST_VALID_LINE}" "${TMP_PATH}" > "${TMP_PATH}.stripped"
    mv "${TMP_PATH}.stripped" "${TMP_PATH}"
  fi
fi

# ── 4. Re-append the custom type aliases ─────────────────────
# These are project-specific helpers that supabase gen types does
# not produce. They live at the bottom of database.types.ts and
# get dropped on every regen — re-append them here.
cat >> "${TMP_PATH}" <<'ALIASES'

// ── Custom type aliases (re-added after supabase gen types) ──
export type OrderStatusEnum = Database['public']['Enums']['order_status_enum']
export type StripeConnectStatusEnum = Database['public']['Enums']['stripe_connect_status_enum']
export type IntegrationTierEnum = Database['public']['Enums']['integration_tier_enum']
ALIASES

# ── 5. Atomic install ────────────────────────────────────────
mv "${TMP_PATH}" "${OUT_PATH}"
rm -f "${ERR_PATH}"

echo "[regen-db-types] OK → ${OUT_PATH}"
echo "[regen-db-types] $(wc -l < "${OUT_PATH}") lines, $(grep -c '^      [a-z_]*: {' "${OUT_PATH}") tables."
