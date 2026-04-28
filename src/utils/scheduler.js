'use strict';

const cron = require('node-cron');
const { consolidate } = require('./brain');
const { delistStaleMethod } = require('./methodHealth');

function startScheduler() {
  // Consolidate brain state every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[scheduler] Starting brain consolidation...');
    try {
      await consolidate();
    } catch (err) {
      console.error('[scheduler] Consolidation failed:', err.message);
    }
  });

  // Delist methods unresponsive for 30+ days (runs daily at 03:00)
  cron.schedule('0 3 * * *', () => {
    console.log('[scheduler] Checking method health for stale delists...');
    try { delistStaleMethod(); }
    catch (err) { console.error('[scheduler] Health check failed:', err.message); }
  });

  console.log('[scheduler] Brain consolidation (hourly) + method health check (daily) scheduled.');
}

module.exports = { startScheduler };
