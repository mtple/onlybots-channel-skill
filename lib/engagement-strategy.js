const DEFAULT_ROOT_REPLY_PROBABILITY = 0.3;
const DEFAULT_THREAD_REPLY_PROBABILITY = 0.7;
const DEFAULT_MAX_REPLIES = 2;

const replyPools = {
  direct: [
    "yeah, that's where it gets interesting.",
    "i'm with you on that thread.",
    "that feels like the useful part to chase.",
    "agreed, there's more signal there."
  ],
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

function normalizedProbability(value, fallback) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : fallback));
}

function normalizedMaxReplies(value) {
  return Math.max(0, Number.isFinite(value) ? value : DEFAULT_MAX_REPLIES);
}

function pickRandom(array, random = Math.random) {
  return array[Math.floor(random() * array.length)];
}

function replyCount(cast) {
  const candidates = [
    cast?.replies?.count,
    cast?.replies_count,
    cast?.reply_count,
    cast?.replyCount
  ];
  return candidates.find((value) => Number.isFinite(value)) || 0;
}

export function isConversationCast(cast) {
  return Boolean(
    cast?.parent_hash ||
    cast?.parentHash ||
    cast?.parent_url ||
    cast?.parentUrl ||
    cast?.root_parent_url ||
    cast?.rootParentUrl ||
    replyCount(cast) > 0
  );
}

export function classifyReply(text = '') {
  if (/@[a-z0-9_.-]+/i.test(text)) {
    return 'direct';
  }
  if (text.includes('?')) {
    return 'question';
  }
  if (/code|api|bug|error|script|deploy|build/i.test(text)) {
    return 'technical';
  }
  return 'observation';
}

export function generateReply(castText, random = Math.random) {
  const poolKey = classifyReply(castText);
  return pickRandom(replyPools[poolKey], random);
}

export function scoreCastForConversation(cast) {
  let score = 0;
  if (isConversationCast(cast)) score += 10;
  if (cast?.parent_hash || cast?.parentHash) score += 4;
  if (replyCount(cast) > 0) score += Math.min(3, replyCount(cast));
  if (cast?.text?.includes('?')) score += 2;
  if (/@[a-z0-9_.-]+/i.test(cast?.text || '')) score += 2;
  return score;
}

export function selectReplyCandidates(casts, options = {}) {
  const ownUsername = (options.ownUsername || '').toLowerCase();
  const maxReplies = normalizedMaxReplies(options.maxReplies);
  const rootReplyProbability = normalizedProbability(
    options.rootReplyProbability,
    DEFAULT_ROOT_REPLY_PROBABILITY
  );
  const threadReplyProbability = normalizedProbability(
    options.threadReplyProbability,
    DEFAULT_THREAD_REPLY_PROBABILITY
  );
  const random = options.random || Math.random;

  if (maxReplies === 0 || (rootReplyProbability === 0 && threadReplyProbability === 0)) {
    return [];
  }

  return casts
    .filter((cast) => {
      const author = cast.author?.username?.toLowerCase();
      if (!cast.hash || !author || author === ownUsername) return false;
      const probability = isConversationCast(cast) ? threadReplyProbability : rootReplyProbability;
      return random() < probability;
    })
    .sort((a, b) => scoreCastForConversation(b) - scoreCastForConversation(a))
    .slice(0, maxReplies);
}

export function engagementSettings(config = {}) {
  const legacyReplyProbability = normalizedProbability(
    config.replyProbability,
    DEFAULT_ROOT_REPLY_PROBABILITY
  );

  return {
    maxReplies: normalizedMaxReplies(config.maxRepliesPerRun),
    rootReplyProbability: normalizedProbability(
      config.rootReplyProbability,
      legacyReplyProbability
    ),
    threadReplyProbability: normalizedProbability(
      config.threadReplyProbability,
      Math.max(legacyReplyProbability, DEFAULT_THREAD_REPLY_PROBABILITY)
    )
  };
}
