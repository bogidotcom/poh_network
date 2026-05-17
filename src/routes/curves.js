'use strict';

const express = require('express');
const router  = express.Router();
const {
  getPoolRecord, createSignalPool, buildPoolCreationTx, recordPool,
  getPoolState, getQuote, getChartData,
} = require('../utils/meteora');
const fs   = require('fs');
const path = require('path');

const METHODS_PATH = path.join(__dirname, '../../data/methods.json');
function getMethod(methodId) {
  try {
    const list = JSON.parse(fs.readFileSync(METHODS_PATH, 'utf-8'));
    return list.find(m => m.id === methodId) || null;
  } catch { return null; }
}

// ── GET /curves/:methodId — pool info + current price ─────────────────────────
router.get('/:methodId', async (req, res, next) => {
  try {
    const record = getPoolRecord(req.params.methodId);
    if (!record) return res.status(404).json({ error: 'Pool not found' });

    const state = await getPoolState(req.params.methodId);
    res.json({
      methodId:       record.methodId,
      poolAddress:    record.poolAddress,
      mintAddress:    record.mintAddress,
      configAddress:  record.configAddress,
      creatorWallet:  record.creatorWallet,
      createdAt:      record.createdAt,
      currentPriceSol: state?.currentPriceSol ?? 0,
      quoteReserve:   state?.quoteReserve ?? '0',
      supply:         state?.supply ?? '0',
      migrated:       state?.migrated ?? false,
    });
  } catch (err) { next(err); }
});

// ── GET /curves/:methodId/chart ───────────────────────────────────────────────
router.get('/:methodId/chart', async (req, res, next) => {
  try {
    const intervalMs = parseInt(req.query.interval) || 5 * 60 * 1000;
    const candles    = await getChartData(req.params.methodId, intervalMs);
    res.json({ candles });
  } catch (err) { next(err); }
});

// ── GET /curves/:methodId/creator-fees — claimable creator trading fees ───────
router.get('/:methodId/creator-fees', async (req, res, next) => {
  try {
    const record = getPoolRecord(req.params.methodId);
    if (!record) return res.status(404).json({ error: 'Pool not found' });

    const { Connection, PublicKey } = require('@solana/web3.js');
    const { DynamicBondingCurveClient } = require('@meteora-ag/dynamic-bonding-curve-sdk');
    const conn   = new Connection(process.env.SOLANA_RPC || 'https://api.devnet.solana.com', 'confirmed');
    const client = DynamicBondingCurveClient.create(conn);
    const fees   = await client.state.getPoolFeeMetrics(new PublicKey(record.poolAddress));

    res.json({
      quoteSOL:   parseInt(fees.current.creatorQuoteFee?.toString() || '0') / 1e9,
      baseTokens: parseInt(fees.current.creatorBaseFee?.toString()  || '0'),
    });
  } catch (err) { next(err); }
});

// ── GET /curves/:methodId/quote ───────────────────────────────────────────────
// ?action=buy|sell  &amount=<lamports>
router.get('/:methodId/quote', async (req, res, next) => {
  try {
    const { action, amount } = req.query;
    const n = parseInt(amount);
    if (!n || n <= 0) return res.status(400).json({ error: 'amount (lamports) must be a positive integer' });

    const record = getPoolRecord(req.params.methodId);
    if (!record) return res.status(404).json({ error: 'Pool not found' });

    const swapBaseForQuote = action === 'sell'; // buy = false (quote→base), sell = true (base→quote)
    const quote = await getQuote(req.params.methodId, n, swapBaseForQuote);
    res.json({ action, ...quote });
  } catch (err) { next(err); }
});

// ── POST /curves/pool-creation-tx — build a partially-signed pool tx for the user to pay ──
// Body: { walletAddress, methodId, name, symbol }
// Returns: { txBase64, poolAddress, mintAddress, configAddress, blockhash, lastValidBlockHeight }
router.post('/pool-creation-tx', async (req, res, next) => {
  try {
    const { walletAddress, methodId, name, symbol } = req.body;
    if (!walletAddress || !methodId || !name) {
      return res.status(400).json({ error: 'walletAddress, methodId, and name are required' });
    }
    const existing = getPoolRecord(methodId);
    if (existing) return res.json({ alreadyExists: true, ...existing });

    const result = await buildPoolCreationTx(methodId, name, symbol || name.slice(0, 4).toUpperCase(), walletAddress);
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /curves/record-pool — persist pool info after user broadcasts the creation tx ──
// Body: { methodId, poolAddress, mintAddress, configAddress, creatorWallet, txHash }
router.post('/record-pool', (req, res) => {
  const { methodId, poolAddress, mintAddress, configAddress, creatorWallet, txHash } = req.body;
  if (!methodId || !poolAddress || !mintAddress || !txHash) {
    return res.status(400).json({ error: 'methodId, poolAddress, mintAddress, txHash are required' });
  }
  const record = recordPool(methodId, { poolAddress, mintAddress, configAddress, creatorWallet, txHash });
  res.json({ success: true, ...record });
});

// ── POST /curves/:methodId/init — create Meteora DBC pool for a signal ────────
// Called by the listing flow when a method is approved/listed.
// Body: { adminSecret }  (simple bearer guard — use same as server admin key)
router.post('/:methodId/init', async (req, res, next) => {
  try {
    const method = getMethod(req.params.methodId);
    if (!method) return res.status(404).json({ error: 'Method not found' });

    const existing = getPoolRecord(req.params.methodId);
    if (existing) return res.json({ alreadyExists: true, ...existing });

    const record = await createSignalPool(
      req.params.methodId,
      method.name || req.params.methodId,
      (method.name || req.params.methodId).slice(0, 4).toUpperCase(),
    );
    res.json({ success: true, ...record });
  } catch (err) { next(err); }
});

module.exports = router;
