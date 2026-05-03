import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectEngagementCandidates,
  shouldContinueThread,
  shouldEndConversation,
  updateThreadStateAfterReply
} from '../lib/engagement-policy.js';

const ownUsername = 'tortmusic.eth';
const baseConfig = {
  maxRepliesPerRun: 2,
  replyProbability: 0,
  rootReplyProbability: 0,
  threadReplyProbability: 1,
  maxThreadTurnsPerBot: 3,
  maxThreadAgeMinutes: 90,
  cooldownBetweenRepliesMinutes: 0
};

function cast(overrides = {}) {
  return {
    hash: '0xroot',
    text: 'anyone thinking about agent memory?',
    timestamp: '2026-05-03T12:00:00Z',
    author: { username: 'otherbot.eth' },
    ...overrides
  };
}

test('active thread replies are prioritized even when root discovery probability is zero', () => {
  const threadState = {
    threads: {
      '0xroot': {
        threadHash: '0xroot',
        status: 'active',
        ourTurnCount: 1,
        lastReplyHash: '0xours1',
        lastReplyAt: '2026-05-03T11:55:00Z'
      }
    }
  };

  const root = cast({ hash: '0xnewroot', text: 'a standalone root cast' });
  const followUp = cast({
    hash: '0xfollowup',
    text: 'that raises a real question: should agents remember tone across threads?',
    parent_hash: '0xours1'
  });

  const selected = selectEngagementCandidates({
    casts: [root, followUp],
    ownUsername,
    repliedHashes: new Set(),
    threadState,
    config: baseConfig,
    now: new Date('2026-05-03T12:00:00Z'),
    random: () => 0.99
  });

  assert.deepEqual(selected.map((item) => item.cast.hash), ['0xfollowup']);
  assert.equal(selected[0].reason, 'continue-thread');
});

test('threads stop naturally on acknowledgements and exhausted turn budgets', () => {
  assert.equal(shouldEndConversation(cast({ text: 'yeah, agreed.' })), true);

  assert.equal(
    shouldContinueThread({
      cast: cast({ hash: '0xfollowup', text: 'what should the next turn do?', parent_hash: '0xours1' }),
      thread: { status: 'active', ourTurnCount: 3, lastReplyHash: '0xours1', lastReplyAt: '2026-05-03T11:55:00Z' },
      config: baseConfig,
      now: new Date('2026-05-03T12:00:00Z')
    }),
    false
  );
});

test('thread state advances after successful replies and preserves the root thread id', () => {
  const state = { threads: {} };
  const target = cast({ hash: '0xroot', text: 'what do other bots think?' });
  updateThreadStateAfterReply({
    state,
    targetCast: target,
    replyHash: '0xours1',
    ownUsername,
    now: new Date('2026-05-03T12:00:00Z')
  });

  assert.equal(state.threads['0xroot'].threadHash, '0xroot');
  assert.equal(state.threads['0xroot'].lastReplyHash, '0xours1');
  assert.equal(state.threads['0xroot'].ourTurnCount, 1);
  assert.equal(state.threads['0xroot'].status, 'active');

  updateThreadStateAfterReply({
    state,
    targetCast: cast({ hash: '0xfollowup', parent_hash: '0xours1', text: 'yes, and what about cooldowns?' }),
    replyHash: '0xours2',
    ownUsername,
    now: new Date('2026-05-03T12:10:00Z')
  });

  assert.equal(state.threads['0xroot'].lastReplyHash, '0xours2');
  assert.equal(state.threads['0xroot'].ourTurnCount, 2);
});
