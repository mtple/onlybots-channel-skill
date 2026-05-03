#!/usr/bin/env node
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pruneThreadState,
  selectEngagementCandidates,
  updateThreadStateAfterReply
} from '../lib/engagement-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(resolve(__dirname, '../references/config.json'), 'utf8'));

const { NEYNAR_API_KEY, NEYNAR_SIGNER_UUID, FARCASTER_USERNAME } = process.env;
if (!NEYNAR_API_KEY || !NEYNAR_SIGNER_UUID || !FARCASTER_USERNAME) {
  console.error('Missing NEYNAR_API_KEY, NEYNAR_SIGNER_UUID, or FARCASTER_USERNAME in .env');
  process.exit(1);
}

const channel = config.channel || 'onlybots';
const fetchLimit = config.engagementFetchLimit || 40;
const ownUsername = FARCASTER_USERNAME.toLowerCase();
const threadStatePath = resolve(__dirname, config.threadStatePath || '../state/onlybots-threads.json');
const repliedStatePath = resolve(__dirname, config.repliedStatePath || '../state/onlybots-replied.json');
const maxRepliedHistory = config.maxRepliedHistory || 200;

const replyPools = {
  question: [
    "good question. been thinking about that too.",
    "depends on the context, but generally yes.",
    "not sure there's a single answer to that.",
    "i'd say it varies by implementation."
  ],
  observation: [
    "solid point.",
    "hadn't thought about it that way.",
    "that tracks.",
    "interesting angle."
  ],
  technical: [
    "that's the tricky part.",
    "same experience here.",
    "hit that issue before.",
    "worth exploring further."
  ]
};

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function loadRepliedHashes() {
  const data = readJson(repliedStatePath, { replied: [] });
  return new Set(Array.isArray(data.replied) ? data.replied : []);
}

function saveRepliedHashes(set) {
  const replied = Array.from(set).slice(-maxRepliedHistory);
  writeJson(repliedStatePath, { replied });
}

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function classifyReply(text) {
  if (text?.includes('?')) {
    return 'question';
  }
  if (/code|api|bug|error|script|deploy|build/i.test(text)) {
    return 'technical';
  }
  return 'observation';
}

function generateReply(castText) {
  const poolKey = classifyReply(castText);
  return pickRandom(replyPools[poolKey]);
}

async function fetchChannelCasts() {
  const url = new URL('https://api.neynar.com/v2/farcaster/feed/channels');
  url.searchParams.set('channel_ids', channel);
  url.searchParams.set('with_recasts', 'false');
  url.searchParams.set('limit', String(fetchLimit));

  const resp = await fetch(url, {
    headers: {
      'x-api-key': NEYNAR_API_KEY
    }
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to fetch casts (${resp.status}): ${body}`);
  }

  const data = await resp.json();
  return data.casts || [];
}

async function postReply(text, parentHash) {
  const payload = {
    signer_uuid: NEYNAR_SIGNER_UUID,
    text,
    channel_id: channel,
    parent: parentHash
  };

  const resp = await fetch('https://api.neynar.com/v2/farcaster/cast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': NEYNAR_API_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Failed to post a reply (${resp.status}): ${body}`);
  }

  return resp.json();
}

async function main() {
  console.log(`Checking /${channel} for bots to engage with...`);
  const casts = await fetchChannelCasts();

  if (!casts.length) {
    console.log('No casts retrieved from Neynar. Skipping engagement.');
    return;
  }

  const now = new Date();
  const repliedHashes = loadRepliedHashes();
  let threadState = pruneThreadState(readJson(threadStatePath, { threads: {} }), {
    now,
    maxThreadAgeMinutes: config.maxThreadAgeMinutes || 90
  });

  const candidates = selectEngagementCandidates({
    casts,
    ownUsername,
    repliedHashes,
    threadState,
    config,
    now
  });

  if (!candidates.length) {
    console.log('No casts selected for reply this run.');
    saveRepliedHashes(repliedHashes);
    writeJson(threadStatePath, threadState);
    return;
  }

  console.log(`Replying to ${candidates.length} cast(s)...`);

  for (const candidate of candidates) {
    const { cast, reason } = candidate;
    const reply = generateReply(cast.text || '');
    console.log(`Replying to @${cast.author?.username || 'unknown'} (${cast.hash}, ${reason}): "${reply}"`);

    try {
      const result = await postReply(reply, cast.hash);
      const replyHash = result.cast?.hash;
      console.log('→ Reply posted:', replyHash || JSON.stringify(result));
      repliedHashes.add(cast.hash);
      if (replyHash) {
        threadState = updateThreadStateAfterReply({
          state: threadState,
          targetCast: cast,
          replyHash,
          ownUsername,
          now: new Date()
        });
      }
    } catch (err) {
      console.error(`Failed to reply to ${cast.hash}:`, err.message);
    }
  }

  saveRepliedHashes(repliedHashes);
  writeJson(threadStatePath, threadState);
  console.log('Engagement complete.');
}

main().catch((err) => {
  console.error('Engagement failed:', err.message);
  process.exit(1);
});
