# Benchmarks

Measures real prose-word reduction: for each task in `tasks.js`, calls the
live Anthropic API twice - once with no system prompt (baseline), once
with the exact `buildRuleset()` output `concise-enforce.js` injects at
SessionStart (concise) - and compares output length using the same
`countProseWords` logic the plugin itself uses at runtime.

**No results are committed to this repo.** Every number here needs a real
API call to produce - nothing is estimated or extrapolated. Run it
yourself:

```
ANTHROPIC_API_KEY=sk-... node benchmarks/run.js
```

Optional env vars:

- `ANTHROPIC_MODEL` - defaults to `claude-sonnet-5`.
- `CONCISE_BUDGET_WORDS` - the per-response budget passed to the concise
  system prompt (defaults to 400, same default as the plugin).

Writes a timestamped JSON file to `benchmarks/results/` with per-task
word counts and the average reduction percent across all tasks. Open a
PR adding your `benchmarks/results/*.json` if you want to contribute a
real, reproducible number - state the model and date in the PR
description.

## Why no committed numbers yet

Caveman's own benchmark suite (which CONCISE takes inspiration from) has
real measured results from actual runs. CONCISE doesn't yet - this
harness exists so the "average reduction" claim in the README, whenever
it's added, is backed by a real run and not a guess.
