'use strict';

const express = require('express');
const router = express.Router();

const {
  getPublishedSignalsTransactions,
  getLiveSignalsWithCurves,
} = require('../utils/miner-network');

/**
 * GET /miner/signals/transactions
 * Returns all SignalsTransactions emitted when conviction curve pools were created.
 * Miners use this to discover newly listed signals that have live curves.
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
 * Returns only the methods that currently have a live conviction curve pool.
 * This is the set miners should treat as canonical/active signals.
 */
router.get('/signals/live', (req, res) => {
  try {
    const live = getLiveSignalsWithCurves();
    res.json({
      count: live.length,
      signals: live,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
