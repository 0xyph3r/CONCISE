#!/usr/bin/env node
// concise - lifetime stats aggregator. Reads .concise-history.jsonl
// (appended by concise-stats.js after every measured turn) and reports
// aggregate numbers: turns tracked, average % of budget used, over-budget
// rate, total prose words. Never reports an extrapolated "tokens saved"
// figure - only what was directly measured.
//
// Run directly: node hooks/concise-history-stats.js
// Inside Claude Code: /concise-stats triggers this via the UserPromptSubmit hook.

const path = require('path');
const { getClaudeDir, readHistory } = require('./concise-config');

function parseHistory(lines) {
  const entries = [];
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }
    if (!entry || typeof entry.percent !== 'number' ||
        typeof entry.words !== 'number' || typeof entry.budget !== 'number') continue;
    entries.push(entry);
  }
  return entries;
}

function summarize(entries) {
  if (entries.length === 0) return null;
  const totalPercent = entries.reduce((sum, e) => sum + e.percent, 0);
  const totalWords = entries.reduce((sum, e) => sum + e.words, 0);
  const overBudget = entries.filter(e => e.percent > 100).length;
  return {
    turns: entries.length,
    avgPercent: Math.round(totalPercent / entries.length),
    overBudgetCount: overBudget,
    overBudgetRate: Math.round((overBudget / entries.length) * 100),
    totalWords,
  };
}

function formatReport(summary) {
  const sep = '--------------------------------';
  if (!summary) {
    return `\nConcise Stats\n${sep}\nNo turns tracked yet - stats appear after the first measured response.\n${sep}\n`;
  }
  return `\nConcise Stats - Lifetime\n${sep}\n` +
    `Turns tracked:         ${summary.turns.toLocaleString()}\n` +
    `Avg. % of budget used: ${summary.avgPercent}%\n` +
    `Over-budget turns:     ${summary.overBudgetCount.toLocaleString()} (${summary.overBudgetRate}%)\n` +
    `Total prose words:     ${summary.totalWords.toLocaleString()}\n${sep}\n`;
}

function main() {
  const claudeDir = getClaudeDir();
  const historyPath = path.join(claudeDir, '.concise-history.jsonl');
  const entries = parseHistory(readHistory(historyPath));
  process.stdout.write(formatReport(summarize(entries)));
}

if (require.main === module) main();

module.exports = { parseHistory, summarize, formatReport };
