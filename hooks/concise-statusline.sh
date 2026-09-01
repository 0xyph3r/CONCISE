#!/bin/bash
# concise - statusline badge. Shows [CONCISE] plus the live prose-budget bar.
#
# Usage in ~/.claude/settings.json:
#   "statusLine": { "type": "command", "command": "bash /path/to/concise-statusline.sh" }

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
FLAG="$CLAUDE_DIR/.concise-active"
BAR_FILE="$CLAUDE_DIR/.concise-statusline-bar"

# Refuse symlinks - a local attacker could point the flag at a secret file
# and have the statusline render its bytes to the terminal every keystroke.
[ -L "$FLAG" ] && exit 0
[ ! -f "$FLAG" ] && exit 0

MODE=$(head -c 8 "$FLAG" 2>/dev/null | tr -d '\n\r' | tr '[:upper:]' '[:lower:]')
MODE=$(printf '%s' "$MODE" | tr -cd 'a-z')
[ "$MODE" != "on" ] && exit 0

printf '\033[38;5;108m[CONCISE]\033[0m'

if [ -f "$BAR_FILE" ] && [ ! -L "$BAR_FILE" ]; then
  # Strip control bytes (blocks ESC/terminal-escape injection) rather than an
  # ASCII allow-list - the bar uses multi-byte UTF-8 block characters
  # (█/░), which an allow-list would silently eat.
  BAR=$(head -c 100 "$BAR_FILE" 2>/dev/null | tr -d '\000-\037\177')
  [ -n "$BAR" ] && printf ' \033[38;5;108m%s\033[0m' "$BAR"
fi
