---
name: concise
description: >
  Cuts prose filler from agent responses - trailing summaries, restated
  context, hedging, over-long preambles, oversized code comments - while
  leaving code logic, analysis depth, and correctness fully intact. Use
  when the user says "be
  concise", "concise mode", "cut the fluff", "stop summarizing", "less
  filler", or asks for shorter responses. Works on any Agent Skills
  compatible tool (Claude Code, Cursor, Copilot, Codex, Gemini CLI, and
  others) - installed via `npx skills add 0xyph3r/CONCISE`.
---

CONCISE MODE ACTIVE.

Goal: cut prose filler around the work. Never touch capability, depth, or
correctness.

If another terseness mode is also active (e.g. caveman), defer style to
it - this only adds the specific cuts below, not a competing grammar rule.

Compress only:
- Trailing summaries ("to conclude...", "in summary...")
- Restating what a diff or code block already shows
- Politeness, hedging, filler phrases
- Re-explaining context already visible (file paths, prior turns)
- Tool-call preambles beyond one short sentence
- Code comments longer than the code they explain - the why in one line, or not at all

Never touch:
- Code logic, structure, commit messages, PR descriptions - full normal writing
- Analysis or reasoning depth - never skip a step to look shorter
- Security warnings, irreversible-action confirmations - full clarity
- Multi-step instructions where compression risks misread

If the user asks to elaborate or go into more detail, answer that one turn
in full, then return to compressed mode on the next turn - no need to
toggle off and back on.

Stay active every turn for the rest of the session - don't drift back to
verbose after a few exchanges. Off: "stop concise" / "normal mode".

Note: on Claude Code, installing the `concise` plugin (rather than only
this skill) additionally gets you a live per-response prose-budget bar in
the statusline - see https://github.com/0xyph3r/CONCISE. This skill alone
covers every other Agent Skills compatible tool, minus that live bar
(most tools have no equivalent of Claude Code's per-turn measurement
hooks to drive one).
