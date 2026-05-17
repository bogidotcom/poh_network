'use strict';

/**
 * Meteora DBC integration test — run from dev/ directory:
 *   node tests/test_meteora.js
 *
 * Requires env:
 *   SOLANA_RPC      — devnet RPC (defaults to public devnet)
 *   SOLANA_PRIV_KEY — base58 or hex secret key with some devnet SOL
 */

const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const {
  DynamicBondingCurveClient,
  buildCurve,
  deriveDbcPoolAddress,
  swapQuote,
  getPriceFromSqrtPrice,
  DEFAULT_LIQUIDITY_VESTING_INFO_PARAMS,
  DEFAULT_MIGRATED_POOL_FEE_PARAMS,
} = require('@meteora-ag/dynamic-bonding-curve-sdk');
const BN   = require('bn.js');
const bs58 = require('bs58');

const RPC  = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
const WSOL = 'So11111111111111111111111111111111111111112';

// ── helpers ───────────────────────────────────────────────────────────────────

function ok(label)  { console.log(`  ✓  ${label}`); }
function fail(label, err) { console.error(`  ✗  ${label}:`, err?.message || err); process.exitCode = 1; }

function getPayerKeypair() {
  const raw = process.env.SOLANA_PRIV_KEY;
  if (!raw) throw new Error('SOLANA_PRIV_KEY not set');
  const secret = /^[0-9a-fA-F]{128}$/.test(raw)
    ? Buffer.from(raw, 'hex') : bs58.decode(raw);
  return Keypair.fromSecretKey(secret);
}

