#!/usr/bin/env node
// concise - one-command installer (npx github:0xyph3r/CONCISE).
//
// Copies the hook scripts into <claudeDir>/hooks/concise and merges the
// hook + statusLine wiring into <claudeDir>/settings.json. Safe to re-run:
// never duplicates a hook entry already present, and never overwrites an
// existing statusLine set by something else (prints manual instructions
// instead - Claude Code allows only one statusLine command).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC_DIR = path.join(__dirname, '..');
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const destDir = path.join(claudeDir, 'hooks', 'concise');
const settingsPath = path.join(claudeDir, 'settings.json');

function copyHooks() {
  fs.mkdirSync(destDir, { recursive: true });
  const hooksDir = path.join(SRC_DIR, 'hooks');
  for (const name of fs.readdirSync(hooksDir)) {
    fs.copyFileSync(path.join(hooksDir, name), path.join(destDir, name));
  }
}

function loadSettings() {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    console.error(`concise: ${settingsPath} is not valid JSON - leaving it untouched.`);
    console.error('Wire the hooks manually instead - see README.md "Standalone install".');
    process.exit(1);
  }
}

function hookCommand(file) {
  return `node "${path.join(destDir, file)}"`;
}

// Appends a new hook group for `event` unless a group with the exact same
// command is already present (idempotent re-run). Never touches or removes
// any existing hook - other plugins' entries for the same event are left
// alone. `matcher` is only needed for events like PreToolUse that filter
// by tool name (e.g. "Task" for the subagent-dispatch tool).
function ensureHook(settings, event, file, statusMessage, matcher) {
  settings.hooks = settings.hooks || {};
  settings.hooks[event] = settings.hooks[event] || [];
  const command = hookCommand(file);
  const alreadyWired = settings.hooks[event].some(
    group => Array.isArray(group.hooks) && group.hooks.some(h => h.command === command)
  );
  if (alreadyWired) return false;
  const group = { hooks: [{ type: 'command', command, timeout: 5, statusMessage }] };
  if (matcher) group.matcher = matcher;
  settings.hooks[event].push(group);
  return true;
}

// Claude Code allows exactly one statusLine command. Never overwrite one
// that's already set - print the snippet instead so the user can combine
// it with whatever else is already wired.
function ensureStatusLine(settings) {
  const isWindows = process.platform === 'win32';
  const scriptPath = path.join(destDir, isWindows ? 'concise-statusline.ps1' : 'concise-statusline.sh');
  const command = isWindows
    ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
    : `bash "${scriptPath}"`;

  if (settings.statusLine) {
    return { status: 'skipped', command };
  }
  settings.statusLine = { type: 'command', command };
  return { status: 'set', command };
}

function main() {
  copyHooks();
  const settings = loadSettings();

  if (fs.existsSync(settingsPath)) {
    fs.copyFileSync(settingsPath, settingsPath + '.bak-concise-install');
  }

  const wiredSession = ensureHook(settings, 'SessionStart', 'concise-enforce.js', 'Loading concise mode...');
  const wiredPrompt = ensureHook(settings, 'UserPromptSubmit', 'concise-remind.js', 'Reminding concise mode...');
  const wiredStop = ensureHook(settings, 'Stop', 'concise-stats.js', 'Measuring response length...');
  const wiredSubagentStop = ensureHook(settings, 'SubagentStop', 'concise-stats.js', 'Measuring subagent response length...');
  const wiredPreTool = ensureHook(settings, 'PreToolUse', 'concise-inject-subagent.js', 'Injecting concise rules into subagent...', 'Task');
  const statusResult = ensureStatusLine(settings);

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  console.log(`concise hooks copied to ${destDir}`);
  console.log(
    wiredSession || wiredPrompt || wiredStop || wiredSubagentStop || wiredPreTool
      ? `Hooks wired into ${settingsPath}`
      : `Hooks already wired in ${settingsPath} - nothing changed.`
  );

  if (statusResult.status === 'set') {
    console.log('Statusline configured.');
  } else {
    console.log('A statusLine command is already set in settings.json - not overwritten.');
    console.log('Add the concise badge manually (or combine it with your existing one):');
    console.log(`  ${statusResult.command}`);
  }

  console.log('\nRestart Claude Code (or start a new session) to activate concise.');
}

main();
