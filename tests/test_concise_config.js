#!/usr/bin/env node
// Tests for hooks/concise-config.js - run: node tests/test_concise_config.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'hooks', 'concise-config.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-config-test-'));
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

console.log('concise-config tests\n');

test('safeWriteFile then safeReadFile round-trips content', (tmp) => {
  const { safeWriteFile, safeReadFile } = require(CONFIG);
  const target = path.join(tmp, 'sub', 'file.txt');
  safeWriteFile(target, 'hello world');
  assert.strictEqual(safeReadFile(target, 64), 'hello world');
});

test('safeReadFile returns empty string when file is missing', (tmp) => {
  const { safeReadFile } = require(CONFIG);
  assert.strictEqual(safeReadFile(path.join(tmp, 'nope.txt'), 64), '');
});

test('safeReadFile returns empty string when content exceeds cap', (tmp) => {
  const { safeWriteFile, safeReadFile } = require(CONFIG);
  const target = path.join(tmp, 'big.txt');
  safeWriteFile(target, 'x'.repeat(100));
  assert.strictEqual(safeReadFile(target, 10), '');
});

test('readFlag returns "on" for a valid on-flag file', (tmp) => {
  const { safeWriteFile, readFlag } = require(CONFIG);
  const flagPath = path.join(tmp, '.concise-active');
  safeWriteFile(flagPath, 'on');
  assert.strictEqual(readFlag(flagPath), 'on');
});

test('readFlag returns null for garbage content', (tmp) => {
  const { safeWriteFile, readFlag } = require(CONFIG);
  const flagPath = path.join(tmp, '.concise-active');
  safeWriteFile(flagPath, 'definitely-not-a-flag');
  assert.strictEqual(readFlag(flagPath), null);
});

test('readFlag returns null when the file is missing', (tmp) => {
  const { readFlag } = require(CONFIG);
  assert.strictEqual(readFlag(path.join(tmp, '.concise-active')), null);
});

test('safeWriteFile refuses to write through a symlinked target (skipped without symlink privilege)', (tmp) => {
  const { safeWriteFile, safeReadFile } = require(CONFIG);
  const secret = path.join(tmp, 'secret.txt');
  fs.writeFileSync(secret, 'ORIGINAL SECRET');
  const link = path.join(tmp, 'link.txt');
  try {
    fs.symlinkSync(secret, link);
  } catch (e) {
    console.log('  ~ skipped (no symlink privilege on this machine)');
    return;
  }
  safeWriteFile(link, 'clobbered');
  assert.strictEqual(fs.readFileSync(secret, 'utf8'), 'ORIGINAL SECRET');
});

test('appendLine then readHistory returns appended lines in order', (tmp) => {
  const { appendLine, readHistory } = require(CONFIG);
  const histPath = path.join(tmp, '.concise-history.jsonl');
  appendLine(histPath, JSON.stringify({ a: 1 }));
  appendLine(histPath, JSON.stringify({ a: 2 }));
  const lines = readHistory(histPath).map(JSON.parse);
  assert.deepStrictEqual(lines, [{ a: 1 }, { a: 2 }]);
});

test('readHistory tail-reads an oversized file instead of loading it whole', (tmp) => {
  const { appendLine, readHistory } = require(CONFIG);
  const histPath = path.join(tmp, '.concise-history.jsonl');
  for (let i = 0; i < 20; i++) appendLine(histPath, JSON.stringify({ i }));
  const lines = readHistory(histPath, 80).map(l => { try { return JSON.parse(l); } catch (e) { return null; } });
  const parsed = lines.filter(Boolean);
  assert.ok(parsed.length > 0, 'expected at least one complete parsed line from the tail');
  assert.strictEqual(parsed[parsed.length - 1].i, 19, 'the most recent entry must survive the tail-read');
});

test('getDefaultBudget falls back to 400 with no env/config', () => {
  delete process.env.CONCISE_BUDGET_WORDS;
  const configModPath = require.resolve(CONFIG);
  delete require.cache[configModPath];
  const { getDefaultBudget } = require(CONFIG);
  assert.strictEqual(getDefaultBudget(), 400);
});

test('getDefaultBudget reads CONCISE_BUDGET_WORDS env var', () => {
  process.env.CONCISE_BUDGET_WORDS = '250';
  const configModPath = require.resolve(CONFIG);
  delete require.cache[configModPath];
  const { getDefaultBudget } = require(CONFIG);
  assert.strictEqual(getDefaultBudget(), 250);
  delete process.env.CONCISE_BUDGET_WORDS;
  delete require.cache[configModPath];
});

test('getActiveBudget returns the live .concise-budget override when present', (tmp) => {
  const { safeWriteFile, getActiveBudget } = require(CONFIG);
  safeWriteFile(path.join(tmp, '.concise-budget'), '250');
  assert.strictEqual(getActiveBudget(tmp), 250);
});

test('getActiveBudget falls back to getDefaultBudget when no override file exists', (tmp) => {
  process.env.CONCISE_BUDGET_WORDS = '333';
  const configModPath = require.resolve(CONFIG);
  delete require.cache[configModPath];
  const { getActiveBudget } = require(CONFIG);
  assert.strictEqual(getActiveBudget(tmp), 333);
  delete process.env.CONCISE_BUDGET_WORDS;
  delete require.cache[configModPath];
});

test('buildRuleset includes the budget number and targets oversized code comments without touching code logic', () => {
  const { buildRuleset } = require(CONFIG);
  const ruleset = buildRuleset(400);
  assert.ok(ruleset.includes('400 words'));
  assert.ok(/code comments longer than the code they explain/i.test(ruleset));
  assert.ok(/Never touch:\n- Code logic/.test(ruleset));
  assert.ok(/elaborate.*answer that one turn in full.*return to compressed mode/is.test(ruleset));
});

test('buildRuleset defers style to other terseness modes (e.g. caveman)', () => {
  const { buildRuleset } = require(CONFIG);
  const ruleset = buildRuleset(400);
  assert.ok(/defer style to it/i.test(ruleset));
  assert.ok(/caveman/i.test(ruleset));
});

test('a project-level .concise.json overrides the global config', (tmp) => {
  const originalCwd = process.cwd();
  try {
    fs.writeFileSync(path.join(tmp, '.concise.json'), JSON.stringify({ budgetWords: 250 }));
    process.chdir(tmp);
    const configModPath = require.resolve(CONFIG);
    delete require.cache[configModPath];
    const { getDefaultBudget } = require(CONFIG);
    assert.strictEqual(getDefaultBudget(), 250);
  } finally {
    process.chdir(originalCwd);
    delete require.cache[require.resolve(CONFIG)];
  }
});

test('CONCISE_BUDGET_WORDS env var still wins over a project .concise.json', (tmp) => {
  const originalCwd = process.cwd();
  try {
    fs.writeFileSync(path.join(tmp, '.concise.json'), JSON.stringify({ budgetWords: 250 }));
    process.chdir(tmp);
    process.env.CONCISE_BUDGET_WORDS = '999';
    const configModPath = require.resolve(CONFIG);
    delete require.cache[configModPath];
    const { getDefaultBudget } = require(CONFIG);
    assert.strictEqual(getDefaultBudget(), 999);
  } finally {
    delete process.env.CONCISE_BUDGET_WORDS;
    process.chdir(originalCwd);
    delete require.cache[require.resolve(CONFIG)];
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
