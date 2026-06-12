'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TXS_PATH = path.join(__dirname, '../../data/miner-signals-transactions.json');
const METHODS_PATH = path.join(__dirname, '../../data/methods.json');

function loadJson(file, defaultValue) {
  if (!fs.existsSync(file)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function saveJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function getMethod(methodId) {
  const methods = loadJson(METHODS_PATH, []);
  return methods.find(m => m.id === methodId) || null;
}

function computeSignalsHash(methods) {
  const ids = methods.map(m => m.id).sort().join(',');
  return crypto.createHash('sha256').update(ids).digest('hex').slice(0, 16);
}

/**
 * Called when a new signal is approved (1,000 POH fee verified).
 * Records a transaction so miners can sync the new signal.
 */
function publishSignalToMiners(methodId) {
  const method = getMethod(methodId);
  if (!method) {
    console.warn(`[miner-network] Cannot publish signal ${methodId} — method not found`);
    return null;
  }

  const txs = loadJson(TXS_PATH, []);

  if (txs.some(tx => tx.methodId === methodId && tx.type === 'signal-published')) {
    return null;
  }

  const methods = loadJson(METHODS_PATH, []);
  const tx = {
    type: 'signal-published',
    methodId,
    method,
    publishedAt: Date.now(),
    signalsHash: computeSignalsHash(methods),
  };

  txs.push(tx);
  saveJson(TXS_PATH, txs);

  console.log(`[miner-network] Published signal to miners: ${methodId}`);
  return tx;
}

function getPublishedSignalsTransactions() {
  return loadJson(TXS_PATH, []);
}

/**
 * Returns all approved methods as the canonical active signal set.
 */
function getLiveSignals() {
  return loadJson(METHODS_PATH, []);
}

module.exports = {
  publishSignalToMiners,
  getPublishedSignalsTransactions,
  getLiveSignals,
};
