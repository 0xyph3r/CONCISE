#!/usr/bin/env node
// Tests for bin/install.js - run: node tests/test_bin_install.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INSTALLER = path.join(ROOT, 'bin', 'install.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-install-test-'));
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

function run(tmp) {
  return execFileSync(process.execPath, [INSTALLER], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CONFIG_DIR: tmp },
  });
}

function readSettings(tmp) {
  return JSON.parse(fs.readFileSync(path.join(tmp, 'settings.json'), 'utf8'));
}

console.log('bin/install.js tests\n');

test('fresh install copies all hook files and wires all four hooks + statusLine', (tmp) => {
  run(tmp);
  const destDir = path.join(tmp, 'hooks', 'concise');
  for (const f of ['concise-config.js', 'concise-enforce.js', 'concise-remind.js', 'concise-stats.js', 'concise-statusline.sh', 'concise-statusline.ps1']) {
    assert.ok(fs.existsSync(path.join(destDir, f)), `missing ${f}`);
  }
  const settings = readSettings(tmp);
  assert.ok(settings.hooks.SessionStart[0].hooks[0].command.includes('concise-enforce.js'));
  assert.ok(settings.hooks.UserPromptSubmit[0].hooks[0].command.includes('concise-remind.js'));
  assert.ok(settings.hooks.Stop[0].hooks[0].command.includes('concise-stats.js'));
  assert.ok(settings.hooks.SubagentStop[0].hooks[0].command.includes('concise-stats.js'));
  assert.ok(settings.hooks.PreToolUse[0].hooks[0].command.includes('concise-inject-subagent.js'));
  assert.strictEqual(settings.hooks.PreToolUse[0].matcher, 'Task');
  assert.ok(settings.statusLine.command.includes('concise-statusline'));
});

test('re-running the installer does not duplicate hook entries', (tmp) => {
  run(tmp);
  run(tmp);
  const settings = readSettings(tmp);
  assert.strictEqual(settings.hooks.SessionStart.length, 1);
  assert.strictEqual(settings.hooks.UserPromptSubmit.length, 1);
  assert.strictEqual(settings.hooks.Stop.length, 1);
  assert.strictEqual(settings.hooks.SubagentStop.length, 1);
  assert.strictEqual(settings.hooks.PreToolUse.length, 1);
});

test('an existing hook for the same event from another plugin is preserved, not replaced', (tmp) => {
  fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "/other/plugin/hook.js"' }] }] },
  }));
  run(tmp);
  const settings = readSettings(tmp);
  assert.strictEqual(settings.hooks.SessionStart.length, 2);
  assert.ok(settings.hooks.SessionStart.some(g => g.hooks[0].command.includes('/other/plugin/hook.js')));
  assert.ok(settings.hooks.SessionStart.some(g => g.hooks[0].command.includes('concise-enforce.js')));
});

test('an existing statusLine from something else is never overwritten', (tmp) => {
  fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({
    statusLine: { type: 'command', command: 'bash /other/plugin/statusline.sh' },
  }));
  run(tmp);
  const settings = readSettings(tmp);
  assert.strictEqual(settings.statusLine.command, 'bash /other/plugin/statusline.sh');
});

test('unrelated existing settings fields are preserved untouched', (tmp) => {
  fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ model: 'sonnet', theme: 'dark' }));
  run(tmp);
  const settings = readSettings(tmp);
  assert.strictEqual(settings.model, 'sonnet');
  assert.strictEqual(settings.theme, 'dark');
});

test('a backup of the pre-existing settings.json is written before any change', (tmp) => {
  fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ model: 'sonnet' }));
  run(tmp);
  const backupPath = path.join(tmp, 'settings.json.bak-concise-install');
  assert.ok(fs.existsSync(backupPath));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(backupPath, 'utf8')), { model: 'sonnet' });
});

test('malformed existing settings.json is left untouched and the installer exits non-zero', (tmp) => {
  fs.writeFileSync(path.join(tmp, 'settings.json'), '{ not valid json');
  assert.throws(() => run(tmp));
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'settings.json'), 'utf8'), '{ not valid json');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
