'use strict';

const { Connection, Keypair, PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const {
  DynamicBondingCurveClient,
  buildCurve,
  deriveDbcPoolAddress,
  swapQuote,
  getPriceFromSqrtPrice,
  DEFAULT_LIQUIDITY_VESTING_INFO_PARAMS,
  DEFAULT_MIGRATED_POOL_FEE_PARAMS,
} = require('@meteora-ag/dynamic-bonding-curve-sdk');
const {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const BN = require('bn.js');
const bs58  = require('bs58');
const fs    = require('fs');
const path  = require('path');

const POOLS_PATH = path.join(__dirname, '../../data/pools.json');
const WSOL       = 'So11111111111111111111111111111111111111112';
const WSOL_MINT  = new PublicKey(WSOL);

// ── Fee recipient WSOL ATA ────────────────────────────────────────────────────

/**
 * Derive the WSOL Associated Token Account for a wallet address.
 * Meteora's referralTokenAccount must be an SPL token account, not a wallet.
 */
function deriveWsolATA(walletPubkey) {
  return getAssociatedTokenAddressSync(WSOL_MINT, walletPubkey);
}

/**
 * Create the WSOL ATA for FEE_RECIPIENT if it doesn't already exist.
 * Called once at server startup so referral fee routing is always available.
 */
async function ensureFeeRecipientWsolATA() {
  const recipientAddr = process.env.FEE_RECIPIENT;
  if (!recipientAddr) return;
  try {
    const connection = getConnection();
    const recipient  = new PublicKey(recipientAddr);
    const ata        = deriveWsolATA(recipient);
    const info       = await connection.getAccountInfo(ata);
    if (info) {
      console.log(`[meteora] FEE_RECIPIENT WSOL ATA already exists: ${ata.toBase58()}`);
      return;
    }
    const payer = getPayerKeypair();
    const ix    = createAssociatedTokenAccountInstruction(
      payer.publicKey, ata, recipient, WSOL_MINT,
    );
    const tx = new Transaction().add(ix);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer        = payer.publicKey;
    tx.sign(payer);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log(`[meteora] Created FEE_RECIPIENT WSOL ATA: ${ata.toBase58()} (sig: ${sig})`);
  } catch (err) {
    console.error('[meteora] ensureFeeRecipientWsolATA failed:', err.message);
  }
}

// ── Storage ───────────────────────────────────────────────────────────────────

function getPools() {
  if (!fs.existsSync(POOLS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(POOLS_PATH, 'utf-8')); }
  catch { return {}; }
}

function savePools(data) {
  const tmp = POOLS_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, POOLS_PATH);
}

function getPoolRecord(methodId) {
  return getPools()[methodId] || null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getConnection() {
  return new Connection(process.env.SOLANA_RPC || 'https://api.devnet.solana.com', 'confirmed');
}

function getPayerKeypair() {
  const raw = process.env.SOLANA_PRIV_KEY;
  if (!raw) throw new Error('SOLANA_PRIV_KEY not configured');
  const secret = /^[0-9a-fA-F]{128}$/.test(raw)
    ? Buffer.from(raw, 'hex') : bs58.decode(raw);
  return Keypair.fromSecretKey(secret);
}

function buildPoolConfigParam() {
  return buildCurve({
    token: {
      tokenType:            0,      // SPL
      tokenBaseDecimal:     6,
      tokenQuoteDecimal:    9,      // SOL
      tokenUpdateAuthority: 0,      // immutable
      totalTokenSupply:     1_000_000_000,
      leftover:             0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: 0,             // FeeSchedulerLinear (flat, no decay)
        feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled:           false,
      collectFeeMode:              0,     // OnlyQuote
      creatorTradingFeePercentage: 4,     // creator gets 4% of swap fees during bonding
      poolCreationFee:             0,
      enableFirstSwapWithMinFee:   false, // no first-buy protection
    },
    migration: {
      migrationOption:  1,          // MigrateToDAMMV2
      migrationFeeOption: 0,        // FixedBps
      migrationFee:     { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee:  { collectFeeMode: 0, dynamicFee: 0, poolFeeBps: 400 }, // 4% after graduation
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 0,
      partnerLiquidityPercentage:               0,
      partnerLiquidityVestingInfoParams:         DEFAULT_LIQUIDITY_VESTING_INFO_PARAMS,
      creatorPermanentLockedLiquidityPercentage: 100, // all LP locked; creator claims nothing, liquidity stays in pool
      creatorLiquidityPercentage:               0,
      creatorLiquidityVestingInfoParams:         DEFAULT_LIQUIDITY_VESTING_INFO_PARAMS,
    },
    lockedVesting: {
      totalLockedVestingAmount:       0,
      numberOfVestingPeriod:          0,
      cliffUnlockAmount:              0,
      totalVestingDuration:           0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType:              0,   // Slot-based
    percentageSupplyOnMigration: 20,  // 20 % of supply released during bonding
    migrationQuoteThreshold:     10,  // graduate at 10 SOL raised
  });
}

// ── User-paid pool creation (frontend signs as payer) ─────────────────────────

const TOTAL_DEPLOY_LAMPORTS = 100_000_000; // 0.1 SOL charged to user
const TX_FEE_BUFFER         =      25_000; // sig fees + safety margin

/**
 * Query on-chain minimum rent for the accounts Meteora creates during pool init.
 * Sizes are empirically measured; add a small buffer per account.
 */
async function estimateDeployRent(connection) {
  const [pool, config, mint, vault, meta, tokenMeta] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(600),  // virtualPool
    connection.getMinimumBalanceForRentExemption(300),  // poolConfig
    connection.getMinimumBalanceForRentExemption(82),   // baseMint (SPL)
    connection.getMinimumBalanceForRentExemption(165),  // token vault (×2)
    connection.getMinimumBalanceForRentExemption(200),  // poolMetadata
    connection.getMinimumBalanceForRentExemption(679),  // Metaplex tokenMetadata
  ]);
  return pool + config + mint + vault * 2 + meta + tokenMeta;
}

/**
 * Build a partially-signed pool creation + auto-buy transaction.
 * User pays 0.1 SOL total: rent covers deployment, remainder auto-buys signal
 * tokens which are deposited into the user's wallet.
 * Backend signs with configKeypair + baseMintKeypair only.
 */
async function buildPoolCreationTx(methodId, signalName, signalSymbol, userPubkeyStr) {
  const userPubkey      = new PublicKey(userPubkeyStr);
  const connection      = getConnection();
  const client          = DynamicBondingCurveClient.create(connection);
  const configKeypair   = Keypair.generate();
  const baseMintKeypair = Keypair.generate();
  const configParam     = buildPoolConfigParam();

  const deployRent = await estimateDeployRent(connection);
  const buyAmount  = Math.max(0, TOTAL_DEPLOY_LAMPORTS - deployRent - TX_FEE_BUFFER);

  // SDK returns two separate txs: config creation + pool creation with first buy
  const { createConfigTx, createPoolWithFirstBuyTx } = await client.pool.createConfigAndPoolWithFirstBuy({
    ...configParam,
    config:           configKeypair.publicKey.toBase58(),
    feeClaimer:       userPubkey.toBase58(),
    leftoverReceiver: userPubkey.toBase58(),
    quoteMint:        WSOL,
    payer:            userPubkey.toBase58(),
    tokenType:        0,
    preCreatePoolParam: {
      baseMint:    baseMintKeypair.publicKey,
      name:        signalName.slice(0, 32),
      symbol:      (signalSymbol || signalName.slice(0, 4).toUpperCase()).slice(0, 10),
      uri:         '',
      poolCreator: userPubkey,
    },
    firstBuyParam: {
      buyer:                userPubkey,
      receiver:             userPubkey,  // tokens land in user's wallet
      buyAmount:            new BN(buyAmount),
      minimumAmountOut:     new BN(0),   // first buy on empty pool — no slippage floor
      referralTokenAccount: process.env.FEE_RECIPIENT
        ? deriveWsolATA(new PublicKey(process.env.FEE_RECIPIENT))
        : null,
    },
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

  createConfigTx.recentBlockhash = blockhash;
  createConfigTx.feePayer        = userPubkey;
  createConfigTx.partialSign(configKeypair);

  createPoolWithFirstBuyTx.recentBlockhash = blockhash;
  createPoolWithFirstBuyTx.feePayer        = userPubkey;
  createPoolWithFirstBuyTx.partialSign(baseMintKeypair);

  const poolAddress = deriveDbcPoolAddress(
    new PublicKey(WSOL),
    baseMintKeypair.publicKey,
    configKeypair.publicKey,
  ).toBase58();

  return {
    // Two txs — frontend uses signAllTransactions then broadcasts sequentially
    tx1Base64:           createConfigTx.serialize({ requireAllSignatures: false }).toString('base64'),
    tx2Base64:           createPoolWithFirstBuyTx.serialize({ requireAllSignatures: false }).toString('base64'),
    poolAddress,
    mintAddress:         baseMintKeypair.publicKey.toBase58(),
    configAddress:       configKeypair.publicKey.toBase58(),
    blockhash,
    lastValidBlockHeight,
    deployRentLamports:  deployRent,
    buyAmountLamports:   buyAmount,
  };
}

/** Persist pool record after user has broadcast the creation tx. */
function recordPool(methodId, { poolAddress, mintAddress, configAddress, creatorWallet, txHash }) {
  const pools = getPools();
  if (pools[methodId]) return pools[methodId]; // idempotent
  pools[methodId] = {
    methodId, poolAddress, mintAddress, configAddress,
    creatorWallet, createdAt: new Date().toISOString(), txHash, trades: [],
  };
  savePools(pools);
  console.log(`[meteora] Recorded pool for ${methodId}: ${poolAddress}`);
  return pools[methodId];
}

// ── Backend-paid pool creation (fallback / admin use) ─────────────────────────

async function createSignalPool(methodId, signalName, signalSymbol) {
  const existing = getPoolRecord(methodId);
  if (existing) return existing;

  const payer      = getPayerKeypair();
  const connection = getConnection();
  const client     = DynamicBondingCurveClient.create(connection);

  const configKeypair  = Keypair.generate();
  const baseMintKeypair = Keypair.generate();

  const configParam = buildPoolConfigParam();

  const tx = await client.pool.createConfigAndPool({
    ...configParam,
    config:           configKeypair.publicKey.toBase58(),
    feeClaimer:       payer.publicKey.toBase58(),
    leftoverReceiver: payer.publicKey.toBase58(),
    quoteMint:        WSOL,
    payer:            payer.publicKey.toBase58(),
    tokenType:        0,
    preCreatePoolParam: {
      baseMint:    baseMintKeypair.publicKey,   // must be PublicKey, not string
      name:        signalName.slice(0, 32),
      symbol:      (signalSymbol || signalName.slice(0, 4).toUpperCase()).slice(0, 10),
      uri:         '',
      poolCreator: payer.publicKey,            // must be PublicKey, not string
    },
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer, configKeypair, baseMintKeypair);

  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

  const poolAddress = deriveDbcPoolAddress(
    new PublicKey(WSOL),
    baseMintKeypair.publicKey,
    configKeypair.publicKey,
  ).toBase58();

  const record = {
    methodId,
    poolAddress,
    mintAddress:   baseMintKeypair.publicKey.toBase58(),
    configAddress: configKeypair.publicKey.toBase58(),
    creatorWallet: payer.publicKey.toBase58(),
    createdAt:     new Date().toISOString(),
    txHash:        sig,
    trades:        [],
  };

  const pools = getPools();
  pools[methodId] = record;
  savePools(pools);

  console.log(`[meteora] Created pool for ${methodId}: ${poolAddress} mint: ${record.mintAddress}`);
  return record;
}

// ── Pool state ────────────────────────────────────────────────────────────────

async function getPoolState(methodId) {
  const record = getPoolRecord(methodId);
  if (!record) return null;

  const connection = getConnection();
  const client     = DynamicBondingCurveClient.create(connection);
  const pool       = await client.state.getPool(new PublicKey(record.poolAddress));
  if (!pool) return { record, pool: null, currentPriceSol: 0, migrated: false };

  const priceDec        = getPriceFromSqrtPrice(pool.sqrtPrice, 6, 9);
  const currentPriceSol = parseFloat(priceDec.toString());
  const migrated        = pool.migrated ?? false;

  // Persist graduation status so brain.js can read it without an RPC call
  if (migrated && !record.migrated) {
    const pools = getPools();
    if (pools[methodId]) { pools[methodId].migrated = true; savePools(pools); }
  }

  return {
    record,
    pool,
    currentPriceSol,
    supply:       pool.baseReserve.toString(),
    quoteReserve: pool.quoteReserve.toString(),
    migrated,
  };
}

// ── Quote ─────────────────────────────────────────────────────────────────────

async function getQuote(methodId, amountIn, swapBaseForQuote) {
  const record = getPoolRecord(methodId);
  if (!record) throw new Error('Pool not found');

  const connection = getConnection();
  const client     = DynamicBondingCurveClient.create(connection);
  const pool       = await client.state.getPool(new PublicKey(record.poolAddress));
  if (!pool) throw new Error('On-chain pool not found');
  const config = await client.state.getPoolConfig(pool.config);

  const bnAmount = new BN(amountIn.toString());
  const quote    = swapQuote(pool, config, swapBaseForQuote, bnAmount, 50); // 0.5 % slippage
  return {
    amountIn:         bnAmount.toString(),
    amountOut:        quote.outputAmount.toString(),
    minimumAmountOut: (quote.minimumAmountOut ?? quote.minimumOutputAmount ?? new BN(0)).toString(),
    fee:              (quote.tradingFee ?? quote.fee ?? new BN(0)).toString(),
    swapBaseForQuote,
  };
}

// ── Chart — index recent swaps ─────────────────────────────────────────────────

async function indexRecentTrades(methodId) {
  const record = getPoolRecord(methodId);
  if (!record) return;

  const connection = getConnection();
  const sigs       = await connection.getSignaturesForAddress(new PublicKey(record.poolAddress), { limit: 100 });

  const known = new Set((record.trades || []).map(t => t.signature));
  const fresh = sigs.filter(s => !known.has(s.signature) && !s.err);
  if (!fresh.length) return;

  const parsed = await Promise.all(
    fresh.map(s => connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 })),
  );

  const newTrades = [];
  for (let i = 0; i < fresh.length; i++) {
    const tx = parsed[i];
    if (!tx) continue;
    const slot = tx.slot;
    const ts   = (tx.blockTime || 0) * 1000;
    // Derive approx price from pool logs is complex — store slot+timestamp for chart axis.
    // We'll use pre/post SOL balance delta to infer trade direction and size.
    try {
      const preBalances  = tx.meta.preBalances;
      const postBalances = tx.meta.postBalances;
      const solDelta = postBalances[0] - preBalances[0]; // positive = received SOL (sell), negative = spent SOL (buy)
      const tradeType = solDelta < 0 ? 'buy' : 'sell';
      const solAmount = Math.abs(solDelta);
      newTrades.push({ signature: fresh[i].signature, slot, timestamp: ts, type: tradeType, solAmount });
    } catch { /* skip malformed */ }
  }

  if (newTrades.length) {
    const pools = getPools();
    pools[methodId].trades = [...(pools[methodId].trades || []), ...newTrades].slice(-500);
    savePools(pools);
  }
}

// Build OHLCV candles from indexed trades + current spot price
async function getChartData(methodId, intervalMs = 5 * 60 * 1000) {
  await indexRecentTrades(methodId).catch(() => {});
  const state  = await getPoolState(methodId);
  const record = state?.record;

  const nowSec     = Math.floor(Date.now() / 1000);
  const startPrice = state?.currentPriceSol ?? 0;

  if (!record?.trades?.length) {
    return [{ time: nowSec, open: startPrice, high: startPrice, low: startPrice, close: startPrice, volume: 0 }];
  }

  const buckets = {};
  for (const t of record.trades) {
    const key = Math.floor(t.timestamp / intervalMs) * intervalMs;
    const approxPrice = t.solAmount / 1e9 / 1000; // very rough estimate
    if (!buckets[key]) {
      buckets[key] = { time: Math.floor(key / 1000), open: approxPrice, high: approxPrice, low: approxPrice, close: approxPrice, volume: t.solAmount };
    } else {
      const b = buckets[key];
      b.high    = Math.max(b.high, approxPrice);
      b.low     = Math.min(b.low, approxPrice);
      b.close   = approxPrice;
      b.volume += t.solAmount;
    }
  }

  const sorted = Object.values(buckets).sort((a, b) => a.time - b.time);
  const last   = sorted[sorted.length - 1];
  if (!last || nowSec - last.time > intervalMs / 1000) {
    sorted.push({ time: nowSec, open: last?.close ?? startPrice, high: startPrice, low: startPrice, close: startPrice, volume: 0 });
  }
  return sorted;
}

module.exports = {
  getPoolRecord, getPools, savePools,
  createSignalPool, buildPoolCreationTx, recordPool,
  getPoolState, getQuote,
  getChartData, indexRecentTrades,
  ensureFeeRecipientWsolATA,
};
