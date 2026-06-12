'use strict';

const express = require('express');
const router = express.Router();

const {
  getPublishedSignalsTransactions,
  getLiveSignals,
} = require('../utils/miner-network');

/**
 * GET /miner/signals/transactions
 * Returns all published signal transactions.
 * Miners use this to discover newly listed signals.
 */
router.get('/signals/transactions', (req, res) => {
  try {
    const txs = getPublishedSignalsTransactions();
    res.json({
      count: txs.length,
      transactions: txs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /miner/signals/live
 * Returns all approved methods as the canonical active signal set.
 */
router.get('/signals/live', (req, res) => {
  try {
    const live = getLiveSignals();
    res.json({
      count: live.length,
      signals: live,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
