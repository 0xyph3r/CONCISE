#!/usr/bin/env node
// Tests for hooks/concise-stats.js - run: node tests/test_concise_stats.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATS = path.join(ROOT, 'hooks', 'concise-stats.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-stats-test-'));
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

function makeTranscript(dir, entries) {
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n'));
  return file;
}

function assistantEntry(text) {
  return { type: 'assistant', message: { content: [{ type: 'text', text }] } };
}

console.log('concise-stats tests\n');

test('stripCodeBlocks removes fenced code, keeps surrounding prose', () => {
  const { stripCodeBlocks } = require(STATS);
  const input = 'before\n```js\nconst x = 1;\n```\nafter';
  const out = stripCodeBlocks(input);
  assert.ok(!out.includes('const x'));
  assert.ok(out.includes('before'));
  assert.ok(out.includes('after'));
});

test('stripCodeBlocks strips an unterminated fence too, not just closed ones', () => {
  const { stripCodeBlocks } = require(STATS);
  const input = 'here is the fix\n```js\nfunction f() {\n  return 1;\n  // response cut off mid-block';
  const out = stripCodeBlocks(input);
  assert.ok(out.includes('here is the fix'));
  assert.ok(!out.includes('function f'));
  assert.ok(!out.includes('cut off mid-block'));
});

test('countProseWords counts only prose words, not code', () => {
  const { countProseWords } = require(STATS);
  const text = 'one two three\n```\nfour five six seven\n```';
  assert.strictEqual(countProseWords(text), 3);
});

test('extractLastAssistantText returns the last assistant text block', (tmp) => {
  const { extractLastAssistantText } = require(STATS);
  const file = makeTranscript(tmp, [
    assistantEntry('first response'),
    { type: 'user', message: { content: [{ type: 'text', text: 'a question' }] } },
    assistantEntry('second response'),
  ]);
  assert.strictEqual(extractLastAssistantText(file).text, 'second response');
});

