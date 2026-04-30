import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const scriptPaths = [
  'scripts/post-to-onlybots.js',
  'scripts/engage-with-bots.js',
  'skill/scripts/post-to-onlybots.js',
  'skill/scripts/engage-with-bots.js'
];

const uploadPaths = [
  'skill/scripts/post-to-onlybots.js',
  'skill/scripts/engage-with-bots.js',
  'skill/lib/neynar-client.js',
  'skill/lib/runtime.js'
];

const secretAssignmentPattern = /\b(?:[A-Za-z0-9]+[_\s-]+)*(?:(?:api|client|consumer)[_\s-]?(?:secret|key|token)|secret[_\s-]?key|access[_\s-]?(?:token|key|secret|grant)|auth[_\s-]?token|bearer(?:[_\s-]?token)?|private[_\s-]?key|service[_\s-]?role[_\s-]?key|github[_\s-]?(?:pat|token)|(?:openrouter|supabase|storj)[_\s-]?(?:key|token|secret|access[_\s-]?grant)|password)\b\s*[:=]\s*["'`]?([A-Za-z0-9][A-Za-z0-9._~+/=-]{15,})["'`]?/i;
const authHeaderSecretPattern = /\b(?:authorization|x-api-key|x-api-secret)\b\s*[:=]\s*(?:Bearer\s+)?["'`]?([A-Za-z0-9][A-Za-z0-9._~+/=-]{15,})["'`]?/i;

function looksLikePlaceholderSecret(secret) {
  const normalized = secret.trim().toLowerCase();
  if (!normalized) return true;
  if (/^(?:x+|_+|-+|\*+|\.{3})$/.test(normalized)) return true;
  if (/process\.env\.|os\.environ[.[]|getenv\s*\(/.test(normalized)) return true;
  return /(your|example|placeholder|change-?me|replace|redacted|dummy|sample|test-token|token-here|secret-here|api-key-here)/i.test(normalized);
}

function exposedSecretLines(source) {
  return source
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => {
      const match = line.match(secretAssignmentPattern) ?? line.match(authHeaderSecretPattern);
      const secret = match?.[1];
      return secret && !looksLikePlaceholderSecret(secret);
    });
}

test('default schedule is one root cast and two reply checks per day', () => {
  for (const configPath of ['references/config.json', 'skill/references/config.json']) {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(config.postingSchedule, '0 10 * * *');
    assert.equal(config.engagementSchedule, '0 8,20 * * *');
  }
});

test('reply controls are hard caps with no forced fallback reply', () => {
  for (const scriptPath of ['scripts/engage-with-bots.js', 'skill/scripts/engage-with-bots.js']) {
    const source = readFileSync(scriptPath, 'utf8');
    assert.match(source, /maxReplies\s*===\s*0/, `${scriptPath} should explicitly support disabled replies`);
    assert.match(source, /replyProbability\s*===\s*0/, `${scriptPath} should explicitly support zero probability`);
    assert.doesNotMatch(source, /Always reply to at least one/i, `${scriptPath} should not force a reply`);
    assert.doesNotMatch(source, /candidates\s*=\s*\[otherBotCasts\[0\]\]/, `${scriptPath} should not override empty candidates`);
  }
});

test('setup cron uses script directory rather than caller working directory', () => {
  for (const scriptPath of ['scripts/setup-cron.js', 'skill/scripts/setup-cron.js']) {
    const source = readFileSync(scriptPath, 'utf8');
    assert.doesNotMatch(source, /process\.cwd\s*\(/, `${scriptPath} should not depend on caller cwd`);
    assert.match(source, /resolve\(__dirname, '\.\.'\)/, `${scriptPath} should derive skill root from script location`);
  }
});

test('dependencies are exactly pinned and upload package includes a lockfile', () => {
  for (const pkgPath of ['package.json', 'skill/package.json']) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.dependencies?.dotenv, '16.4.3');
  }
  assert.equal(existsSync('package-lock.json'), true);
  assert.equal(existsSync('skill/package-lock.json'), true);
});

test('entrypoint scripts do not combine local credential/config reads with network sends', () => {
  for (const scriptPath of scriptPaths) {
    const source = readFileSync(scriptPath, 'utf8');
    assert.doesNotMatch(source, /fetch\s*\(/, `${scriptPath} should delegate network calls to a client module`);
    assert.doesNotMatch(source, /https:\/\/api\.neynar\.com/, `${scriptPath} should not contain Neynar endpoint literals`);
  }
});

test('upload files avoid hardcoded-secret scanner patterns', () => {
  for (const filePath of uploadPaths) {
    const source = readFileSync(filePath, 'utf8');
    const matches = exposedSecretLines(source);
    assert.deepEqual(matches, [], `${filePath} has exposed-secret-looking lines`);
  }
});
