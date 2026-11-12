---
name: concise-help
description: Quick reference for the CONCISE plugin - commands, budget config, and what gets cut vs kept. Use when the user asks how concise mode works or how to configure it.
---

# CONCISE - quick reference

**Commands**
- `/concise on` - turn compression on (default at session start).
- `/concise off` - turn compression off for this session.
- `/concise budget <n>` - set the per-response prose word budget (default 400).
- `/concise level light|normal|strict` - preset budgets (600/400/200 words).
- `/concise-stats` - show lifetime stats: turns tracked, average % of
  budget used, over-budget rate, total prose words. Measured only - never
  an extrapolated "tokens saved" figure.

**What gets cut:** trailing summaries, restating what a diff/code block
already shows, politeness/hedging, re-explaining visible context, long
tool-call preambles, code comments longer than the code they explain.

**What never changes:** code logic and structure, commit messages, PR
descriptions, analysis depth, security warnings, irreversible-action
confirmations.

**Elaborate on request:** ask to elaborate or go into more detail and that
one turn answers in full, then compression resumes next turn - no need to
`/concise off` and back on.

**Statusline:** `[CONCISE] [██████████░░░░░░░░░░] 50% (200/400w)` - prose
words used vs. the budget for the response just finished, updated after
every turn. Past 100% it reads e.g. `120% (480/400w) OVER`. Under 8 words
with a file edit or command in the same turn reads `[terse?]` instead -
flags possibly under-explained work, not a correctness check. Three
over-budget responses in a row triggers a stronger reminder on the next
turn.

**Subagents (Task tool):** their dispatch prompt gets the ruleset
prepended before they run (`PreToolUse` on `Task`, confirmed by
inspecting a real subagent transcript), and their final response also
gets measured and updates the bar/history (`SubagentStop`).

**Config:** resolution order is env var > project `.concise.json` > global
config file > default. `CONCISE_BUDGET_WORDS` env var, `CONCISE_DEFAULT`
(`on`/`off`) env var, a `.concise.json` in the project root (checked-in,
repo-specific), or `~/.config/concise/config.json`
(`%APPDATA%\concise\config.json` on Windows) for a personal default - all
in the shape `{"budgetWords": 300, "default": "on"}`.

**Update check:** on SessionStart, at most once per 24h, checks npm for a
newer version and tells the user in chat if one's out - never downloads or
runs anything itself. Disable with `CONCISE_NO_UPDATE_CHECK`.
