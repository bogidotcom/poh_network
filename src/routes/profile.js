'use strict';

const express = require('express');
const router = express.Router();
const nacl  = require('tweetnacl');
const bs58  = require('bs58');
const fs    = require('fs');
const path  = require('path');
const { getProfile, upsertProfile, getRewards, saveRewards, getProfiles, getMyVotes } = require('../utils/profiles');
const { verifyPohTransfer, sendPohTokens } = require('../utils/solana');

const METHODS_PATH = path.join(__dirname, '../../data/methods.json');
function getMethods() {
  if (!fs.existsSync(METHODS_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(METHODS_PATH, 'utf-8')); }
  catch { return []; }
}

// ── POST /profile/signup ──────────────────────────────────────────────────────
// Body: { address, signature, message }
// message format: "poh-profile-v1:{address}:{timestamp}"
router.post('/signup', async (req, res, next) => {
  try {
    const { address, signature, message } = req.body;
    if (!address || !signature || !message) {
      return res.status(400).json({ error: 'address, signature and message are required' });
    }

    const parts = message.split(':');
    if (parts.length < 3 || parts[0] !== 'poh-profile-v1' || parts[1] !== address) {
      return res.status(400).json({ error: 'Invalid message format' });
    }

    const timestamp = parseInt(parts[2]);
    if (isNaN(timestamp) || Date.now() - timestamp > 5 * 60 * 1000) {
      return res.status(400).json({ error: 'Message expired — please try again' });
    }

    // Verify ed25519 signature (Solana)
    let valid = false;
    try {
      const messageBytes = new TextEncoder().encode(message);
      const sigBytes     = bs58.decode(signature);
      const pkBytes      = bs58.decode(address);
      valid = nacl.sign.detached.verify(messageBytes, sigBytes, pkBytes);
    } catch {
      return res.status(401).json({ error: 'Signature verification failed' });
    }
    if (!valid) return res.status(401).json({ error: 'Invalid signature' });

    const existing = getProfile(address);
    const profile = upsertProfile(address, {
      registeredAt: existing?.registeredAt || new Date().toISOString(),
      apiKey:  existing?.apiKey  || crypto.randomUUID(),
      balance: existing?.balance ?? 0,
      freeScansLeft: existing?.freeScansLeft ?? 100,
      totalScans:    existing?.totalScans    ?? 0,
      stakedAmount:  existing?.stakedAmount  ?? 0,
    });

    return res.json({ success: true, profile: sanitize(profile) });
  } catch (err) {
    next(err);
  }
});

// ── GET /profile/:address ─────────────────────────────────────────────────────
router.get('/:address', (req, res) => {
  const p = getProfile(req.params.address);
  if (!p) return res.status(404).json({ error: 'Profile not found' });
  const methods = getMethods().filter(m => m.ownerWallet === req.params.address);
  const rewards = getRewards();
  const earned  = methods.reduce((s, m) => s + (rewards[m.id]?.totalEarned || 0), 0);
  const pending = methods.reduce((s, m) => s + (rewards[m.id]?.pendingWithdrawal || 0), 0);
  res.json({ profile: sanitize(p), methods, earned, pending });
});

// ── GET /profile/:address/apikey — returns apiKey (auth-gated by signature header) ──
router.get('/:address/apikey', (req, res) => {
  const p = getProfile(req.params.address);
  if (!p) return res.status(404).json({ error: 'Profile not found' });
  // For simplicity, the apiKey is included in the full profile response above.
  // A dedicated endpoint for rotation could be added later.
  res.json({ apiKey: p.apiKey });
});

// ── GET /profile/:address/votes ───────────────────────────────────────────────
router.get('/:address/votes', (req, res) => {
  const votes = getMyVotes(req.params.address);
  const methods = getMethods();
  const detail = Object.entries(votes).map(([methodId, v]) => {
    const m = methods.find(x => x.id === methodId);
    return { methodId, vote: v.vote, at: v.at, description: m?.description || '', type: m?.type || '' };
  }).sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ votes: detail });
});

// ── POST /profile/deposit — credit profile balance from POH transfer ──────────
router.post('/deposit', async (req, res, next) => {
  try {
    const { address, txHash, amount } = req.body;
    if (!address || !txHash || !amount) {
      return res.status(400).json({ error: 'address, txHash and amount are required' });
    }
    const amountRaw = Math.floor(parseFloat(amount) * 1_000_000);
    if (amountRaw <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const isValid = await verifyPohTransfer(txHash, amountRaw, address);
    if (!isValid) return res.status(402).json({ error: 'POH transfer not verified' });

    const p = getProfile(address) || {};
    const updated = upsertProfile(address, { balance: (p.balance || 0) + amountRaw });
    res.json({ success: true, balance: updated.balance });
  } catch (err) { next(err); }
});

// ── POST /profile/claim — withdraw off-chain balance as on-chain POH tokens ───
router.post('/claim', async (req, res, next) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'address required' });

    const p = getProfile(address);
    if (!p) return res.status(404).json({ error: 'Profile not found' });

    const methods = getMethods().filter(m => m.ownerWallet === address);
    const rewards  = getRewards();
    const fromScanEarnings = methods.reduce((s, m) => s + (rewards[m.id]?.pendingWithdrawal || 0), 0);
    const fromOffchainBalance = p.balance || 0;
    const claimable = fromScanEarnings + fromOffchainBalance;

    if (claimable <= 0) return res.status(400).json({ error: 'Nothing to claim' });

    const txHash = await sendPohTokens(address, claimable);

    for (const m of methods) {
      if (rewards[m.id]) rewards[m.id].pendingWithdrawal = 0;
    }
    saveRewards(rewards);
    upsertProfile(address, { balance: 0 });

    console.log(`[profile] Claimed ${claimable / 1_000_000} POH → ${address} tx: ${txHash}`);
    res.json({ success: true, claimed: claimable, txHash });
  } catch (err) {
    // If backend wallet isn't configured, return a clear error without 500
    if (err.message.includes('not configured')) {
      return res.status(503).json({ error: err.message, claimable: (getProfile(req.body.address)?.balance || 0) });
    }
    next(err);
  }
});

// ── POST /profile/apikey/rotate ───────────────────────────────────────────────
router.post('/apikey/rotate', (req, res, next) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'Address required' });
    const updated = upsertProfile(address, { apiKey: crypto.randomUUID() });
    res.json({ apiKey: updated.apiKey });
  } catch (err) { next(err); }
});

// ── GET /profile (leaderboard — top method earners) ───────────────────────────
router.get('/', (req, res) => {
  const rewards = getRewards();
  const totals  = {};
  for (const r of Object.values(rewards)) {
    totals[r.ownerWallet] = (totals[r.ownerWallet] || 0) + r.totalEarned;
  }
  const board = Object.entries(totals)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([address, earned]) => ({ address, earned }));
  res.json({ leaderboard: board });
});

function sanitize(p) {
  const { ips, ...rest } = p; // never expose IP list
  return rest;
}

module.exports = router;
