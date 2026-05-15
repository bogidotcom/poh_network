'use strict';

const fs   = require('fs');
const path = require('path');

const CURVES_PATH = path.join(__dirname, '../../data/curves.json');

// ── Bonding curve parameters ──────────────────────────────────────────────────
// Linear: price(supply) = BASE_PRICE + SLOPE * supply  (lamports per 1 token)
const BASE_PRICE  = 100_000;   // 0.0001 SOL at supply = 0
const SLOPE       = 100;       // +0.0000001 SOL per token of existing supply
const FEE_RATE    = 0.05;      // 5 % protocol fee on every trade
const MAX_TRADES  = 500;       // trade history kept per curve

// ── Math ──────────────────────────────────────────────────────────────────────

/** Spot price (lamports per 1 token) at a given circulating supply. */
function priceAtSupply(supply) {
  return BASE_PRICE + SLOPE * supply;
}

/**
 * Cost in lamports to buy n tokens when current supply is s.
 * Integral of price(x) from s to s+n.
 */
function buyCostLamports(supply, n) {
  if (n <= 0) return 0;
  return Math.ceil(n * BASE_PRICE + SLOPE * n * supply + SLOPE * n * (n - 1) / 2);
}

/**
 * SOL refund in lamports for selling n tokens when current supply is s.
 * Integral of price(x) from s-n to s.
 */
function sellRefundLamports(supply, n) {
  if (n <= 0 || n > supply) return 0;
  const sNew = supply - n;
  return Math.floor(n * BASE_PRICE + SLOPE * n * sNew + SLOPE * n * (n - 1) / 2);
}

/** Split gross amount into { net, fee } after applying FEE_RATE. */
function applyFee(amount) {
  const fee = Math.floor(amount * FEE_RATE);
  return { net: amount - fee, fee };
}

// ── Storage ───────────────────────────────────────────────────────────────────

function getCurves() {
  if (!fs.existsSync(CURVES_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(CURVES_PATH, 'utf-8')); }
  catch { return {}; }
}

function saveCurves(data) {
  const tmp = CURVES_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, CURVES_PATH);
}

function getCurve(methodId) {
  return getCurves()[methodId] || null;
}

/** Called when a signal is listed — creates its bonding curve. Idempotent. */
function initCurve(methodId) {
  const curves = getCurves();
  if (curves[methodId]) return curves[methodId];
  curves[methodId] = {
    methodId,
    createdAt:       new Date().toISOString(),
    supply:          0,   // tokens in circulation (display units)
    solReserve:      0,   // lamports held for seller redemptions
    totalVolumeSol:  0,   // all-time volume in lamports
    totalFeesSol:    0,   // all-time fees collected in lamports
    trades:          [],
  };
  saveCurves(curves);
  return curves[methodId];
}

// ── Trade execution ───────────────────────────────────────────────────────────

/**
 * Execute a buy.
 * grossCost is the total SOL the user sends (in lamports).
 * 5 % stays as protocol fee; the rest goes into solReserve.
 * Returns { tokensOut, grossCost, fee, newSupply, newPrice }.
 */
function executeBuy(methodId, tokenAmount, walletAddress) {
  const curves = getCurves();
  const c = curves[methodId];
  if (!c) throw new Error('Curve not found');
  if (tokenAmount <= 0) throw new Error('tokenAmount must be > 0');

  const grossCost = buyCostLamports(c.supply, tokenAmount);
  const { net: netCost, fee } = applyFee(grossCost);

  c.supply        += tokenAmount;
  c.solReserve    += netCost;
  c.totalVolumeSol += grossCost;
  c.totalFeesSol   += fee;

  const newPrice = priceAtSupply(c.supply);
  c.trades.push({ wallet: walletAddress || null, type: 'buy', tokenAmount, solAmount: grossCost, price: newPrice, timestamp: Date.now() });
  if (c.trades.length > MAX_TRADES) c.trades = c.trades.slice(-MAX_TRADES);

  saveCurves(curves);
  return { tokensOut: tokenAmount, grossCost, fee, newSupply: c.supply, newPrice };
}

