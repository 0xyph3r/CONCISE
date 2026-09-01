#!/usr/bin/env node
// concise - Stop hook. Runs after every assistant turn: measures the prose
// length of the response just produced, updates the live statusline bar,
// and appends a history snapshot.

const fs = require('fs');
const path = require('path');
const {
  getActiveBudget, getClaudeDir, safeWriteFile, safeReadFile, appendLine,
} = require('./concise-config');

const BAR_WIDTH = 20;
const MAX_STREAK_BYTES = 8;
const FILLED_CHAR = '█';
const EMPTY_CHAR = '░';

// A response under this many prose words, when the turn actually edited
// files or ran commands, is flagged as possibly under-explained rather than
// just "efficient" - a floor safety check against over-compression, not a
// semantic correctness check (which isn't possible from word count alone).
const UNDER_COMPRESSION_WORD_FLOOR = 8;
const UNDER_COMPRESSION_MARKER = ' [terse?]';

// Strip fenced code blocks before counting - a large diff must never read
// as "over budget."
function stripCodeBlocks(text) {
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  // An odd number of remaining fence markers means one code block never
  // closed (a response cut short mid-block) - strip from that final marker
  // to the end too, rather than counting the unclosed code as prose.
  const remainingFences = (stripped.match(/```/g) || []).length;
  if (remainingFences % 2 === 1) {
    return stripped.slice(0, stripped.lastIndexOf('```'));
  }
  return stripped;
}

function countProseWords(text) {
  const stripped = stripCodeBlocks(text);
  const words = stripped.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

// Returns { text, hadToolUse }. text is null when the turn had no
// assistant text block since the last real user message. hadToolUse is
// true when the same turn included a tool_use block (a file edit, a
// command run, etc.) - used to flag a suspiciously short explanation for
// real work done, not just a naturally short answer to a simple question.
function extractLastAssistantText(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); }
  catch (e) { return { text: null, hadToolUse: false }; }

  // Accumulates every assistant text block since the last real user
  // message, not just the final one, so tool-call preambles count too.
  // A tool_result `user` entry continues the same turn, so it doesn't
  // reset the accumulator.
  let textBlocksSinceLastUserMessage = [];
  let sawAnyAssistantText = false;
  let hadToolUse = false;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (e) { continue; }

    if (entry.type === 'user') {
      const content = entry.message && entry.message.content;
      const isRealUserMessage = typeof content === 'string' ||
        (Array.isArray(content) && !content.some(b => b && b.type === 'tool_result'));
      if (isRealUserMessage) {
        textBlocksSinceLastUserMessage = [];
        hadToolUse = false;
      }
      continue;
    }

    if (entry.type !== 'assistant' || !entry.message || !Array.isArray(entry.message.content)) continue;
    const textBlocks = entry.message.content
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text);
    if (textBlocks.length > 0) {
      textBlocksSinceLastUserMessage.push(...textBlocks);
      sawAnyAssistantText = true;
    }
    if (entry.message.content.some(b => b && b.type === 'tool_use')) hadToolUse = true;
  }
  return {
    text: sawAnyAssistantText ? textBlocksSinceLastUserMessage.join('\n') : null,
    hadToolUse,
  };
}

// words/budget are shown alongside the percent so the number is
// self-explanatory at a glance - "62%" alone doesn't say of what.
function formatBar(percent, words, budget) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * BAR_WIDTH);
  const bar = FILLED_CHAR.repeat(filled) + EMPTY_CHAR.repeat(BAR_WIDTH - filled);
  const label = percent > 100
    ? `${percent}% (${words}/${budget}w) OVER`
    : `${percent}% (${words}/${budget}w)`;
  return `[${bar}] ${label}`;
}

function computeTurn({ text, budget }) {
  const words = countProseWords(text);
  const percent = budget > 0 ? Math.round((words / budget) * 100) : 0;
  return { words, percent, bar: formatBar(percent, words, budget) };
}

function main() {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    let data = {};
    try { data = JSON.parse(input); } catch (e) { /* no stdin payload - nothing to measure */ }

    const claudeDir = getClaudeDir();
    const barPath = path.join(claudeDir, '.concise-statusline-bar');
    const streakPath = path.join(claudeDir, '.concise-streak');
    const historyPath = path.join(claudeDir, '.concise-history.jsonl');

    const transcriptPath = data.transcript_path;
    if (!transcriptPath) { process.exit(0); return; }

    const { text, hadToolUse } = extractLastAssistantText(transcriptPath);
    if (text === null) { process.exit(0); return; }

    const budget = getActiveBudget(claudeDir);
    const { words, percent, bar } = computeTurn({ text, budget });
    const underCompressed = hadToolUse && words < UNDER_COMPRESSION_WORD_FLOOR;

    safeWriteFile(barPath, underCompressed ? bar + UNDER_COMPRESSION_MARKER : bar);

    const prevStreak = parseInt(safeReadFile(streakPath, MAX_STREAK_BYTES).trim(), 10) || 0;
    const streak = percent > 100 ? prevStreak + 1 : 0;
    safeWriteFile(streakPath, String(streak));

    appendLine(historyPath, JSON.stringify({
      ts: Date.now(),
      session_id: data.session_id || null,
      words,
      budget,
      percent,
      underCompressed,
      // Present on SubagentStop only - lets /concise-stats tell a
      // subagent's measured turn apart from the main session's.
      agentType: data.agent_type || null,
    }));

    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { stripCodeBlocks, countProseWords, extractLastAssistantText, formatBar, computeTurn };
