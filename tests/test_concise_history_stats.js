#!/usr/bin/env node
// Tests for hooks/concise-history-stats.js - run: node tests/test_concise_history_stats.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const STATS = path.join(ROOT, 'hooks', 'concise-history-stats.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-history-stats-test-'));
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

console.log('concise-history-stats tests\n');

test('parseHistory skips malformed lines and keeps well-formed entries', () => {
  const { parseHistory } = require(STATS);
  const lines = [
    JSON.stringify({ ts: 1, words: 100, budget: 400, percent: 25 }),
    'not json',
    JSON.stringify({ ts: 2, words: 'not a number', budget: 400, percent: 25 }),
    JSON.stringify({ ts: 3, words: 500, budget: 400, percent: 125 }),
  ];
  const entries = parseHistory(lines);
  assert.strictEqual(entries.length, 2);
  assert.strictEqual(entries[0].percent, 25);
  assert.strictEqual(entries[1].percent, 125);
});

test('summarize computes avg percent, over-budget count/rate, and total words', () => {
  const { summarize } = require(STATS);
  const entries = [
    { words: 100, budget: 400, percent: 25 },
    { words: 500, budget: 400, percent: 125 },
    { words: 400, budget: 400, percent: 100 },
    { words: 800, budget: 400, percent: 200 },
  ];
  const s = summarize(entries);
  assert.strictEqual(s.turns, 4);
  assert.strictEqual(s.avgPercent, Math.round((25 + 125 + 100 + 200) / 4));
  assert.strictEqual(s.overBudgetCount, 2);
  assert.strictEqual(s.overBudgetRate, 50);
  assert.strictEqual(s.totalWords, 1800);
});

test('summarize returns null for no entries', () => {
  const { summarize } = require(STATS);
  assert.strictEqual(summarize([]), null);
});

test('formatReport reports "no turns tracked" when summary is null', () => {
  const { formatReport } = require(STATS);
  const out = formatReport(null);
  assert.ok(/no turns tracked/i.test(out));
});

test('formatReport never claims a "saved" or extrapolated figure - measured stats only', () => {
  const { formatReport } = require(STATS);
  const out = formatReport({ turns: 5, avgPercent: 80, overBudgetCount: 1, overBudgetRate: 20, totalWords: 900 });
  assert.ok(!/saved/i.test(out), 'report must not fabricate a savings claim');
  assert.ok(out.includes('5'));
  assert.ok(out.includes('80%'));
  assert.ok(out.includes('900'));
});

test('main() reads real history file and prints a report end-to-end', (tmp) => {
  const historyPath = path.join(tmp, '.concise-history.jsonl');
  fs.writeFileSync(historyPath, [
    JSON.stringify({ words: 100, budget: 400, percent: 25 }),
    JSON.stringify({ words: 500, budget: 400, percent: 125 }),
  ].join('\n') + '\n');
  const out = execFileSync(process.execPath, [STATS], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp },
  });
  assert.ok(out.includes('Turns tracked:         2'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
