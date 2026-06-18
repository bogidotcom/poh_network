'use strict';

/**
 * brainBroadcast.js — push brain events from the dev backend to the bootnode.
 *
 * The bootnode stores events; all miner nodes pull them every 5 minutes and
 * apply them locally via BrainSync.  This is the single place where
 * proofofhuman.ge originates events (votes, feedback, new methods) and makes
 * them available to the whole network.
 */

const axios  = require('axios');
const crypto = require('crypto');

const BOOTNODES = (process.env.BOOTNODES || 'https://miner.proofofhuman.ge')
  .split(',').map(s => s.trim()).filter(Boolean);

const SOURCE = 'proofofhuman.ge';

function _makeEvent(type, data) {
  const ts = Date.now();
  const canonical = JSON.stringify({ type, data, ts, source: SOURCE });
  const eventHash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 24);
  return { type, data, ts, eventHash, source: SOURCE };
}

async function _push(event) {
  await Promise.allSettled(BOOTNODES.map(async bn => {
    const base = bn.endsWith('/') ? bn : bn + '/';
    await axios.post(`${base}brain/events`, event, { timeout: 5000 });
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Broadcast a verdict feedback correction to all nodes.
 * Called after brain.onVerdictFeedback() succeeds.
 */
async function broadcastFeedback(address, aiVerdict, correction, comment, signals) {
  const event = _makeEvent('feedback', {
    address, aiVerdict, correction,
    comment: comment || null,
    signals: (signals || []).map(s => ({
      methodId: s.methodId, result: s.result,
      description: (s.description || '').slice(0, 80),
    })),
  });
  await _push(event);
  console.log(`[brainBroadcast] feedback pushed — ${aiVerdict}→${correction} for ${address}`);
}

/**
 * Broadcast a signal vote weight update to all nodes.
 * Called after brain.onVote() succeeds.
 */
async function broadcastWeightUpdate(method, voteType, vote, stakeWeight, feedback) {
  const event = _makeEvent('weight_update', {
    method: { id: method.id, description: (method.description || '').slice(0, 120) },
    voteType,
    vote,
    stakeWeight: +stakeWeight || 0,
    feedback:    feedback   || null,
  });
  await _push(event);
  console.log(`[brainBroadcast] weight_update pushed — ${method.id} vote=${vote} type=${voteType}`);
}

/**
 * Broadcast a new method listing to all nodes.
 * Called after brain.onNewMethod() succeeds.
 */
async function broadcastNewMethod(method) {
  const event = _makeEvent('new_method', {
    id:          method.id,
    type:        method.type,
    description: (method.description || '').slice(0, 120),
    address:     method.address,
    expression:  (method.expression  || '').slice(0, 80),
  });
  await _push(event);
  console.log(`[brainBroadcast] new_method pushed — ${method.id}`);
}

module.exports = {
  broadcastFeedback,
  broadcastWeightUpdate,
  broadcastNewMethod,
};
