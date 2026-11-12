#!/usr/bin/env node
// Tests for hooks/concise-check-update.js - run: node tests/test_concise_check_update.js
// No real network calls here - compareVersions is pure, and checkForUpdate
// is exercised only via the cache-hit path and the disabled path, which
// never touch the network.

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('node:assert');

const ROOT = path.resolve(__dirname, '..');
const CHECK = path.join(ROOT, 'hooks', 'concise-check-update.js');

let passed = 0;
let failed = 0;

// fn may be sync or return a promise - always awaited, so async tests can't
// race their own tmp-dir cleanup or report a false "passed" before their
// assertions actually run.
async function test(name, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concise-check-update-test-'));
  try {
    await fn(tmp);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  console.log('concise-check-update tests\n');

  await test('compareVersions orders correctly, including multi-digit segments', () => {
    const { compareVersions } = require(CHECK);
    assert.ok(compareVersions('0.2.0', '0.1.1') > 0);
    assert.ok(compareVersions('0.1.1', '0.2.0') < 0);
    assert.strictEqual(compareVersions('0.1.1', '0.1.1'), 0);
    assert.ok(compareVersions('0.10.0', '0.9.0') > 0, '0.10.0 must be newer than 0.9.0, not a string-compare fluke');
  });

  await test('getLocalVersion reads the real package.json version', () => {
    const { getLocalVersion } = require(CHECK);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(getLocalVersion(), pkg.version);
  });

  await test('checkForUpdate returns null immediately when CONCISE_NO_UPDATE_CHECK is set', async (tmp) => {
    const { checkForUpdate } = require(CHECK);
    process.env.CONCISE_NO_UPDATE_CHECK = '1';
    process.env.CLAUDE_CONFIG_DIR = tmp;
    try {
      const result = await checkForUpdate();
      assert.strictEqual(result, null);
    } finally {
      delete process.env.CONCISE_NO_UPDATE_CHECK;
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  });

  await test('checkForUpdate uses the cached version within the 24h window, no network needed', async (tmp) => {
    const { checkForUpdate } = require(CHECK);
    fs.writeFileSync(path.join(tmp, '.concise-update-check.json'), JSON.stringify({
      lastCheckedAt: Date.now(),
      latestKnownVersion: '999.0.0',
    }));
    process.env.CLAUDE_CONFIG_DIR = tmp;
    try {
      const result = await checkForUpdate();
      assert.strictEqual(result.latestVersion, '999.0.0');
      assert.strictEqual(result.updateAvailable, true);
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  });

  await test('checkForUpdate reports updateAvailable: false when cached version matches local', async (tmp) => {
    const { checkForUpdate, getLocalVersion } = require(CHECK);
    fs.writeFileSync(path.join(tmp, '.concise-update-check.json'), JSON.stringify({
      lastCheckedAt: Date.now(),
      latestKnownVersion: getLocalVersion(),
    }));
    process.env.CLAUDE_CONFIG_DIR = tmp;
    try {
      const result = await checkForUpdate();
      assert.strictEqual(result.updateAvailable, false);
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
  });

  // The stale-cache-triggers-a-real-network-fetch path is intentionally not
  // covered here - no fake HTTP server or dependency injection seam exists
  // for the https.get call, and hitting the real npm registry from a unit
  // test would be slow/flaky. Verified manually instead (see report).

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
