// concise - benchmark task set. Representative coding-assistant prompts
// where a model's default style tends to add the prose CONCISE targets:
// preambles, trailing summaries, restated context, hedging.
//
// Each task is a realistic single-turn request with an embedded code
// snippet - no conversation history, so the comparison is a clean
// same-prompt A/B between the baseline system prompt and the CONCISE one.

module.exports = [
  {
    name: 'fix-bug',
    prompt: 'Fix the bug in this function:\n\n```js\nfunction isEven(n) {\n  return n % 2 = 0;\n}\n```',
  },
  {
    name: 'explain-function',
    prompt: 'What does this function do?\n\n```js\nfunction debounce(fn, ms) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n}\n```',
  },
  {
    name: 'add-error-handling',
    prompt: 'Add error handling to this function:\n\n```js\nasync function fetchUser(id) {\n  const res = await fetch(`/api/users/${id}`);\n  return res.json();\n}\n```',
  },
  {
    name: 'review-diff',
    prompt: 'Review this diff for issues:\n\n```diff\n- if (user.role === "admin") {\n+ if (user.role = "admin") {\n    grantAccess(user);\n  }\n```',
  },
  {
    name: 'rename-variable',
    prompt: 'Rename the variable `d` to `elapsedMs` in this function:\n\n```js\nfunction timeSince(start) {\n  const d = Date.now() - start;\n  return d;\n}\n```',
  },
  {
    name: 'explain-test-failure',
    prompt: 'Why is this test failing?\n\n```js\ntest("adds numbers", () => {\n  expect(add(2, 2)).toBe(5);\n});\n```\n\nError: expect(received).toBe(expected)\nExpected: 5\nReceived: 4',
  },
];
