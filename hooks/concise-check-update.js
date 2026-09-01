#!/usr/bin/env node
// concise - checks the npm registry for a newer published version, at most
// once per 24h (cached), and reports whether an update is available. Never
// downloads or executes anything - only reads a version string; the user
// runs the actual update command themselves.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { getClaudeDir, safeReadFile, safeWriteFile } = require('./concise-config');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 2500;
const MAX_CACHE_BYTES = 200;
const REGISTRY_URL = 'https://registry.npmjs.org/@0xyph3r%2fconcise/latest';

function getLocalVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch (e) {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0, nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function fetchLatestVersion() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    const req = https.get(REGISTRY_URL, { timeout: NETWORK_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          done(typeof parsed.version === 'string' ? parsed.version : null);
        } catch (e) {
          done(null);
        }
      });
    });
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', () => done(null));
  });
}

function readCache(cachePath) {
  const raw = safeReadFile(cachePath, MAX_CACHE_BYTES);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// Returns { updateAvailable, currentVersion, latestVersion } or null when
// the check can't be completed (no local version, no network, disabled).
// Never throws, never blocks longer than NETWORK_TIMEOUT_MS.
async function checkForUpdate() {
  if (process.env.CONCISE_NO_UPDATE_CHECK) return null;

  const currentVersion = getLocalVersion();
  if (!currentVersion) return null;

  const claudeDir = getClaudeDir();
  const cachePath = path.join(claudeDir, '.concise-update-check.json');
  const cache = readCache(cachePath);
  const now = Date.now();

  let latestVersion;
  if (cache && typeof cache.lastCheckedAt === 'number' && (now - cache.lastCheckedAt) < CHECK_INTERVAL_MS) {
    latestVersion = cache.latestKnownVersion;
  } else {
    latestVersion = await fetchLatestVersion();
    if (latestVersion) {
      safeWriteFile(cachePath, JSON.stringify({ lastCheckedAt: now, latestKnownVersion: latestVersion }));
    } else if (cache) {
      latestVersion = cache.latestKnownVersion; // network failed - fall back to stale cache
    }
  }

  if (!latestVersion) return null;
  return {
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    currentVersion,
    latestVersion,
  };
}

module.exports = { checkForUpdate, compareVersions, getLocalVersion };
