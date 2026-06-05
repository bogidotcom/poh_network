'use strict';

const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const { consolidate, onVote } = require('./brain');
const { delistStaleMethod }   = require('./methodHealth');
const { getPools, savePools, getPoolState } = require('./meteora');
const { broadcastCurvePriceChange }         = require('./brainBroadcast');

const METHODS_PATH = path.join(__dirname, '../../data/methods.json');

function _readMethods() {
  try { return JSON.parse(fs.readFileSync(METHODS_PATH, 'utf-8')); }
  catch { return []; }
}

/**
 * Poll every Conviction Curve pool for price moves and graduation.
 *
 * Rules:
 *  - Price up  ≥ 5%  → positive community signal → onVote(method, 'market', true,  magnitude)
 *  - Price down ≥ 5% → negative community signal → onVote(method, 'market', false, magnitude)
 *  - Graduated         → strong positive          → onVote(method, 'graduation', true, 0.5)
 *
 * Weight influence is capped so market moves can never dominate over human votes.
 * Each result is broadcast to the bootnode so all miner nodes apply the same update.
 */
async function processCurveFeedback() {
  const pools   = getPools();
  const methods = _readMethods();
  if (!Object.keys(pools).length) return;

  for (const [methodId, pool] of Object.entries(pools)) {
    try {
      const state = await getPoolState(methodId);
      if (!state) continue;

      const method = methods.find(m => m.id === methodId);
      if (!method) continue;

      const current   = state.currentPriceSol || 0;
      const last      = pool.lastPriceSol     || 0;
      const graduated = state.migrated        || false;

      // ── Graduation event (fires once) ──────────────────────────────────────
      if (graduated && !pool.graduationBroadcast) {
        console.log(`[scheduler] 🎓 Curve graduated: ${method.description}`);
        await onVote(method, 'graduation', true, 0.5, 'Conviction Curve reached 10 SOL — DAMM V2 migration');
        await broadcastCurvePriceChange(method, 'up', 1.0, true);
        pool.graduationBroadcast = true;
      }

      // ── Price-change event (throttle: only if last price known and >1h old) ─
      if (last > 0 && current > 0) {
        const change = (current - last) / last;
        if (Math.abs(change) >= 0.05) {
          const direction = change > 0 ? 'up' : 'down';
          // Cap stakeWeight so market influence stays below strong human votes
          const magnitude = Math.min(Math.abs(change), 0.5);
          const voteUp    = change > 0;

          console.log(`[scheduler] Curve price ${direction} ${(Math.abs(change)*100).toFixed(1)}% for ${method.description}`);
          await onVote(method, 'market', voteUp, magnitude * 0.4,
            `Market: price ${direction} ${(Math.abs(change)*100).toFixed(1)}%`);
          await broadcastCurvePriceChange(method, direction, magnitude, graduated);
        }
      }

      // Persist updated price for next run
      pool.lastPriceSol = current;
    } catch (err) {
      console.warn(`[scheduler] Curve poll failed for ${methodId}:`, err.message);
    }
  }

  savePools(pools);
}

function startScheduler() {
  // Consolidate brain state every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[scheduler] Starting brain consolidation...');
    try { await consolidate(); }
    catch (err) { console.error('[scheduler] Consolidation failed:', err.message); }
  });

  // Poll Conviction Curve prices every 10 minutes and feed signal weight updates
  cron.schedule('*/10 * * * *', async () => {
    console.log('[scheduler] Polling Conviction Curves for price feedback...');
    try { await processCurveFeedback(); }
    catch (err) { console.error('[scheduler] Curve feedback failed:', err.message); }
  });

  // Delist methods unresponsive for 30+ days (runs daily at 03:00)
  cron.schedule('0 3 * * *', () => {
    console.log('[scheduler] Checking method health for stale delists...');
    try { delistStaleMethod(); }
    catch (err) { console.error('[scheduler] Health check failed:', err.message); }
  });

  console.log('[scheduler] Brain consolidation (hourly) + curve feedback (10 min) + health check (daily) scheduled.');
}

module.exports = { startScheduler };
