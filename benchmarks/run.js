#!/usr/bin/env node
// concise - benchmark harness. Measures real prose-word reduction by
// calling the live Anthropic API twice per task (baseline vs. with the
// CONCISE ruleset as system prompt) and comparing output length using the
// exact same word-counting logic the plugin itself uses at runtime.
//
// No results are committed to this repo - this needs a real run against
// the live API to produce honest numbers. Run it and open a PR with the
// generated benchmarks/results/<date>.json if you want to contribute.
//
// Run:     ANTHROPIC_API_KEY=sk-... node benchmarks/run.js
// Optional: ANTHROPIC_MODEL=claude-sonnet-5 (default), CONCISE_BUDGET_WORDS=400 (default)

const https = require('https');
const fs = require('fs');
const path = require('path');
const { buildRuleset, getDefaultBudget } = require('../hooks/concise-config');
const { countProseWords } = require('../hooks/concise-stats');
const tasks = require('./tasks');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 1024;

function callMessages(apiKey, { system, prompt }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const text = (parsed.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n');
          resolve(text);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Pure, independently testable - kept separate from the network call so
// the reduction math has its own test coverage without needing a live key.
function computeReduction(baselineWords, conciseWords) {
  if (baselineWords <= 0) return 0;
  return Math.round(((baselineWords - conciseWords) / baselineWords) * 100);
}

async function runTask(apiKey, task, budget) {
  const baselineText = await callMessages(apiKey, { prompt: task.prompt });
  const conciseText = await callMessages(apiKey, { system: buildRuleset(budget), prompt: task.prompt });
  const baselineWords = countProseWords(baselineText);
  const conciseWords = countProseWords(conciseText);
  return {
    task: task.name,
    baselineWords,
    conciseWords,
    reductionPercent: computeReduction(baselineWords, conciseWords),
  };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('benchmarks/run.js: ANTHROPIC_API_KEY is not set.');
    console.error('Run: ANTHROPIC_API_KEY=sk-... node benchmarks/run.js');
    process.exit(1);
  }

  const budget = getDefaultBudget();
  const results = [];
  for (const task of tasks) {
    process.stdout.write(`running ${task.name}... `);
    try {
      const result = await runTask(apiKey, task, budget);
      results.push(result);
      console.log(`${result.baselineWords} -> ${result.conciseWords} words (${result.reductionPercent}% reduction)`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }

  if (results.length === 0) {
    console.error('\nNo tasks completed successfully - no results to report.');
    process.exit(1);
  }

  const avgReduction = Math.round(
    results.reduce((sum, r) => sum + r.reductionPercent, 0) / results.length
  );
  console.log(`\nAverage prose-word reduction across ${results.length} tasks: ${avgReduction}%`);

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    date: new Date().toISOString(),
    model: MODEL,
    budget,
    results,
    avgReductionPercent: avgReduction,
  }, null, 2) + '\n');
  console.log(`Results written to ${outPath}`);
}

if (require.main === module) main();

module.exports = { computeReduction };
