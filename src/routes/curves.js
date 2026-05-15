'use strict';

const express = require('express');
const router  = express.Router();
const {
  getCurve, executeBuy, executeSell, getChartData,
  buyCostLamports, sellRefundLamports, priceAtSupply, applyFee,
} = require('../utils/curves');
const { verifyWalletSignature, verifySolPayment, sendSol } = require('../utils/solana');
const { getProfile, upsertProfile, isTxUsed, recordTx } = require('../utils/profiles');

// ── GET /curves/:methodId — current state (no trade history) ──────────────────
router.get('/:methodId', (req, res) => {
  const c = getCurve(req.params.methodId);
  if (!c) return res.status(404).json({ error: 'Curve not found' });
  const { trades: _t, ...state } = c;
  res.json({ ...state, currentPrice: priceAtSupply(c.supply) });
});

// ── GET /curves/:methodId/chart ───────────────────────────────────────────────
router.get('/:methodId/chart', (req, res) => {
  const intervalMs = parseInt(req.query.interval) || 5 * 60 * 1000;
  const candles = getChartData(req.params.methodId, intervalMs);
  res.json({ candles });
});

// ── GET /curves/:methodId/quote ───────────────────────────────────────────────
// ?action=buy|sell  &amount=<tokens>  [&wallet=<address>]
router.get('/:methodId/quote', (req, res) => {
  const { action, amount, wallet } = req.query;
  const n = parseInt(amount);
  if (!n || n <= 0) return res.status(400).json({ error: 'amount must be a positive integer' });

  const c = getCurve(req.params.methodId);
  if (!c) return res.status(404).json({ error: 'Curve not found' });

  if (action === 'buy') {
    const gross = buyCostLamports(c.supply, n);
    const { net, fee } = applyFee(gross);
    return res.json({
      action: 'buy',
      tokenAmount: n,
      grossCostLamports: gross,
      grossCostSol: gross / 1e9,
      feeLamports: fee,
      tokensOut: n,
      priceAfter: priceAtSupply(c.supply + n),
      priceAfterSol: priceAtSupply(c.supply + n) / 1e9,
    });
  }

  if (action === 'sell') {
    if (n > c.supply) return res.status(400).json({ error: 'Amount exceeds total curve supply' });
    if (wallet) {
      const p = getProfile(wallet);
      const owned = p?.signalTokens?.[req.params.methodId] || 0;
      if (owned < n) return res.status(400).json({ error: `Insufficient tokens — you own ${owned}` });
    }
    const gross = sellRefundLamports(c.supply, n);
    const { net: solOut, fee } = applyFee(gross);
    return res.json({
      action: 'sell',
      tokenAmount: n,
      grossRefundLamports: gross,
      solOutLamports: solOut,
      solOutSol: solOut / 1e9,
      feeLamports: fee,
      priceAfter: priceAtSupply(c.supply - n),
      priceAfterSol: priceAtSupply(c.supply - n) / 1e9,
    });
  }

  res.status(400).json({ error: 'action must be "buy" or "sell"' });
});

// ── POST /curves/:methodId/buy ────────────────────────────────────────────────
// Body: { txHash, walletAddress, tokenAmount }
// User must have already sent grossCostLamports SOL to FEE_RECIPIENT on-chain.
router.post('/:methodId/buy', async (req, res, next) => {
  try {
    const { txHash, walletAddress, tokenAmount } = req.body;
    if (!txHash || !walletAddress || !tokenAmount)
      return res.status(400).json({ error: 'txHash, walletAddress, tokenAmount are required' });

    const n = parseInt(tokenAmount);
    if (n <= 0) return res.status(400).json({ error: 'Invalid tokenAmount' });

    const c = getCurve(req.params.methodId);
    if (!c) return res.status(404).json({ error: 'Curve not found' });

    // Replay guard
    if (isTxUsed(txHash)) return res.status(409).json({ error: 'Transaction already used' });

    // Expected SOL cost
    const grossCost = buyCostLamports(c.supply, n);
    const feeRecipient = process.env.FEE_RECIPIENT;
    if (!feeRecipient) return res.status(500).json({ error: 'FEE_RECIPIENT not configured' });

    const paid = await verifySolPayment(txHash, grossCost / 1e9, feeRecipient);
    if (!paid) return res.status(402).json({ error: 'SOL payment not verified — expected at least ' + (grossCost / 1e9).toFixed(6) + ' SOL to ' + feeRecipient });

    // Execute on curve
    const result = executeBuy(req.params.methodId, n, walletAddress);

    // Credit signal tokens in profile
    const p = getProfile(walletAddress) || {};
    const st = { ...(p.signalTokens || {}) };
    st[req.params.methodId] = (st[req.params.methodId] || 0) + n;
    upsertProfile(walletAddress, { signalTokens: st });

    recordTx(txHash, { action: 'curve_buy', wallet: walletAddress, methodId: req.params.methodId, tokens: n });

    res.json({ success: true, methodId: req.params.methodId, ...result });
  } catch (err) { next(err); }
});

// ── POST /curves/:methodId/sell ───────────────────────────────────────────────
// Body: { walletAddress, tokenAmount, signature, message }
// message format: "poh-sell-v1:{methodId}:{tokenAmount}:{walletAddress}:{timestamp}"
router.post('/:methodId/sell', async (req, res, next) => {
  try {
    const { walletAddress, tokenAmount, signature, message } = req.body;
    if (!walletAddress || !tokenAmount || !signature || !message)
      return res.status(400).json({ error: 'walletAddress, tokenAmount, signature, message are required' });

    const n = parseInt(tokenAmount);
    if (n <= 0) return res.status(400).json({ error: 'Invalid tokenAmount' });

    // Verify signature
    if (!verifyWalletSignature(message, signature, walletAddress))
      return res.status(401).json({ error: 'Invalid signature' });

    // Validate message binds to this request
    const expected = `poh-sell-v1:${req.params.methodId}:${n}:${walletAddress}:`;
    if (!message.startsWith(expected))
      return res.status(400).json({ error: 'Message does not match request parameters' });

    const ts = parseInt(message.split(':').pop(), 10);
    if (!ts || Date.now() - ts > 5 * 60 * 1000)
      return res.status(400).json({ error: 'Message expired (> 5 minutes)' });

    // Replay guard
    if (isTxUsed(signature)) return res.status(409).json({ error: 'Signature already used' });

    // Check user owns enough tokens
    const p = getProfile(walletAddress);
    const owned = p?.signalTokens?.[req.params.methodId] || 0;
    if (owned < n) return res.status(400).json({ error: `Insufficient tokens — you own ${owned}` });

    // Execute sell on curve
    const result = executeSell(req.params.methodId, n, walletAddress);

    // Send SOL to user
    const txHash = await sendSol(walletAddress, result.solOut);

    // Debit tokens from profile
    const st = { ...(p.signalTokens || {}) };
    st[req.params.methodId] = owned - n;
    upsertProfile(walletAddress, { signalTokens: st });

    recordTx(signature, { action: 'curve_sell', wallet: walletAddress, methodId: req.params.methodId, tokens: n });

    res.json({ success: true, methodId: req.params.methodId, txHash, ...result });
  } catch (err) { next(err); }
});

module.exports = router;
