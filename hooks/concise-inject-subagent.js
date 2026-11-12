#!/usr/bin/env node
// concise - PreToolUse hook (matchers: "Task", "SendMessage"). Rewrites a
// subagent's dispatch prompt to prepend the compression ruleset before it
// runs, and prepends a one-line reminder to every SendMessage that resumes
// an existing subagent (the full ruleset is already in its first prompt).
//
// SubagentStart can't return additionalContext (a documented Claude Code
// limitation - see code.claude.com/docs/en/hooks), so there is no hook
// that lets a subagent "go concise" on its own once it's already running.
// This is the injection point: PreToolUse's `updatedInput` on the Task
// tool. An earlier version that returned only { prompt } dropped the
// Task tool's other required fields and broke the dispatch entirely -
// fixed by spreading every original field. Confirmed working by
// inspecting a real subagent's own transcript file directly (not by
// asking the subagent - a subagent's self-report on "do you see X in
// your prompt" is unreliable and can decline to answer): the transcript's
// first message literally starts with this ruleset text, verbatim.

const path = require('path');
const { getActiveBudget, getClaudeDir, readFlag, buildRuleset } = require('./concise-config');

const claudeDir = getClaudeDir();
const flagPath = path.join(claudeDir, '.concise-active');

let input = '';
// Short form for follow-up messages: the subagent already saw the full
// ruleset at dispatch, so repeating ~250 words on every message is waste.
function buildReminder(budget) {
  return 'CONCISE MODE ACTIVE. Cut prose filler (summaries, restated context, ' +
    'hedging, long preambles). Code/commits/security/analysis depth stay full. ' +
    'If another terseness mode (e.g. caveman) is also active, defer style to it. ' +
    `Budget: ${budget} words.`;
}

process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolInput = data.tool_input;
    const isSendMessage = data.tool_name === 'SendMessage';
    const field = isSendMessage ? 'message' : 'prompt';
    // Structured SendMessage payloads (protocol objects, not text) are left alone.
    const text = toolInput && toolInput[field];
    if (typeof text !== 'string' || !text) { process.exit(0); return; }

    const active = readFlag(flagPath);
    if (active !== 'on') { process.exit(0); return; }

    const budget = getActiveBudget(claudeDir);
    const injected = (isSendMessage ? buildReminder(budget) : buildRuleset(budget)) + '\n\n---\n\n' + text;

    // Spread every original field (description, subagent_type, etc.) and
    // override only the text field - sending back a partial object dropped the
    // Task tool's other required fields and broke the dispatch entirely
    // (found by actually testing this, not from the docs).
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { ...toolInput, [field]: injected },
      },
    }));
  } catch (e) {
    // Silent fail - never block a subagent dispatch over an injection error.
  }
});
