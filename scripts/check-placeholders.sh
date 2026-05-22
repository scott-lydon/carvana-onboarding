#!/usr/bin/env bash
# Verifies the five foundational artifacts contain no template placeholders.
# Run from repo root. Exits 0 if clean, 1 if any artifact still has placeholders.
set -e
cd "$(dirname "$0")/.."

PATTERN='<[A-Z][A-Z _|/-]*>|<PROJECT NAME>|<e\.g\.'
FAILED=0
for f in constitution.md spec.md plan.md tasks.md QA_ADVERSARY.md; do
  # Exclude this script's own pattern reference from the artifact scan.
  if grep -qE "$PATTERN" "$f" 2>/dev/null; then
    echo "FAIL: $f still has template placeholders"
    FAILED=1
  else
    echo "PASS: $f"
  fi
done

exit $FAILED
