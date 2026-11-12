#!/usr/bin/env node
// concise - shared configuration + hardened file I/O helpers.
//
// Default budget/flag resolution order:
//   1. CONCISE_BUDGET_WORDS / CONCISE_DEFAULT environment variable
//   2. Project config: <cwd>/.concise.json (checked in, repo-specific)
//   3. Global config: ~/.config/concise/config.json (or platform equivalent)
//   4. 400 words / 'on'

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_BUDGET_WORDS = 400;
const FLAG_VALUES = ['on', 'off'];

function getConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'concise');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'concise'
    );
  }
  return path.join(os.homedir(), '.config', 'concise');
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json');
}

function readJsonConfig(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function getProjectConfigPath() {
  return path.join(process.cwd(), '.concise.json');
}

// Project config first, falling back to the global one - a checked-in
// .concise.json expresses repo-specific intent, ahead of a personal default.
function readConfigFile() {
  const project = readJsonConfig(getProjectConfigPath());
  const global_ = readJsonConfig(getConfigPath());
  return { ...global_, ...project };
}

function getDefaultBudget() {
  const envVal = process.env.CONCISE_BUDGET_WORDS;
  if (envVal && /^\d+$/.test(envVal) && Number(envVal) > 0) {
    return Number(envVal);
  }
  const config = readConfigFile();
  if (config.budgetWords && Number.isFinite(config.budgetWords) && config.budgetWords > 0) {
    return Math.round(config.budgetWords);
  }
  return DEFAULT_BUDGET_WORDS;
}

function getDefaultFlag() {
  const envVal = (process.env.CONCISE_DEFAULT || '').toLowerCase();
  if (FLAG_VALUES.includes(envVal)) return envVal;
  const config = readConfigFile();
  if (FLAG_VALUES.includes(config.default)) return config.default;
  return 'on';
}

// Live `/concise budget <n>` override, else getDefaultBudget(). Both
// concise-stats.js and concise-remind.js call this, never getDefaultBudget()
// directly, so a budget change applies to both immediately.
function getActiveBudget(claudeDir) {
  const overridePath = path.join(claudeDir, '.concise-budget');
  const raw = safeReadFile(overridePath, 8).trim();
  if (/^\d+$/.test(raw) && Number(raw) > 0) return Number(raw);
  return getDefaultBudget();
}

function getClaudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// The exact compression ruleset concise-enforce.js injects at SessionStart.
// Shared here so benchmarks/run.js measures against the real deployed
// rules instead of a copy that can drift out of sync.
function buildRuleset(budget) {
  return 'CONCISE MODE ACTIVE.\n\n' +
    'Goal: cut prose filler around the work. Never touch capability, depth, or correctness.\n\n' +
    'If another terseness mode is also active (e.g. caveman), defer style to it - ' +
    'this only adds the measurement/bar and the specific cuts below, not a competing grammar rule.\n\n' +
    'Compress only:\n' +
    '- Trailing summaries ("to conclude...", "in summary...")\n' +
    '- Restating what a diff or code block already shows\n' +
    '- Politeness, hedging, filler phrases\n' +
    '- Re-explaining context already visible (file paths, prior turns)\n' +
    '- Tool-call preambles beyond one short sentence\n' +
    '- Code comments longer than the code they explain - the why in one line, or not at all\n\n' +
    'Never touch:\n' +
    '- Code logic, structure, commit messages, PR descriptions - full normal writing\n' +
    '- Analysis or reasoning depth - never skip a step to look shorter\n' +
    '- Security warnings, irreversible-action confirmations - full clarity\n' +
    '- Multi-step instructions where compression risks misread\n\n' +
    'Prose budget this session: ' + budget + ' words per response (code blocks excluded from the count).\n' +
    'If the user asks to elaborate or go into more detail, answer that one turn in full, ' +
    'then return to compressed mode on the next turn - no need to toggle off and back on.\n' +
    'Stay active every turn. Off: "/concise off" or "stop concise mode".';
}

// Resolve the immediate parent dir, refusing a symlink outside the current
// user's ownership (or, without getuid, outside the home directory). Only
// checks one level - fine since every caller's file sits directly under
// claudeDir/getConfigDir(), never nested deeper.
function resolveSafeDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const lstat = fs.lstatSync(dir);
  if (!lstat.isSymbolicLink()) return dir;

  const real = fs.realpathSync(dir);
  const realStat = fs.statSync(real);
  if (!realStat.isDirectory()) return null;

  if (typeof process.getuid === 'function') {
    if (realStat.uid !== process.getuid()) return null;
  } else {
    const home = path.resolve(os.homedir()).toLowerCase();
    const normalizedReal = path.resolve(real).toLowerCase();
    if (normalizedReal !== home && !normalizedReal.startsWith(home + path.sep)) return null;
  }
  return real;
}

