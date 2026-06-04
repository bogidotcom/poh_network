/**
 * Miner Result Collector
 *
 * Receives results from miners and decides which one (if any)
 * to accept and return to the user.
 *
 * Includes basic validation using the same rules as the miner network.
 */

const { validateMinerResult } = require('../validation/miner-result-validator');

class ResultCollector {
  constructor() {
    this.pendingRequests = new Map(); // requestId -> { resolve, timeout, results: [] }
  }

  /**
   * Called by the HTTP route when a miner submits a result via callback.
   */
  async submitResult(result) {
    const requestId = result.requestId;
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      console.warn(`[ResultCollector] Received result for unknown request ${requestId}`);
      return { accepted: false, reason: 'unknown_request' };
    }

    const validation = await validateMinerResult(result);
    if (!validation.isValid) {
      console.warn(`[ResultCollector] Rejected low-quality result for ${requestId}:`, validation.errors);
      return { accepted: false, reason: 'invalid_work', errors: validation.errors };
    }

    pending.results.push(result);

    // For now: take the first valid result (fastest)
    // In future: collect a few and pick best by confidence/speed
    if (pending.results.length === 1) {
      clearTimeout(pending.timeout);
      pending.resolve(result);
      this.pendingRequests.delete(requestId);
    }

    return { accepted: true };
  }

  /**
   * Wait for a result from the network (used by the checker route).
   */
  async waitForResult(requestId, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          resolve(null); // timeout
        }
      }, timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        timeout,
        results: [],
      });
    });
  }
}

module.exports = { ResultCollector };
