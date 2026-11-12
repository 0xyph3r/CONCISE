#!/usr/bin/env node
// Tests for hooks/concise-enforce.js - run: node tests/test_concise_enforce.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENFORCE = path.join(ROOT, 'hooks', 'concise-enforce.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-enforce-test-'));
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

console.log('concise-enforce tests\n');

test('default run writes the on-flag and prints the ruleset with the budget', (tmp) => {
  const out = execFileSync(process.execPath, [ENFORCE], {
    encoding: 'utf8',
    input: JSON.stringify({ source: 'startup' }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_DEFAULT: undefined, CONCISE_BUDGET_WORDS: '300', CONCISE_NO_UPDATE_CHECK: '1' },
  });
  assert.ok(out.includes('CONCISE MODE ACTIVE'));
  assert.ok(out.includes('300 words'));
  assert.strictEqual(fs.readFileSync(path.join(tmp, '.concise-active'), 'utf8'), 'on');
});

test('CONCISE_DEFAULT=off skips activation and prints nothing', (tmp) => {
  const out = execFileSync(process.execPath, [ENFORCE], {
    encoding: 'utf8',
    input: JSON.stringify({ source: 'startup' }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_DEFAULT: 'off', CONCISE_NO_UPDATE_CHECK: '1' },
  });
  assert.strictEqual(out, '');
  assert.ok(!fs.existsSync(path.join(tmp, '.concise-active')));
});

test('a leftover budget override from a previous session is cleared on SessionStart', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-budget'), '250');
  const out = execFileSync(process.execPath, [ENFORCE], {
    encoding: 'utf8',
    input: JSON.stringify({ source: 'startup' }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: undefined, CONCISE_NO_UPDATE_CHECK: '1' },
  });
  assert.ok(!fs.existsSync(path.join(tmp, '.concise-budget')));
  assert.ok(out.includes('400 words'));
});

test('a leftover budget override survives a resume/compact SessionStart (source != startup)', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-budget'), '250');
  const out = execFileSync(process.execPath, [ENFORCE], {
    encoding: 'utf8',
    input: JSON.stringify({ source: 'compact' }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: undefined, CONCISE_NO_UPDATE_CHECK: '1' },
  });
  assert.ok(fs.existsSync(path.join(tmp, '.concise-budget')));
  assert.strictEqual(fs.readFileSync(path.join(tmp, '.concise-budget'), 'utf8'), '250');
});

test('a cached newer version triggers an UPDATE AVAILABLE notice', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-update-check.json'), JSON.stringify({
    lastCheckedAt: Date.now(),
    latestKnownVersion: '999.0.0',
  }));
  const out = execFileSync(process.execPath, [ENFORCE], {
    encoding: 'utf8',
    input: JSON.stringify({ source: 'startup' }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: undefined },
  });
  assert.ok(out.includes('UPDATE AVAILABLE'));
  assert.ok(out.includes('999.0.0'));
});

test('CONCISE_NO_UPDATE_CHECK suppresses the update notice even with a newer cached version', (tmp) => {
  fs.writeFileSync(path.join(tmp, '.concise-update-check.json'), JSON.stringify({
    lastCheckedAt: Date.now(),
    latestKnownVersion: '999.0.0',
  }));
  const out = execFileSync(process.execPath, [ENFORCE], {
    encoding: 'utf8',
    input: JSON.stringify({ source: 'startup' }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp, CONCISE_BUDGET_WORDS: undefined, CONCISE_NO_UPDATE_CHECK: '1' },
  });
  assert.ok(!out.includes('UPDATE AVAILABLE'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