/**
 * Execute a sell.
 * Returns { solOut, grossRefund, fee, newSupply, newPrice }.
 * solOut is what the user receives (gross minus fee).
 */
function executeSell(methodId, tokenAmount, walletAddress) {
  const curves = getCurves();
  const c = curves[methodId];
  if (!c) throw new Error('Curve not found');
  if (tokenAmount <= 0) throw new Error('tokenAmount must be > 0');
  if (tokenAmount > c.supply) throw new Error('Exceeds curve supply');

  const grossRefund = sellRefundLamports(c.supply, tokenAmount);
  const { net: solOut, fee } = applyFee(grossRefund);
  if (solOut > c.solReserve) throw new Error('Insufficient SOL reserve in curve');

  c.supply        -= tokenAmount;
  c.solReserve    -= grossRefund;
  c.totalVolumeSol += grossRefund;
  c.totalFeesSol   += fee;

  const newPrice = priceAtSupply(c.supply);
  c.trades.push({ wallet: walletAddress || null, type: 'sell', tokenAmount, solAmount: grossRefund, price: newPrice, timestamp: Date.now() });
  if (c.trades.length > MAX_TRADES) c.trades = c.trades.slice(-MAX_TRADES);

  saveCurves(curves);
  return { solOut, grossRefund, fee, newSupply: c.supply, newPrice };
}

// ── Chart ─────────────────────────────────────────────────────────────────────

/**
 * Aggregate trade history into OHLCV candles.
 * Default interval: 5 minutes.
 */
function getChartData(methodId, intervalMs = 5 * 60 * 1000) {
  const c = getCurve(methodId);
  const basePoint = { time: Math.floor(Date.now() / 1000), open: BASE_PRICE, high: BASE_PRICE, low: BASE_PRICE, close: BASE_PRICE, volume: 0 };
  if (!c || !c.trades.length) return [basePoint];

  const buckets = {};
  for (const t of c.trades) {
    const key = Math.floor(t.timestamp / intervalMs) * intervalMs;
    if (!buckets[key]) {
      buckets[key] = { time: Math.floor(key / 1000), open: t.price, high: t.price, low: t.price, close: t.price, volume: t.tokenAmount };
    } else {
      const b = buckets[key];
      b.high   = Math.max(b.high, t.price);
      b.low    = Math.min(b.low, t.price);
      b.close  = t.price;
      b.volume += t.tokenAmount;
    }
  }

  const sorted = Object.values(buckets).sort((a, b) => a.time - b.time);

  // Append a synthetic current-price point if last candle is stale
  const lastClose   = sorted[sorted.length - 1]?.close ?? BASE_PRICE;
  const currentPrice = priceAtSupply(c.supply);
  const nowSec       = Math.floor(Date.now() / 1000);
  if (!sorted.length || nowSec - sorted[sorted.length - 1].time > intervalMs / 1000) {
    sorted.push({ time: nowSec, open: lastClose, high: Math.max(lastClose, currentPrice), low: Math.min(lastClose, currentPrice), close: currentPrice, volume: 0 });
  }

  return sorted;
}

// ── Signal strength ───────────────────────────────────────────────────────────

/**
 * Returns a multiplier (≥ 1.0) based on curve price appreciation.
 * Used by brain.getWeights() to amplify high-confidence signals.
 */
function getCurveStrengthMultiplier(methodId) {
  const c = getCurve(methodId);
  if (!c || c.supply === 0) return 1.0;
  const currentPrice  = priceAtSupply(c.supply);
  const priceRatio    = currentPrice / BASE_PRICE; // 1.0 at launch, grows with buys
  return 1 + Math.log1p(priceRatio - 1) * 0.5;    // gentle log scale, max ~3-4x
}

module.exports = {
  BASE_PRICE, SLOPE, FEE_RATE,
  priceAtSupply, buyCostLamports, sellRefundLamports, applyFee,
  getCurves, getCurve, initCurve,
  executeBuy, executeSell,
  getChartData, getCurveStrengthMultiplier,
};
