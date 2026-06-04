/**
 * Bridge from proofofhuman.ge to the PoH Miner Network.
 *
 * When a new signal's conviction curve pool is created, we emit a
 * "published signal transaction" so that miners can sync the new signal.
 *
 * Miners consider a signal canonical only after its curve pool exists.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TXS_PATH = path.join(__dirname, '../../data/miner-signals-transactions.json');
const METHODS_PATH = path.join(__dirname, '../../data/methods.json');
const POOLS_PATH = path.join(__dirname, '../../data/pools.json');

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

function computeSignalsHash(methodsWithPools) {
  const ids = methodsWithPools
    .map(m => m.id)
    .sort()
    .join(',');
  return crypto.createHash('sha256').update(ids).digest('hex').slice(0, 16);
}

/**
 * Called whenever a conviction curve pool is successfully created/recorded.
 * This is the moment the signal becomes "real" for the miner network.
 */
function publishSignalToMiners(methodId, poolRecord) {
  const method = getMethod(methodId);
  if (!method) {
    console.warn(`[miner-network] Cannot publish signal ${methodId} — method not found`);
    return null;
  }

  const txs = loadJson(TXS_PATH, []);

  // Idempotency: don't duplicate
  if (txs.some(tx => tx.methodId === methodId && tx.type === 'signal-published')) {
    return null;
  }

  const pools = loadJson(POOLS_PATH, {});
  const currentPublished = Object.keys(pools);

  const tx = {
    type: 'signal-published',
    methodId,
    method,                    // full method definition at time of publication
    pool: {
      poolAddress: poolRecord.poolAddress,
      mintAddress: poolRecord.mintAddress,
      configAddress: poolRecord.configAddress,
      creatorWallet: poolRecord.creatorWallet,
      txHash: poolRecord.txHash,
      createdAt: poolRecord.createdAt || new Date().toISOString(),
    },
    publishedAt: Date.now(),
    signalsHash: computeSignalsHash(
      Object.keys(pools).map(id => getMethod(id)).filter(Boolean)
    ),
  };

  txs.push(tx);
  saveJson(TXS_PATH, txs);

  console.log(`[miner-network] Published signal to miners: ${methodId} (pool: ${poolRecord.poolAddress})`);

  // Optional: trigger IPFS re-publish of the full current signals list
  // (you can call your existing publish-to-ipfs script here if desired)

  return tx;
}

function getPublishedSignalsTransactions() {
  return loadJson(TXS_PATH, []);
}

/**
 * Returns only the methods that have a live conviction curve pool.
 * This is what miners should use as their canonical active signals set.
 */
function getLiveSignalsWithCurves() {
  const pools = loadJson(POOLS_PATH, {});
  const methods = loadJson(METHODS_PATH, []);

  return methods.filter(m => pools[m.id]);
}

module.exports = {
  publishSignalToMiners,
  getPublishedSignalsTransactions,
  getLiveSignalsWithCurves,
};