// Symlink-safe atomic write: refuses to write through a symlink at the
// target path, writes to a temp file, then renames into place. Silent
// no-op on any filesystem error - every file this module writes is
// best-effort cached state, never required for correctness.
function safeWriteFile(filePath, content) {
  let tmp;
  try {
    const dir = resolveSafeDir(path.dirname(filePath));
    if (!dir) return;
    const target = path.join(dir, path.basename(filePath));

    try {
      if (fs.lstatSync(target).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }

    tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(tmp, flags, 0o600);
      fs.writeSync(fd, String(content));
      try { fs.fchmodSync(fd, 0o600); } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    fs.renameSync(tmp, target);
  } catch (e) {
    // Silent fail - every caller treats this as best-effort cache state.
    // Clean up the temp file if the write got that far but a later step
    // (write/rename) failed - otherwise a failure on a high-frequency path
    // (the statusline render) can litter ~/.claude with orphaned .tmp files.
    if (tmp) { try { fs.unlinkSync(tmp); } catch (e2) {} }
  }
}

// Symlink-safe, size-capped read. Returns '' on any anomaly (missing file,
// symlink, oversized, unreadable) - callers never see partial/garbage data.
function safeReadFile(filePath, maxBytes) {
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return '';
    if (st.size > maxBytes) return '';
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(filePath, flags);
      const buf = Buffer.alloc(maxBytes);
      const n = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.slice(0, n).toString('utf8');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch (e) {
    return '';
  }
}

// Read the on/off flag. Returns 'on', 'off', or null if missing/invalid.
function readFlag(flagPath) {
  const raw = safeReadFile(flagPath, 8).trim().toLowerCase();
  return FLAG_VALUES.includes(raw) ? raw : null;
}

// Append a line to a JSONL history file. Same symlink hardening as
// safeWriteFile, opened with O_APPEND so concurrent sessions don't clobber
// each other.
function appendLine(filePath, line) {
  try {
    const dir = resolveSafeDir(path.dirname(filePath));
    if (!dir) return;
    const target = path.join(dir, path.basename(filePath));
    try {
      if (fs.lstatSync(target).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | O_NOFOLLOW;
    let fd;
    try {
      fd = fs.openSync(target, flags, 0o600);
      fs.writeSync(fd, String(line).replace(/\n$/, '') + '\n');
      try { fs.fchmodSync(fd, 0o600); } catch (e) { /* best-effort on Windows */ }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  } catch (e) {
    // Silent fail - history is best-effort.
  }
}

// Caps a hostile oversized file, same hardening goal as safeReadFile's
// maxBytes - 5MB is plenty for a lifetime of turn snapshots.
const MAX_HISTORY_BYTES = 5 * 1024 * 1024;

function readHistory(filePath, maxBytes) {
  const cap = maxBytes || MAX_HISTORY_BYTES;
  try {
    const st = fs.lstatSync(filePath);
    if (st.isSymbolicLink() || !st.isFile()) return [];
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
    const oversized = st.size > cap;
    let fd;
    let raw;
    try {
      fd = fs.openSync(filePath, flags);
      if (!oversized) {
        raw = fs.readFileSync(fd, 'utf8');
      } else {
        // Tail-read the most recent `cap` bytes - a history log legitimately
        // grows over time, unlike the small fixed-size flag/bar files.
        const buf = Buffer.alloc(cap);
        fs.readSync(fd, buf, 0, cap, st.size - cap);
        raw = buf.toString('utf8');
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    const lines = raw.split('\n').filter(l => l.trim());
    // A tail-read's first line may be a partial mid-line fragment - drop it.
    if (oversized && lines.length > 0) lines.shift();
    return lines;
  } catch (e) {
    return [];
  }
}

module.exports = {
  DEFAULT_BUDGET_WORDS, FLAG_VALUES,
  getConfigDir, getConfigPath, getProjectConfigPath, getDefaultBudget, getActiveBudget, getDefaultFlag, getClaudeDir,
  safeWriteFile, safeReadFile, readFlag, appendLine, readHistory, buildRuleset,
};
