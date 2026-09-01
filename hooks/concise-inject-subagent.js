#!/usr/bin/env node
// concise - PreToolUse hook (matcher: "Task"). Rewrites a subagent's
// dispatch prompt to prepend the compression ruleset before it runs.
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
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolInput = data.tool_input;
    const prompt = toolInput && toolInput.prompt;
    if (typeof prompt !== 'string' || !prompt) { process.exit(0); return; }

    const active = readFlag(flagPath);
    if (active !== 'on') { process.exit(0); return; }

    const budget = getActiveBudget(claudeDir);
    const injected = buildRuleset(budget) + '\n\n---\n\n' + prompt;

    // Spread every original field (description, subagent_type, etc.) and
    // override only prompt - sending back a partial object dropped the
    // Task tool's other required fields and broke the dispatch entirely
    // (found by actually testing this, not from the docs).
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { ...toolInput, prompt: injected },
      },
    }));
  } catch (e) {
    // Silent fail - never block a subagent dispatch over an injection error.
  }
});