function buildConfig() {
  return buildCurve({
    token: {
      tokenType: 0, tokenBaseDecimal: 6, tokenQuoteDecimal: 9,
      tokenUpdateAuthority: 0, totalTokenSupply: 1_000_000_000, leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: 0,
        feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: 0,
      creatorTradingFeePercentage: 20,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: 1,
      migrationFeeOption: 0,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: DEFAULT_MIGRATED_POOL_FEE_PARAMS,
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 0,
      partnerLiquidityPercentage: 0,
      partnerLiquidityVestingInfoParams: DEFAULT_LIQUIDITY_VESTING_INFO_PARAMS,
      creatorPermanentLockedLiquidityPercentage: 100,
      creatorLiquidityPercentage: 0,
      creatorLiquidityVestingInfoParams: DEFAULT_LIQUIDITY_VESTING_INFO_PARAMS,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0, numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0,
    },
    activationType: 0,
    percentageSupplyOnMigration: 20,
    migrationQuoteThreshold: 10,
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

async function testSdkImports() {
  console.log('\n[1] SDK imports');
  try {
    if (typeof DynamicBondingCurveClient !== 'function') throw new Error('DynamicBondingCurveClient not a constructor');
    if (typeof buildCurve !== 'function') throw new Error('buildCurve not a function');
    if (typeof deriveDbcPoolAddress !== 'function') throw new Error('deriveDbcPoolAddress not a function');
    if (typeof swapQuote !== 'function') throw new Error('swapQuote not a function');
    if (typeof getPriceFromSqrtPrice !== 'function') throw new Error('getPriceFromSqrtPrice not a function');
    ok('all named exports resolve');
  } catch (err) { fail('SDK imports', err); }
}

async function testClientCreation() {
  console.log('\n[2] Client creation + sub-services');
  try {
    const conn   = new Connection(RPC, 'confirmed');
    const client = DynamicBondingCurveClient.create(conn);
    if (typeof client.pool?.createConfigAndPool !== 'function')
      throw new Error('client.pool.createConfigAndPool not a function');
    if (typeof client.pool?.swap !== 'function')
      throw new Error('client.pool.swap not a function');
    if (typeof client.state?.getPool !== 'function')
      throw new Error('client.state.getPool not a function');
    ok('client.pool.createConfigAndPool exists');
    ok('client.pool.swap exists');
    ok('client.state.getPool exists');
    return client;
  } catch (err) { fail('Client creation', err); return null; }
}

async function testBuildCurve() {
  console.log('\n[3] buildCurve() config param');
  try {
    const config = buildConfig();
    if (!config) throw new Error('returned null/undefined');
    ok(`buildCurve returned object with ${Object.keys(config).length} keys`);
    return config;
  } catch (err) { fail('buildCurve', err); return null; }
}

async function testDerivePoolAddress() {
  console.log('\n[4] deriveDbcPoolAddress');
  try {
    const configKp  = Keypair.generate();
    const mintKp    = Keypair.generate();
    const addr = deriveDbcPoolAddress(new PublicKey(WSOL), mintKp.publicKey, configKp.publicKey);
    if (!addr || !addr.toBase58) throw new Error('did not return PublicKey');
    ok(`derived address: ${addr.toBase58().slice(0, 12)}…`);
  } catch (err) { fail('deriveDbcPoolAddress', err); }
}

async function testBuildTxWithoutBroadcast() {
  console.log('\n[5] Build pool creation tx (no broadcast)');
  if (!process.env.SOLANA_PRIV_KEY) {
    console.log('  -  SOLANA_PRIV_KEY not set — skipping broadcast tests');
    return null;
  }
  try {
    const payer      = getPayerKeypair();
    const conn       = new Connection(RPC, 'confirmed');
    const client     = DynamicBondingCurveClient.create(conn);
    const configKp   = Keypair.generate();
    const mintKp     = Keypair.generate();
    const configParam = buildConfig();

    const tx = await client.pool.createConfigAndPool({
      ...configParam,
      config:           configKp.publicKey.toBase58(),
      feeClaimer:       payer.publicKey.toBase58(),
      leftoverReceiver: payer.publicKey.toBase58(),
      quoteMint:        WSOL,
      payer:            payer.publicKey.toBase58(),
      tokenType:        0,
      preCreatePoolParam: {
        baseMint:    mintKp.publicKey,
        name:        'Test Signal',
        symbol:      'TEST',
        uri:         '',
        poolCreator: payer.publicKey,
      },
    });

    if (!tx || !tx.instructions?.length) throw new Error('tx has no instructions');
    ok(`transaction built — ${tx.instructions.length} instructions`);

    const poolAddr = deriveDbcPoolAddress(new PublicKey(WSOL), mintKp.publicKey, configKp.publicKey);
    ok(`pool address derived: ${poolAddr.toBase58().slice(0, 12)}…`);

    // Use buildPoolCreationTx (the actual function) to verify auto-buy flow
    const meteora = require('../src/utils/meteora');
    process.env.SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
    const result = await meteora.buildPoolCreationTx('test-method-id', 'Test Signal', 'TEST', payer.publicKey.toBase58());
    ok(`buildPoolCreationTx: deployRent=${result.deployRentLamports} (${(result.deployRentLamports/1e9).toFixed(4)} SOL), buyAmount=${result.buyAmountLamports} (${(result.buyAmountLamports/1e9).toFixed(4)} SOL)`);
    ok(`total charged: ${((result.deployRentLamports + result.buyAmountLamports)/1e9).toFixed(4)} SOL (of 0.1 SOL, remainder = tx fees)`);
    ok(`tx size: ${Buffer.from(result.txBase64, 'base64').length} bytes`);

    return { tx, payer, conn, configKp, mintKp, poolAddr };
  } catch (err) { fail('Build tx', err); return null; }
}

async function testBroadcast(ctx) {
  console.log('\n[6] Broadcast pool creation tx (live devnet)');
  if (!ctx) { console.log('  -  Skipped (build tx failed or no key)'); return; }
  const { tx, payer, conn, blockhash } = ctx;
  try {
    const bh = await conn.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    tx.sign(payer);  // payer as final signer
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, 'confirmed');
    ok(`broadcast confirmed: ${sig}`);
  } catch (err) {
    // Devnet may reject due to insufficient SOL — not a code bug
    if (err.message?.includes('insufficient') || err.message?.includes('0x1')) {
      console.log(`  -  Broadcast skipped: ${err.message.slice(0, 80)} (fund the payer with devnet SOL)`);
    } else {
      fail('Broadcast', err);
    }
  }
}

async function testMeteoroPkg() {
  console.log('\n[7] meteora.js module (buildPoolCreationTx + recordPool exported)');
  try {
    const m = require('../src/utils/meteora');
    const required = ['buildPoolCreationTx', 'recordPool', 'createSignalPool', 'getPoolRecord', 'getPoolState', 'getQuote'];
    for (const fn of required) {
      if (typeof m[fn] !== 'function') throw new Error(`${fn} not exported`);
    }
    ok(`exports: ${required.join(', ')}`);
  } catch (err) { fail('meteora.js exports', err); }
}

// ── runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Meteora DBC integration tests ===');
  console.log(`RPC: ${RPC}`);

  await testSdkImports();
  await testClientCreation();
  await testBuildCurve();
  await testDerivePoolAddress();
  const ctx = await testBuildTxWithoutBroadcast();
  await testBroadcast(ctx);
  await testMeteoroPkg();

  console.log('\n=== done ===\n');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
