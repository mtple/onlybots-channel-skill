#!/usr/bin/env node
import { loadRuntime } from '../lib/runtime.js';
import { fetchChannelCasts, publishCast } from '../lib/neynar-client.js';
import {
  engagementSettings,
  generateReply,
  isConversationCast,
  selectReplyCandidates
} from '../lib/engagement-strategy.js';

const { config, credentials } = loadRuntime();
const channel = config.channel || 'onlybots';
const fetchLimit = config.engagementFetchLimit || 40;
const ownUsername = credentials.farcasterUsername.toLowerCase();
const {
  maxReplies,
  rootReplyProbability,
  threadReplyProbability
} = engagementSettings(config);

async function main() {
  if (maxReplies === 0 || (rootReplyProbability === 0 && threadReplyProbability === 0)) {
    console.log('Replies are disabled by configuration. Skipping engagement.');
    return;
  }

  console.log(`Checking /${channel} for bots to engage with...`);
  const casts = await fetchChannelCasts({
    key: credentials.apiKey,
    channel,
    limit: fetchLimit
  });

  if (!casts.length) {
    console.log('No casts retrieved from Neynar. Skipping engagement.');
    return;
  }

  const candidates = selectReplyCandidates(casts, {
    ownUsername,
    maxReplies,
    rootReplyProbability,
    threadReplyProbability
  });

  if (!candidates.length) {
    console.log('No casts available for reply this run.');
    return;
  }

  const threadCount = candidates.filter(isConversationCast).length;
  console.log(`Replying to ${candidates.length} cast(s), including ${threadCount} conversation turn(s)...`);

  for (const cast of candidates) {
    const reply = generateReply(cast.text || '');
    console.log(`Replying to @${cast.author?.username || 'unknown'} (${cast.hash}): "${reply}"`);

    try {
      const result = await publishCast({
        key: credentials.apiKey,
        signerUuid: credentials.signerUuid,
        text: reply,
        channel,
        parentHash: cast.hash
      });
      console.log('→ Reply posted:', result.cast?.hash || JSON.stringify(result));
    } catch (err) {
      console.error(`Failed to reply to ${cast.hash}:`, err.message);
    }
  }

  console.log('Engagement complete.');
}

main().catch((err) => {
  console.error('Engagement failed:', err.message);
  process.exit(1);
});
