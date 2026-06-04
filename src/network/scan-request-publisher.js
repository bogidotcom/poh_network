/**
 * Scan Request Publisher
 *
 * Responsible for taking a scan request from the main backend
 * and publishing it to the PoH Miner Network so miners can compete.
 *
 * Current implementation: Stub that logs + can be extended
 * with HTTP callback, gossip, or direct bootnode submission.
 */

const axios = require('axios');

class ScanRequestPublisher {
  constructor(options = {}) {
    this.bootnodes = options.bootnodes || process.env.MINER_BOOTNODES?.split(',') || [];
    this.callbackBaseUrl = options.callbackBaseUrl || process.env.PUBLIC_CALLBACK_URL;
    this.timeout = options.timeout || 8000;
  }

  /**
   * Publish a scan request to the network.
   * In the future this will go through gossip or on-chain.
   *
   * For now it supports a simple HTTP submission to known bootnodes.
   */
  async publish(request) {
    const payload = {
      ...request,
      // Tell miners where to send the result back (if they support callbacks)
      callbackUrl: this.callbackBaseUrl
        ? `${this.callbackBaseUrl}/internal/miner-result`
        : null,
      publishedAt: Date.now(),
    };

    console.log('[ScanRequestPublisher] Publishing request to miner network:', {
      id: request.id || request.requestId,
      address: request.address,
      inputs: request.inputs?.length || 1,
    });

    if (this.bootnodes.length === 0) {
      console.warn('[ScanRequestPublisher] No bootnodes configured. Request will not be sent to network.');
      return { published: false, reason: 'no_bootnodes' };
    }

    const results = [];

    for (const node of this.bootnodes) {
      try {
        const url = node.endsWith('/') ? `${node}submit-scan-request` : `${node}/submit-scan-request`;
        const res = await axios.post(url, payload, { timeout: this.timeout });
        results.push({ node, success: true, data: res.data });
      } catch (err) {
        results.push({ node, success: false, error: err.message });
      }
    }

    const successful = results.filter(r => r.success).length;
    console.log(`[ScanRequestPublisher] Published to ${successful}/${this.bootnodes.length} bootnodes`);

    return {
      published: successful > 0,
      results,
    };
  }
}

module.exports = { ScanRequestPublisher };
