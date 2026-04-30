import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyReply,
  isConversationCast,
  selectReplyCandidates
} from '../lib/engagement-strategy.js';

const ownUsername = 'tortmusic.eth';

function cast(overrides) {
  return {
    hash: `0x${Math.random().toString(16).slice(2)}`,
    text: 'ordinary root cast',
    author: { username: 'otherbot' },
    timestamp: '2026-04-30T12:00:00.000Z',
    ...overrides
  };
}

test('conversation casts are detected from parent/thread metadata and reply counts', () => {
  assert.equal(isConversationCast(cast({ parent_hash: '0xparent' })), true);
  assert.equal(isConversationCast(cast({ parentHash: '0xparent' })), true);
  assert.equal(isConversationCast(cast({ parent_url: 'chain://eip155:8453/erc721:1' })), true);
  assert.equal(isConversationCast(cast({ parentUrl: 'chain://eip155:8453/erc721:1' })), true);
  assert.equal(isConversationCast(cast({ replies: { count: 2 } })), true);
  assert.equal(isConversationCast(cast({ replies_count: 2 })), true);
  assert.equal(isConversationCast(cast({})), false);
});

test('thread-aware selection prefers active conversation turns over root casts', () => {
  const casts = [
    cast({ hash: '0xroot1', text: 'root note', author: { username: 'alpha' } }),
    cast({ hash: '0xthread1', text: 'thread reply', author: { username: 'beta' }, parent_hash: '0xparent' }),
    cast({ hash: '0xroot2', text: 'another root', author: { username: 'gamma' } }),
    cast({ hash: '0xthread2', text: 'ongoing discussion?', author: { username: 'delta' }, replies: { count: 3 } })
  ];

  const selected = selectReplyCandidates(casts, {
    ownUsername,
    maxReplies: 2,
    rootReplyProbability: 1,
    threadReplyProbability: 1,
    random: () => 0
  });

  assert.deepEqual(selected.map((item) => item.hash), ['0xthread2', '0xthread1']);
});

test('thread reply probability can disable root replies while keeping conversations alive', () => {
  const casts = [
    cast({ hash: '0xroot', text: 'root note', author: { username: 'alpha' } }),
    cast({ hash: '0xthread', text: 'thread reply', author: { username: 'beta' }, parent_hash: '0xparent' })
  ];

  const selected = selectReplyCandidates(casts, {
    ownUsername,
    maxReplies: 2,
    rootReplyProbability: 0,
    threadReplyProbability: 1,
    random: () => 0
  });

  assert.deepEqual(selected.map((item) => item.hash), ['0xthread']);
});

test('selection filters self-authored and hashless casts before scoring', () => {
  const selected = selectReplyCandidates([
    cast({ hash: '0xself', author: { username: ownUsername }, parent_hash: '0xparent' }),
    cast({ hash: '', author: { username: 'other' }, parent_hash: '0xparent' }),
    cast({ hash: '0xok', author: { username: 'other' }, parent_hash: '0xparent' })
  ], {
    ownUsername,
    maxReplies: 2,
    rootReplyProbability: 1,
    threadReplyProbability: 1,
    random: () => 0
  });

  assert.deepEqual(selected.map((item) => item.hash), ['0xok']);
});

test('reply classifier recognizes conversation and mention cues', () => {
  assert.equal(classifyReply('what do you think?'), 'question');
  assert.equal(classifyReply('this deploy hit an api bug'), 'technical');
  assert.equal(classifyReply('@tortmusic.eth curious how you handle this'), 'direct');
  assert.equal(classifyReply('i agree with the direction'), 'observation');
});
