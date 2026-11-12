#!/usr/bin/env node
// concise - UserPromptSubmit hook. Handles /concise commands and, when
// active, re-injects a short reminder every turn so the model doesn't drift
// back to verbose over a long session.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getActiveBudget, getClaudeDir, safeWriteFile, safeReadFile, readFlag,
} = require('./concise-config');

const claudeDir = getClaudeDir();
const flagPath = path.join(claudeDir, '.concise-active');
const budgetPath = path.join(claudeDir, '.concise-budget');
const barPath = path.join(claudeDir, '.concise-statusline-bar');
const streakPath = path.join(claudeDir, '.concise-streak');

const ESCALATION_THRESHOLD = 3;
const MAX_STREAK_BYTES = 8;
const MAX_BAR_BYTES = 100; // bar uses 3-byte UTF-8 block chars now - 20 blocks + label can hit ~72 bytes

// /concise level <name> - named presets on top of the same budget mechanism
// /concise budget <n> uses, for users who'd rather pick a preset than a
// raw word count.
const INTENSITY_LEVELS = { light: 600, normal: 400, strict: 200 };

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const prompt = (data.prompt || '').trim();
    const lower = prompt.toLowerCase();

    // /concise-stats blocks the prompt and returns the lifetime aggregate
    // report as the block reason instead - same pattern the caveman plugin
    // uses for its own /caveman-stats.
    if (/^\/concise(?::concise)?-stats$/.test(lower)) {
      try {
        const statsPath = path.join(__dirname, 'concise-history-stats.js');
        const out = execFileSync(process.execPath, [statsPath], {
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir },
          timeout: 5000,
        });
        process.stdout.write(JSON.stringify({ decision: 'block', reason: out.trim() }));
      } catch (e) {
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason: 'concise-stats: could not run stats script.\nTry manually: node hooks/concise-history-stats.js',
        }));
      }
      return;
    }

    // (?::concise)? matches the namespaced form for a same-named
    // plugin+command pair, e.g. "/concise:concise budget 300".
    const match = /^\/concise(?::concise)?(?:\s+(.*))?$/.exec(lower);
    if (match) {
      const arg = (match[1] || '').trim();
      if (arg === 'off') {
        try { fs.unlinkSync(flagPath); } catch (e) {}
      } else if (arg === 'on' || arg === '') {
        safeWriteFile(flagPath, 'on');
      } else {
        const budgetMatch = /^budget\s+(\d+)$/.exec(arg);
        const levelMatch = /^level\s+(light|normal|strict)$/.exec(arg);
        if (budgetMatch && Number(budgetMatch[1]) > 0) {
          safeWriteFile(budgetPath, budgetMatch[1]);
        } else if (levelMatch) {
          safeWriteFile(budgetPath, String(INTENSITY_LEVELS[levelMatch[1]]));
        }
      }
    }

    // Adjacency-anchored so "keep your answer concise and stop repeating
    // yourself" doesn't false-positive (an earlier unbounded `.*` version did).
    if (/\b(stop|disable|turn off)\s+concise(\s+mode)?\b/i.test(lower) ||
        /\bconcise\s+mode\s+(off|stop|disable)\b/i.test(lower)) {
      try { fs.unlinkSync(flagPath); } catch (e) {}
    }

    const active = readFlag(flagPath);
    if (active === 'on') {
      const budget = getActiveBudget(claudeDir);
      const bar = safeReadFile(barPath, MAX_BAR_BYTES).trim();
      const streak = parseInt(safeReadFile(streakPath, MAX_STREAK_BYTES).trim(), 10) || 0;

      let context = 'CONCISE MODE ACTIVE. Cut prose filler (summaries, restated context, ' +
        'hedging, long preambles). Code/commits/security/analysis depth stay full. ' +
        'If another terseness mode (e.g. caveman) is also active, defer style to it. ' +
        `Budget: ${budget} words.`;
      if (bar) context += ` Last response: ${bar}.`;
      if (streak >= ESCALATION_THRESHOLD) {
        context += ` ${streak} responses over budget in a row - tighten up now.`;
      }

      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: context,
        },
      }));
    }
  } catch (e) {
    // Silent fail
  }
});
