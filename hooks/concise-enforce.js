#!/usr/bin/env node
// concise - SessionStart hook.
// Writes the on/off flag (default 'on') and, when active, prints the full
// compression ruleset as SessionStart context. Also nudges the user to wire
// up the statusline if it isn't configured yet.
//
// Reads stdin for the `source` field Claude Code sends on every
// SessionStart ('startup' | 'resume' | 'clear' | 'compact') - only a true
// fresh start clears a live `/concise budget <n>` override, so an
// auto-compact or a second concurrent session doesn't silently wipe it.

const fs = require('fs');
const path = require('path');
const { getDefaultFlag, getDefaultBudget, getClaudeDir, safeWriteFile, buildRuleset } = require('./concise-config');
const { checkForUpdate } = require('./concise-check-update');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  let data = {};
  try { data = JSON.parse(input); } catch (e) { /* no stdin payload */ }

  const claudeDir = getClaudeDir();
  const flagPath = path.join(claudeDir, '.concise-active');
  const budgetPath = path.join(claudeDir, '.concise-budget');
  const settingsPath = path.join(claudeDir, 'settings.json');

  // A budget set via /concise budget <n> is session-scoped, but only a true
  // fresh start should clear it - SessionStart also fires on resume/compact,
  // and clearing then would silently wipe a live override mid-session.
  if (data.source === 'startup') {
    try { fs.unlinkSync(budgetPath); } catch (e) {}
  }

  const flag = getDefaultFlag();

  if (flag === 'off') {
    try { fs.unlinkSync(flagPath); } catch (e) {}
    process.stdout.write('');
    process.exit(0);
  }

  safeWriteFile(flagPath, 'on');

  const budget = getDefaultBudget();

  let output = buildRuleset(budget);

  try {
    let hasStatusline = false;
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.statusLine) hasStatusline = true;
    }
    if (!hasStatusline) {
      const isWindows = process.platform === 'win32';
      const scriptName = isWindows ? 'concise-statusline.ps1' : 'concise-statusline.sh';
      const scriptPath = path.join(__dirname, scriptName);
      const command = isWindows
        ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
        : `bash "${scriptPath}"`;
      const snippet = '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
      output += '\n\nSTATUSLINE SETUP NEEDED: the concise plugin shows a live prose-budget bar in the ' +
        'statusline. Not configured yet. Add this to ' + settingsPath + ': ' + snippet + ' ' +
        'Proactively offer to set this up for the user on first interaction.';
    }
  } catch (e) {
    // Silent fail - don't block session start over statusline detection.
  }

  try {
    const update = await checkForUpdate();
    if (update && update.updateAvailable) {
      output += '\n\nUPDATE AVAILABLE: concise v' + update.latestVersion + ' is out (you have v' +
        update.currentVersion + '). Tell the user now: `npm update -g @0xyph3r/concise` (or ' +
        're-run `npx github:0xyph3r/CONCISE` / `claude plugin update concise`).';
    }
  } catch (e) {
    // Silent fail - never block session start over an update check.
  }

  process.stdout.write(output);
});
