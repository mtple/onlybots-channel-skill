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
  'skill/SKILL.md',
  'skill/package.json',
  'skill/package-lock.json',
  'skill/references/config.json',
  'skill/scripts/post-to-onlybots.js',
  'skill/scripts/engage-with-bots.js',
  'skill/scripts/setup-cron.js',
  'skill/scripts/teardown-cron.js',
  'skill/lib/neynar-client.js',
  'skill/lib/runtime.js',
  'skill/lib/engagement-strategy.js'
];

const secretAssignmentPattern = /\b(?:[A-Za-z0-9]+[_\s-]+)*(?:(?:api|client|consumer)[_\s-]?(?:secret|key|token)|secret[_\s-]?key|access[_\s-]?(?:token|key|secret|grant)|auth[_\s-]?token|bearer(?:[_\s-]?token)?|private[_\s-]?key|service[_\s-]?role[_\s-]?key|github[_\s-]?(?:pat|token)|(?:openrouter|supabase|storj)[_\s-]?(?:key|token|secret|access[_\s-]?grant)|password)\b\s*[:=]\s*["'`]?([A-Za-z0-9][A-Za-z0-9._~+/=-]{15,})["'`]?/i;
const authHeaderSecretPattern = /\b(?:authorization|x-api-key|x-api-secret)\b\s*[:=]\s*(?:Bearer\s+)?["'`]?([A-Za-z0-9][A-Za-z0-9._~+/=-]{15,})["'`]?/i;
const cgnatHttpUrlPattern = /http:\/\/100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(?::\d+)?(?:\/[^\s"'`]*)?/i;
const rawIpUrlPattern = /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/|["'])/i;
const suspiciousInstallSourcePattern = /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\//i;
const destructiveDeletePattern = /\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*\s+(["']?)(\/root\/\.openclaw\/|\/home\/[^/\s"'`]+\/\.openclaw\/|\/Users\/[^/\s"'`]+\/\.openclaw\/|~\/\.openclaw\/|\$HOME\/\.openclaw\/|\$\{HOME\}\/\.openclaw\/|\/etc\/|\/usr\/|\/opt\/|\/Library\/|\/Applications\/)[^\s"'`;|&)]*\1/i;
const dynamicCodePattern = /\beval\s*\(|new\s+Function\s*\(|\b(?:[A-Za-z_][A-Za-z0-9_]*\.)?loader\.exec_module\s*\(/;
const insecureTlsPattern = /ssl\._create_unverified_context\s*\(|ssl\.CERT_NONE\b|check_hostname\s*=\s*False\b|verify\s*=\s*False\b|rejectUnauthorized\s*:\s*false\b|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0["']?/i;
const obfuscatedCodePattern = /(\\x[0-9a-fA-F]{2}){6,}|(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/;
const generatedSourcePlaceholderPattern = /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=.*["']\$\{[A-Za-z_][A-Za-z0-9_-]*\}["']/m;
const generatedSourceContextPattern = /```(?:python|py|javascript|js|typescript|ts|shell|bash|sh)\b|cat\s*(?:>|>>)?\s*[^`\n]*\.(?:py|js|ts|sh)\b|python3?\b|node\b/i;
const promptInjectionPattern = /ignore\s+(all\s+)?previous\s+instructions|system\s*prompt\s*[:=]/i;
const broadEnvPattern = /Object\.(?:keys|values|entries)\s*\(\s*process\.env\s*\)|process\.env(?!\s*(?:\.|\[))|process\.env\[\s*[^"'`\]]/;
const processEnvReferencePatterns = [
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  /process\.env\[\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*\]/g
];
const declaredEnvNames = new Set([
  'NEYNAR_API_KEY',
  'NEYNAR_SIGNER_UUID',
  'FARCASTER_USERNAME',
  'OPENCLAW_GATEWAY_TOKEN'
]);

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

function referencedEnvNames(source) {
  const names = new Set();
  for (const pattern of processEnvReferencePatterns) {
    for (const match of source.matchAll(pattern)) {
      names.add(match[1].toUpperCase());
    }
  }
  return names;
}

function suspiciousStaticScanFindings(filePath, source) {
  const findings = [];
  const hasNetworkSend = /\bfetch\b|http\.request|\baxios\b/.test(source);

  if (exposedSecretLines(source).length > 0) findings.push('suspicious.exposed_secret_literal');
  if (cgnatHttpUrlPattern.test(source)) findings.push('suspicious.exposed_resource_identifier');
  if (dynamicCodePattern.test(source)) findings.push('suspicious.dynamic_code_execution');
  if (insecureTlsPattern.test(source)) findings.push('suspicious.insecure_tls_verification');
  if (obfuscatedCodePattern.test(source)) findings.push('suspicious.obfuscated_code');
  if (/stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i.test(source)) findings.push('malicious.crypto_mining');

  if (/\.(js|ts|mjs|cjs|mts|cts|jsx|tsx|py|sh|bash|zsh|rb|go)$/i.test(filePath)) {
    if (/child_process/.test(source) && /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/.test(source)) {
      findings.push('suspicious.dangerous_exec');
    }
    if (/readFileSync|readFile/.test(source) && hasNetworkSend) {
      findings.push('suspicious.potential_exfiltration');
    }
    if (/process\.env/.test(source) && hasNetworkSend) {
      const refs = referencedEnvNames(source);
      const accessesOnlyDeclared = refs.size > 0 && [...refs].every((name) => declaredEnvNames.has(name)) && !broadEnvPattern.test(source);
      if (!accessesOnlyDeclared) findings.push('suspicious.env_credential_access');
    }
  }

  if (/\.(md|markdown|mdx)$/i.test(filePath)) {
    if (promptInjectionPattern.test(source)) findings.push('suspicious.prompt_injection_instructions');
    if (destructiveDeletePattern.test(source)) findings.push('suspicious.destructive_delete_command');
    if (generatedSourcePlaceholderPattern.test(source) && generatedSourceContextPattern.test(source)) {
      findings.push('suspicious.generated_source_template_injection');
    }
  }

  if (/\.(json|yaml|yml|toml)$/i.test(filePath)) {
    if (suspiciousInstallSourcePattern.test(source) || rawIpUrlPattern.test(source)) {
      findings.push('suspicious.install_untrusted_source');
    }
  }

  return findings;
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
    assert.match(source, /rootReplyProbability\s*===\s*0\s*&&\s*threadReplyProbability\s*===\s*0/, `${scriptPath} should explicitly support zero root and thread probabilities`);
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

test('version and dependencies are exactly pinned for the 1.0.3 ClawHub upload', () => {
  for (const pkgPath of ['package.json', 'skill/package.json']) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.version, '1.0.3');
    assert.equal(pkg.dependencies?.dotenv, '16.4.3');
  }
  for (const lockPath of ['package-lock.json', 'skill/package-lock.json']) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.equal(lock.version, '1.0.3');
    assert.equal(lock.packages?.['']?.version, '1.0.3');
    assert.equal(lock.packages?.['']?.dependencies?.dotenv, '16.4.3');
    assert.equal(lock.packages?.['node_modules/dotenv']?.version, '16.4.3');
  }
  for (const skillPath of ['SKILL.md', 'skill/SKILL.md']) {
    const source = readFileSync(skillPath, 'utf8');
    assert.match(source, /package: dotenv@16\.4\.3/, `${skillPath} should pin the OpenClaw install package`);
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

test('upload package has no findings under mirrored ClawHub static rules', () => {
  for (const filePath of uploadPaths) {
    const source = readFileSync(filePath, 'utf8');
    assert.deepEqual(suspiciousStaticScanFindings(filePath.replace(/^skill\//, ''), source), [], `${filePath} matches a ClawHub static security rule`);
  }
});
