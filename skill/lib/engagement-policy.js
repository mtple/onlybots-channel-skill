const DEFAULT_CONFIG = {
  maxRepliesPerRun: 2,
  replyProbability: 0.3,
  rootReplyProbability: undefined,
  threadReplyProbability: 0.65,
  maxThreadTurnsPerBot: 3,
  maxThreadAgeMinutes: 90,
  cooldownBetweenRepliesMinutes: 10
};

function clampProbability(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

function normalizeConfig(config = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  const rootProbability = clampProbability(
    merged.rootReplyProbability ?? merged.replyProbability,
    DEFAULT_CONFIG.replyProbability
  );

  return {
    ...merged,
    maxRepliesPerRun: Math.max(0, Number.isFinite(Number(merged.maxRepliesPerRun)) ? Number(merged.maxRepliesPerRun) : DEFAULT_CONFIG.maxRepliesPerRun),
    rootReplyProbability: rootProbability,
    replyProbability: rootProbability,
    threadReplyProbability: clampProbability(merged.threadReplyProbability, DEFAULT_CONFIG.threadReplyProbability),
    maxThreadTurnsPerBot: Math.max(0, Number.isFinite(Number(merged.maxThreadTurnsPerBot)) ? Number(merged.maxThreadTurnsPerBot) : DEFAULT_CONFIG.maxThreadTurnsPerBot),
    maxThreadAgeMinutes: Math.max(0, Number.isFinite(Number(merged.maxThreadAgeMinutes)) ? Number(merged.maxThreadAgeMinutes) : DEFAULT_CONFIG.maxThreadAgeMinutes),
    cooldownBetweenRepliesMinutes: Math.max(0, Number.isFinite(Number(merged.cooldownBetweenRepliesMinutes)) ? Number(merged.cooldownBetweenRepliesMinutes) : DEFAULT_CONFIG.cooldownBetweenRepliesMinutes)
  };
}

function usernameOf(cast) {
  return cast?.author?.username?.toLowerCase() || '';
}

function getParentHash(cast) {
  return cast?.parent_hash || cast?.parentHash || cast?.parent?.hash || null;
}

function getRootHash(cast) {
  return cast?.root_parent_hash || cast?.rootParentHash || cast?.root?.hash || null;
}

function castTimestamp(cast) {
  const raw = cast?.timestamp || cast?.created_at || cast?.createdAt;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / 60000;
}

function normalizeState(state = {}) {
  return {
    threads: state.threads && typeof state.threads === 'object' ? state.threads : {}
  };
}

function isOwnCast(cast, ownUsername) {
  return usernameOf(cast) === String(ownUsername || '').toLowerCase();
}

function isRootCast(cast) {
  return Boolean(cast?.hash) && !getParentHash(cast) && !getRootHash(cast);
}

function findThreadEntryForCast(cast, state = {}) {
  const normalized = normalizeState(state);
  const parentHash = getParentHash(cast);
  const rootHash = getRootHash(cast);

  if (rootHash && normalized.threads[rootHash]) {
    return [rootHash, normalized.threads[rootHash]];
  }

  if (parentHash && normalized.threads[parentHash]) {
    return [parentHash, normalized.threads[parentHash]];
  }

  if (parentHash) {
    const match = Object.entries(normalized.threads).find(([, thread]) => thread?.lastReplyHash === parentHash);
    if (match) return match;
  }

  return null;
}

function deriveThreadHashForReplyTarget(targetCast, state = {}) {
  const existing = findThreadEntryForCast(targetCast, state);
  if (existing) return existing[0];
  return getRootHash(targetCast) || getParentHash(targetCast) || targetCast?.hash;
}

export function shouldEndConversation(cast) {
  const text = String(cast?.text || '').trim().toLowerCase();
  if (!text) return true;

  const compact = text.replace(/[\s.!?,]+$/g, '');
  const normalizedCompact = compact.replace(/[,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  const acknowledgementPatterns = [
    /^(yeah|yep|yes|true|totally|agreed|agree|fair|nice|cool|ok|okay|exactly|same|right)(\s+(same|agreed|agree|true|exactly|fair|yeah))?$/,
    /^(solid point|good point|that tracks|makes sense|sounds good)$/,
    /^(thanks|thank you|appreciate it)$/
  ];

  return acknowledgementPatterns.some((pattern) => pattern.test(normalizedCompact));
}

export function shouldContinueThread({ cast, thread, config = {}, now = new Date(), repliedHashes = new Set(), ownUsername } = {}) {
  const settings = normalizeConfig(config);
  if (!cast?.hash || !thread || thread.status === 'ended') return false;
  if (ownUsername && isOwnCast(cast, ownUsername)) return false;
  if (repliedHashes.has(cast.hash)) return false;
  if (shouldEndConversation(cast)) return false;
  if (Number(thread.ourTurnCount || 0) >= settings.maxThreadTurnsPerBot) return false;

  const lastReplyAt = thread.lastReplyAt ? new Date(thread.lastReplyAt) : null;
  if (lastReplyAt && !Number.isNaN(lastReplyAt.getTime())) {
    if (settings.maxThreadAgeMinutes > 0 && minutesBetween(now, lastReplyAt) > settings.maxThreadAgeMinutes) {
      return false;
    }
    if (settings.cooldownBetweenRepliesMinutes > 0 && minutesBetween(now, lastReplyAt) < settings.cooldownBetweenRepliesMinutes) {
      return false;
    }

    const ts = castTimestamp(cast);
    if (ts && ts.getTime() <= lastReplyAt.getTime()) {
      return false;
    }
  }

  const parentHash = getParentHash(cast);
  return Boolean(parentHash && thread.lastReplyHash && parentHash === thread.lastReplyHash) || Boolean(findThreadEntryForCast(cast, { threads: { [thread.threadHash]: thread } }));
}

export function selectEngagementCandidates({
  casts = [],
  ownUsername,
  repliedHashes = new Set(),
  threadState = {},
  config = {},
  now = new Date(),
  random = Math.random
} = {}) {
  const settings = normalizeConfig(config);
  if (settings.maxRepliesPerRun <= 0) return [];

  const state = normalizeState(threadState);
  const eligible = casts.filter((cast) => cast?.hash && !isOwnCast(cast, ownUsername) && !repliedHashes.has(cast.hash));

  const threadCandidates = [];
  const rootCandidates = [];

  for (const cast of eligible) {
    const threadEntry = findThreadEntryForCast(cast, state);
    if (threadEntry) {
      const [threadHash, thread] = threadEntry;
      if (
        shouldContinueThread({ cast, thread: { ...thread, threadHash: thread.threadHash || threadHash }, config: settings, now, repliedHashes, ownUsername }) &&
        random() < settings.threadReplyProbability
      ) {
        threadCandidates.push({ cast, reason: 'continue-thread', threadHash });
      }
      continue;
    }

    if (isRootCast(cast) && random() < settings.rootReplyProbability) {
      rootCandidates.push({ cast, reason: 'root-discovery', threadHash: cast.hash });
    }
  }

  const byNewest = (a, b) => {
    const at = castTimestamp(a.cast)?.getTime() || 0;
    const bt = castTimestamp(b.cast)?.getTime() || 0;
    return bt - at;
  };

  return [...threadCandidates.sort(byNewest), ...rootCandidates.sort(byNewest)].slice(0, settings.maxRepliesPerRun);
}

export function updateThreadStateAfterReply({ state = {}, targetCast, replyHash, ownUsername, now = new Date() } = {}) {
  const normalized = normalizeState(state);
  if (!targetCast?.hash || !replyHash) return normalized;

  const threadHash = deriveThreadHashForReplyTarget(targetCast, normalized);
  if (!threadHash) return normalized;

  const existing = normalized.threads[threadHash] || {};
  const participants = new Set(existing.participants || []);
  if (ownUsername) participants.add(String(ownUsername).toLowerCase());
  if (targetCast.author?.username) participants.add(String(targetCast.author.username).toLowerCase());

  normalized.threads[threadHash] = {
    ...existing,
    threadHash,
    status: 'active',
    participants: Array.from(participants),
    lastSeenHash: targetCast.hash,
    lastReplyHash: replyHash,
    lastReplyAt: now.toISOString(),
    ourTurnCount: Number(existing.ourTurnCount || 0) + 1
  };

  return normalized;
}

export function pruneThreadState(state = {}, { now = new Date(), maxThreadAgeMinutes = DEFAULT_CONFIG.maxThreadAgeMinutes } = {}) {
  const normalized = normalizeState(state);
  const pruned = { threads: {} };
  for (const [threadHash, thread] of Object.entries(normalized.threads)) {
    const lastReplyAt = thread.lastReplyAt ? new Date(thread.lastReplyAt) : null;
    if (lastReplyAt && !Number.isNaN(lastReplyAt.getTime()) && minutesBetween(now, lastReplyAt) > maxThreadAgeMinutes * 2) {
      continue;
    }
    pruned.threads[threadHash] = thread;
  }
  return pruned;
}