test('extractLastAssistantText accumulates all assistant text since the last real user message, spanning tool calls', (tmp) => {
  const { extractLastAssistantText } = require(STATS);
  const file = makeTranscript(tmp, [
    { type: 'user', message: { content: 'do the thing' } },
    assistantEntry('Let me check the file first.'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file contents' }] } },
    assistantEntry('Done, updated it.'),
  ]);
  const { text } = extractLastAssistantText(file);
  assert.ok(text.includes('Let me check the file first.'));
  assert.ok(text.includes('Done, updated it.'));
});

test('extractLastAssistantText returns hadToolUse: true when the turn included a tool_use block', (tmp) => {
  const { extractLastAssistantText } = require(STATS);
  const file = makeTranscript(tmp, [
    { type: 'user', message: { content: 'fix it' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    assistantEntry('Fixed.'),
  ]);
  assert.strictEqual(extractLastAssistantText(file).hadToolUse, true);
});

test('extractLastAssistantText returns hadToolUse: false for a plain Q&A turn', (tmp) => {
  const { extractLastAssistantText } = require(STATS);
  const file = makeTranscript(tmp, [
    { type: 'user', message: { content: 'what does this do' } },
    assistantEntry('It parses the config file.'),
  ]);
  assert.strictEqual(extractLastAssistantText(file).hadToolUse, false);
});

test('extractLastAssistantText returns text: null when transcript is missing', (tmp) => {
  const { extractLastAssistantText } = require(STATS);
  const result = extractLastAssistantText(path.join(tmp, 'nope.jsonl'));
  assert.strictEqual(result.text, null);
  assert.strictEqual(result.hadToolUse, false);
});

test('formatBar renders a full-width bar at 100% and an OVER label above 100%', () => {
  const { formatBar } = require(STATS);
  assert.strictEqual(formatBar(0, 0, 400), '[░░░░░░░░░░░░░░░░░░░░] 0% (0/400w)');
  assert.strictEqual(formatBar(50, 200, 400), '[██████████░░░░░░░░░░] 50% (200/400w)');
  assert.strictEqual(formatBar(100, 400, 400), '[████████████████████] 100% (400/400w)');
  assert.strictEqual(formatBar(150, 600, 400), '[████████████████████] 150% (600/400w) OVER');
});

test('computeTurn ties word count to percent of budget', () => {
  const { computeTurn } = require(STATS);
  const result = computeTurn({ text: 'one two three four', budget: 8 });
  assert.strictEqual(result.words, 4);
  assert.strictEqual(result.percent, 50);
});

test('main writes bar + history and increments streak on an over-budget turn', (tmp) => {
  const transcriptFile = makeTranscript(tmp, [assistantEntry('one two three four five')]);
  execFileSync(process.execPath, [STATS], {
    input: JSON.stringify({ transcript_path: transcriptFile, session_id: 's1' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: '2' },
  });
  const bar = fs.readFileSync(path.join(tmp, '.concise-statusline-bar'), 'utf8');
  assert.ok(bar.includes('OVER'));
  const streak = fs.readFileSync(path.join(tmp, '.concise-streak'), 'utf8').trim();
  assert.strictEqual(streak, '1');
  const historyLines = fs.readFileSync(path.join(tmp, '.concise-history.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(historyLines.length, 1);
  const entry = JSON.parse(historyLines[0]);
  assert.strictEqual(entry.words, 5);
  assert.strictEqual(entry.budget, 2);
});

test('main resets streak to 0 on an under-budget turn', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-streak'), '3');
  const transcriptFile = makeTranscript(tmp, [assistantEntry('one two')]);
  execFileSync(process.execPath, [STATS], {
    input: JSON.stringify({ transcript_path: transcriptFile, session_id: 's1' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: '400' },
  });
  const streak = fs.readFileSync(path.join(tmp, '.concise-streak'), 'utf8').trim();
  assert.strictEqual(streak, '0');
});

test('main flags an under-8-word response as terse when the turn edited a file', (tmp) => {
  const transcriptFile = makeTranscript(tmp, [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
    assistantEntry('Fixed it.'),
  ]);
  execFileSync(process.execPath, [STATS], {
    input: JSON.stringify({ transcript_path: transcriptFile, session_id: 's1' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: '400' },
  });
  const bar = fs.readFileSync(path.join(tmp, '.concise-statusline-bar'), 'utf8');
  assert.ok(bar.includes('[terse?]'));
  const historyLine = fs.readFileSync(path.join(tmp, '.concise-history.jsonl'), 'utf8').trim();
  assert.strictEqual(JSON.parse(historyLine).underCompressed, true);
});

test('main does not flag a short response when the turn had no tool use', (tmp) => {
  const transcriptFile = makeTranscript(tmp, [assistantEntry('Fixed it.')]);
  execFileSync(process.execPath, [STATS], {
    input: JSON.stringify({ transcript_path: transcriptFile, session_id: 's1' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: '400' },
  });
  const bar = fs.readFileSync(path.join(tmp, '.concise-statusline-bar'), 'utf8');
  assert.ok(!bar.includes('[terse?]'));
});

test('main records agent_type in history when present (SubagentStop payload)', (tmp) => {
  const transcriptFile = makeTranscript(tmp, [assistantEntry('Subagent response.')]);
  execFileSync(process.execPath, [STATS], {
    input: JSON.stringify({
      transcript_path: transcriptFile,
      session_id: 's1',
      hook_event_name: 'SubagentStop',
      agent_type: 'general-purpose',
      agent_id: 'abc123',
    }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: '400' },
  });
  const historyLine = fs.readFileSync(path.join(tmp, '.concise-history.jsonl'), 'utf8').trim();
  assert.strictEqual(JSON.parse(historyLine).agentType, 'general-purpose');
});

test('main records agentType: null for the main-session Stop event (no agent_type field)', (tmp) => {
  const transcriptFile = makeTranscript(tmp, [assistantEntry('Main session response.')]);
  execFileSync(process.execPath, [STATS], {
    input: JSON.stringify({ transcript_path: transcriptFile, session_id: 's1' }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: '400' },
  });
  const historyLine = fs.readFileSync(path.join(tmp, '.concise-history.jsonl'), 'utf8').trim();
  assert.strictEqual(JSON.parse(historyLine).agentType, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
