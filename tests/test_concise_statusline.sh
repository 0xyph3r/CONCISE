#!/bin/bash
# Tests for hooks/concise-statusline.sh - run: bash tests/test_concise_statusline.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/hooks/concise-statusline.sh"
PASSED=0
FAILED=0

check() {
  local name="$1" expected_substr="$2" actual="$3"
  if [[ "$actual" == *"$expected_substr"* ]]; then
    PASSED=$((PASSED+1)); printf '  \xe2\x9c\x93 %s\n' "$name"
  else
    FAILED=$((FAILED+1)); printf '  \xe2\x9c\x97 %s\n' "$name"; echo "    expected to contain: $expected_substr"; echo "    got: $actual"
  fi
}

check_empty() {
  local name="$1" actual="$2"
  if [[ -z "$actual" ]]; then
    PASSED=$((PASSED+1)); printf '  \xe2\x9c\x93 %s\n' "$name"
  else
    FAILED=$((FAILED+1)); printf '  \xe2\x9c\x97 %s\n' "$name"; echo "    expected empty, got: $actual"
  fi
}

echo "concise-statusline.sh tests"
echo

# Missing flag -> empty output
tmp1=$(mktemp -d)
out=$(CLAUDE_CONFIG_DIR="$tmp1" bash "$SCRIPT")
check_empty "missing flag produces no output" "$out"
rm -rf "$tmp1"

# on flag, no bar file yet -> badge only
tmp2=$(mktemp -d)
printf 'on' > "$tmp2/.concise-active"
out=$(CLAUDE_CONFIG_DIR="$tmp2" bash "$SCRIPT")
check "on flag with no bar shows [CONCISE] badge" "CONCISE" "$out"
rm -rf "$tmp2"

# on flag + bar file -> badge and bar
tmp3=$(mktemp -d)
printf 'on' > "$tmp3/.concise-active"
printf '[██████████░░░░░░░░░░] 50%%' > "$tmp3/.concise-statusline-bar"
out=$(CLAUDE_CONFIG_DIR="$tmp3" bash "$SCRIPT")
check "on flag with bar shows the bar" "50%" "$out"
check "on flag with bar shows the unicode block characters (not stripped by sanitization)" "██████████░░░░░░░░░░" "$out"
rm -rf "$tmp3"

# off flag -> empty output
tmp4=$(mktemp -d)
printf 'off' > "$tmp4/.concise-active"
out=$(CLAUDE_CONFIG_DIR="$tmp4" bash "$SCRIPT")
check_empty "off flag produces no output" "$out"
rm -rf "$tmp4"

# large bar file (bigger than the 100-byte cap) -> capped, no hang/error
tmp5=$(mktemp -d)
printf 'on' > "$tmp5/.concise-active"
yes X | tr -d '\n' | head -c 5000 > "$tmp5/.concise-statusline-bar"
out=$(CLAUDE_CONFIG_DIR="$tmp5" bash "$SCRIPT")
bar_part="${out#*\[CONCISE\]}"
if [ "${#bar_part}" -le 150 ]; then
  PASSED=$((PASSED+1)); printf '  \xe2\x9c\x93 %s\n' "large bar file is capped, not printed in full"
else
  FAILED=$((FAILED+1)); printf '  \xe2\x9c\x97 %s\n' "large bar file is capped, not printed in full"
  echo "    got length: ${#bar_part}"
fi
rm -rf "$tmp5"

echo
echo "$PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
