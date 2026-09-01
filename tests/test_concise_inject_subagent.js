#!/usr/bin/env node
// Tests for hooks/concise-inject-subagent.js - run: node tests/test_concise_inject_subagent.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INJECT = path.join(ROOT, 'hooks', 'concise-inject-subagent.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-inject-test-'));
  try {
    fn(tmp);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function run(tmp, payload) {
  return execFileSync(process.execPath, [INJECT], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp },
  });
}

console.log('concise-inject-subagent tests\n');

test('when active, prepends the ruleset to the Task prompt via updatedInput', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  const out = run(tmp, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Task',
    tool_input: { prompt: 'Investigate the login bug.' },
  });
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'allow');
  const newPrompt = parsed.hookSpecificOutput.updatedInput.prompt;
  assert.ok(newPrompt.includes('CONCISE MODE ACTIVE'));
  assert.ok(newPrompt.includes('Investigate the login bug.'));
  assert.ok(newPrompt.indexOf('CONCISE MODE ACTIVE') < newPrompt.indexOf('Investigate the login bug.'));
});

test('preserves every other tool_input field (description, subagent_type, ...) unchanged', (tmp) => {
  // Regression test: an updatedInput carrying only { prompt } broke a real
  // Task dispatch by dropping the required `description` field - the
  // documented "non-destructive merge" did not hold up in practice.
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  const out = run(tmp, {
    tool_name: 'Task',
    tool_input: {
      prompt: 'Investigate the login bug.',
      description: 'Debug login',
      subagent_type: 'general-purpose',
    },
  });
  const updatedInput = JSON.parse(out).hookSpecificOutput.updatedInput;
  assert.strictEqual(updatedInput.description, 'Debug login');
  assert.strictEqual(updatedInput.subagent_type, 'general-purpose');
  assert.ok(updatedInput.prompt.includes('Investigate the login bug.'));
});

test('when inactive (no flag), does not modify the prompt', (tmp) => {
  const out = run(tmp, {
    tool_name: 'Task',
    tool_input: { prompt: 'Investigate the login bug.' },
  });
  assert.strictEqual(out.trim(), '');
});

test('when the flag is off, does not modify the prompt', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'off');
  const out = run(tmp, {
    tool_name: 'Task',
    tool_input: { prompt: 'Investigate the login bug.' },
  });
  assert.strictEqual(out.trim(), '');
});

test('a missing tool_input.prompt is handled gracefully, no crash, no output', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  const out = run(tmp, { tool_name: 'Task', tool_input: {} });
  assert.strictEqual(out.trim(), '');
});

test('the injected ruleset respects the active budget override', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  fs.writeFileSync(path.join(tmp, '.concise-budget'), '150');
  const out = run(tmp, {
    tool_name: 'Task',
    tool_input: { prompt: 'Do the thing.' },
  });
  const parsed = JSON.parse(out);
  assert.ok(parsed.hookSpecificOutput.updatedInput.prompt.includes('150 words'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
