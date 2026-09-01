#!/usr/bin/env node
// Tests for benchmarks/run.js's pure logic - run: node tests/test_benchmarks_run.js
// No network calls, no API key needed - only computeReduction and the task
// list shape are testable without hitting the live API.

const path = require('path');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, 'benchmarks', 'run.js');
const TASKS = path.join(ROOT, 'benchmarks', 'tasks.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

console.log('benchmarks/run.js tests\n');

test('computeReduction returns 0 for a zero-word baseline', () => {
  const { computeReduction } = require(RUN);
  assert.strictEqual(computeReduction(0, 0), 0);
  assert.strictEqual(computeReduction(0, 50), 0);
});

test('computeReduction computes a positive percent when concise is shorter', () => {
  const { computeReduction } = require(RUN);
  assert.strictEqual(computeReduction(200, 100), 50);
  assert.strictEqual(computeReduction(400, 300), 25);
});

test('computeReduction returns a negative percent when concise is longer', () => {
  const { computeReduction } = require(RUN);
  assert.strictEqual(computeReduction(100, 150), -50);
});

test('tasks.js exports a non-empty array of {name, prompt} objects', () => {
  const tasks = require(TASKS);
  assert.ok(Array.isArray(tasks));
  assert.ok(tasks.length > 0);
  for (const task of tasks) {
    assert.strictEqual(typeof task.name, 'string');
    assert.ok(task.name.length > 0);
    assert.strictEqual(typeof task.prompt, 'string');
    assert.ok(task.prompt.length > 0);
  }
});

test('task names are unique', () => {
  const tasks = require(TASKS);
  const names = tasks.map(t => t.name);
  assert.strictEqual(new Set(names).size, names.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
