'use strict';

/**
 * Brain Decentralization API
 *
 * Endpoints used by POH Miner Brain Workers (the software miners run next to their ASICs).
 *
 * This is the coordination layer that lets the network offload LLM inference
 * to miner-operated nodes.
 */

const express = require('express');
const router = express.Router();

// In-memory registry for MVP (later move to Redis or DB)
const nodes = new Map(); // nodeId -> { wallet, lastSeen, capabilities, asicStats, ... }
const pendingJobs = [];  // simple queue

/**
 * POST /brain/nodes/register
 * A miner-operated node registers itself.
 */
router.post('/nodes/register', (req, res) => {
  const { wallet, btcAddresses, capabilities, version, hardware } = req.body;

  if (!wallet) {
    return res.status(400).json({ error: 'wallet (Solana address) is required' });
  }

  const nodeId = `miner-${wallet.slice(0, 8)}-${Date.now().toString(36)}`;

  nodes.set(nodeId, {
    nodeId,
    wallet,
    btcAddresses: btcAddresses || [],
    capabilities: capabilities || ['inference'],
    version: version || 'unknown',
    hardware: hardware || {},
    registeredAt: new Date().toISOString(),
    lastSeen: Date.now(),
    asicStats: null,
  });

  console.log(`[brain] New miner node registered: ${nodeId} (wallet ${wallet})`);

  res.json({
    nodeId,
    status: 'registered',
    message: 'Welcome to the decentralized POH brain. Start sending heartbeats.',
  });
});

/**
 * POST /brain/nodes/:nodeId/heartbeat
 */
router.post('/nodes/:nodeId/heartbeat', (req, res) => {
  const { nodeId } = req.params;
  const node = nodes.get(nodeId);

  if (!node) {
    return res.status(404).json({ error: 'Node not found - please re-register' });
  }

  node.lastSeen = Date.now();
  if (req.body.asicStats) node.asicStats = req.body.asicStats;
  if (req.body.capabilities) node.capabilities = req.body.capabilities;

  res.json({ status: 'ok', nextHeartbeatIn: 60 });
});

/**
 * GET /brain/jobs?nodeId=...
 * Miner nodes poll for work.
 */
router.get('/jobs', (req, res) => {
  const { nodeId } = req.query;
  const node = nodes.get(nodeId);

  if (!node) {
    return res.status(404).json({ error: 'Unknown node' });
  }

  // For MVP: give at most 1 job per poll
  const job = pendingJobs.shift();

  if (job) {
    console.log(`[brain] Assigned job ${job.id} to miner node ${nodeId}`);
    return res.json({ jobs: [job] });
  }

  res.json({ jobs: [] });
});

/**
 * POST /brain/jobs/:id/result
 * Worker submits completed inference.
 */
router.post('/jobs/:id/result', (req, res) => {
  const { id } = req.params;
  const { nodeId, result } = req.body;

  // In real system: store result, aggregate if multiple nodes answered, feed back to main brain
  console.log(`[brain] Received result for job ${id} from ${nodeId}`);

  // TODO: forward result into the real analyzeHumanness pipeline

  res.json({ status: 'received' });
});

/**
 * Internal: allow the main server to submit a job for decentralized execution
 * (called from checker / brain utils when we want to offload)
 */
router.post('/jobs', (req, res) => {
  const job = {
    id: 'job-' + Date.now() + Math.random().toString(36).slice(2, 8),
    type: req.body.type || 'verdict',
    payload: req.body.payload,
    created: Date.now(),
    priority: req.body.priority || 0,
  };

  pendingJobs.push(job);
  // Keep queue bounded
  if (pendingJobs.length > 100) pendingJobs.shift();

  res.json({ jobId: job.id, queued: true });
});

module.exports = router;
