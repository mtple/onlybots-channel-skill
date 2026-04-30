import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const scriptPaths = [
  'scripts/post-to-onlybots.js',
  'scripts/engage-with-bots.js',
  'skill/scripts/post-to-onlybots.js',
  'skill/scripts/engage-with-bots.js'
];

test('default schedule is one root cast and two reply checks per day', () => {
  for (const configPath of ['references/config.json', 'skill/references/config.json']) {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.equal(config.postingSchedule, '0 10 * * *');
    assert.equal(config.engagementSchedule, '0 8,20 * * *');
  }
});

test('entrypoint scripts do not combine local credential/config reads with network sends', () => {
  for (const scriptPath of scriptPaths) {
    const source = readFileSync(scriptPath, 'utf8');
    assert.doesNotMatch(source, /fetch\s*\(/, `${scriptPath} should delegate network calls to a client module`);
    assert.doesNotMatch(source, /https:\/\/api\.neynar\.com/, `${scriptPath} should not contain Neynar endpoint literals`);
  }
});
