#!/usr/bin/env node
// Tests for hooks/concise-remind.js - run: node tests/test_concise_remind.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REMIND = path.join(ROOT, 'hooks', 'concise-remind.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-remind-test-'));
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

function run(tmp, prompt) {
  return execFileSync(process.execPath, [REMIND], {
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp },
  });
}

console.log('concise-remind tests\n');

test('/concise-stats blocks the prompt and returns the lifetime report', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  fs.writeFileSync(path.join(tmp, '.concise-history.jsonl'),
    JSON.stringify({ words: 100, budget: 400, percent: 25 }) + '\n');
  const out = run(tmp, '/concise-stats');
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(/Turns tracked:\s*1/.test(parsed.reason));
});

test('/concise off deletes the flag and emits no context', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  const out = run(tmp, '/concise off');
  assert.ok(!fs.existsSync(path.join(tmp, '.concise-active')));
  assert.strictEqual(out.trim(), '');
});

test('/concise on writes the flag and emits a reminder', (tmp) => {
  const out = run(tmp, '/concise on');
  assert.strictEqual(fs.readFileSync(path.join(tmp, '.concise-active'), 'utf8'), 'on');
  const parsed = JSON.parse(out);
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('CONCISE MODE ACTIVE'));
  assert.ok(/defer style to it/i.test(parsed.hookSpecificOutput.additionalContext));
});

test('/concise budget 250 writes the budget file', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  run(tmp, '/concise budget 250');
  assert.strictEqual(fs.readFileSync(path.join(tmp, '.concise-budget'), 'utf8'), '250');
});

test('/concise level strict writes the preset budget', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  run(tmp, '/concise level strict');
  assert.strictEqual(fs.readFileSync(path.join(tmp, '.concise-budget'), 'utf8'), '200');
});

test('/concise level light writes the preset budget', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  run(tmp, '/concise level light');
  assert.strictEqual(fs.readFileSync(path.join(tmp, '.concise-budget'), 'utf8'), '600');
});

test('/concise level bogus does not write a budget file', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  run(tmp, '/concise level bogus');
  assert.ok(!fs.existsSync(path.join(tmp, '.concise-budget')));
});

test('a normal prompt while active emits a reminder including the current bar', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  fs.writeFileSync(path.join(tmp, '.concise-statusline-bar'), '[##########----------] 50%');
  const out = run(tmp, 'please refactor this function');
  const parsed = JSON.parse(out);
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('50%'));
});

test('a normal prompt while inactive (no flag) emits nothing', (tmp) => {
  const out = run(tmp, 'please refactor this function');
  assert.strictEqual(out.trim(), '');
});

test('reminder escalates after 3 consecutive over-budget turns', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  fs.writeFileSync(path.join(tmp, '.concise-streak'), '3');
  const out = run(tmp, 'please refactor this function');
  const parsed = JSON.parse(out);
  assert.ok(/tighten up/i.test(parsed.hookSpecificOutput.additionalContext));
});

test('natural-language "stop concise mode" deactivates', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  run(tmp, 'stop concise mode');
  assert.ok(!fs.existsSync(path.join(tmp, '.concise-active')));
});

test('a prompt merely mentioning "concise" does not deactivate', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-active'), 'on');
  run(tmp, 'keep your answer concise and stop repeating yourself');
  assert.strictEqual(fs.readFileSync(path.join(tmp, '.concise-active'), 'utf8'), 'on');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
