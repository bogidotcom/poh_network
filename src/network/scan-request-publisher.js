/**
 * Miner Job Client
 *
 * Publishes identity scans to the PoH Miner Network via POST /job
 * using the built-in poh_identity skill (replaces the old standalone dev checker).
 *
 * Each scan includes a 0.01 POH fee (signed payment proof) paid by the
 * server's mining-rewards wallet (POH_JOB_WALLET_PATH on production).
 */

'use strict';

const crypto = require('crypto');
const axios  = require('axios');
const { DEFAULT_SCAN_FEE_UPOH, signJobPayment } = require('../utils/job-payment');
const { loadPohWallet } = require('../utils/poh-wallet-loader');

const POH_IDENTITY_SKILL = 'poh_identity';

class ScanRequestPublisher {
  constructor(options = {}) {
    this.minerNodeUrl = (options.minerNodeUrl || process.env.MINER_NODE_URL || 'http://127.0.0.1:3456').replace(/\/$/, '');
    this.scanFeeUpoh  = Number(options.scanFeeUpoh || process.env.POH_SCAN_FEE_UPOH || DEFAULT_SCAN_FEE_UPOH);
    this.walletPath   = options.walletPath || process.env.POH_JOB_WALLET_PATH || null;
    this.timeout      = options.timeout || 12_000;
    this.pollInterval = options.pollInterval || 2_000;
    this.pollTimeout  = options.pollTimeout || 180_000;
    this.originCountry = options.originCountry || process.env.POH_ORIGIN_COUNTRY || 'georgia';
  }

  _newJobId() {
    return `scan-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  async _getMinerAddress() {
    const res = await axios.get(`${this.minerNodeUrl}/api/miner/info`, { timeout: this.timeout });
    const addr = res.data?.minerAddress;
    if (!addr) throw new Error('Miner node did not return minerAddress');
    return addr;
  }

  async _getNonce(address) {
    try {
      const res = await axios.get(`${this.minerNodeUrl}/api/wallet/nonce`, {
        params: { address },
        timeout: this.timeout,
      });
      return res.data?.nonce ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Sign a job fee payment. Prefers localhost /api/wallet/sign-job-payment
   * (same machine as miner); falls back to POH_JOB_WALLET_PATH.
   */
  async _signPayment(jobId, amount) {
    try {
      const res = await axios.post(
        `${this.minerNodeUrl}/api/wallet/sign-job-payment`,
        { jobId, amount },
        { timeout: this.timeout },
      );
      if (res.data?.txHash && res.data?.signature && res.data?.requesterAddress) {
        return {
          requesterAddress: res.data.requesterAddress,
          paymentTx: { txHash: res.data.txHash, signature: res.data.signature },
        };
      }
    } catch (err) {
      if (err.response?.status !== 404) {
        console.warn('[MinerJobClient] sign-job-payment unavailable:', err.message);
      }
    }

    if (!this.walletPath) {
      throw new Error('POH_JOB_WALLET_PATH is required to sign scan job fees (or run miner with /api/wallet/sign-job-payment on localhost)');
    }

    const wallet = loadPohWallet(this.walletPath);
    const minerAddress = await this._getMinerAddress();
    const nonce = await this._getNonce(wallet.address);
    const paymentTx = signJobPayment({
      jobId,
      requesterAddress: wallet.address,
      minerAddress,
      amount,
      nonce,
    }, wallet.signingPrivateKey);

    return { requesterAddress: wallet.address, paymentTx };
  }

  /**
   * Submit a poh_identity skill job for one address.
   */
  async publish(request) {
    const address = request.address || request.input;
    if (!address) throw new Error('address is required');

    const jobId = request.id || request.requestId || this._newJobId();
    const maxBudget = request.fee || request.maxBudget || this.scanFeeUpoh;

    console.log('[MinerJobClient] Submitting poh_identity job:', { jobId, address, maxBudget });

    const job = {
      id: jobId,
      type: 'skill',
      skillId: POH_IDENTITY_SKILL,
      payload: { address, chainFilter: request.chainFilter || undefined },
      maxBudget,
      originCountry: request.originCountry || this.originCountry,
      createdAt: Date.now(),
    };

    try {
      const { requesterAddress, paymentTx } = await this._signPayment(jobId, maxBudget);
      job.requesterAddress = requesterAddress;
      job.paymentTx = paymentTx;
    } catch (err) {
      console.warn('[MinerJobClient] Fee signing failed, submitting without payment:', err.message);
      // Older miner nodes may still accept unpaid skill jobs during transition.
    }

    const res = await axios.post(`${this.minerNodeUrl}/job`, job, {
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json' },
    });

    const acceptedJobId = res.data?.jobId || jobId;
    console.log('[MinerJobClient] Job accepted:', acceptedJobId);

    return {
      published: true,
      jobId: acceptedJobId,
      statusUrl: res.data?.statusUrl || `${this.minerNodeUrl}/job/${acceptedJobId}/status`,
      resultUrl: res.data?.resultUrl || `${this.minerNodeUrl}/job/${acceptedJobId}/result`,
      minerNode: this.minerNodeUrl,
    };
  }

  async getJobStatus(jobId) {
    const res = await axios.get(`${this.minerNodeUrl}/job/${jobId}/status`, { timeout: this.timeout });
    return res.data;
  }

  async getJobResult(jobId) {
    const res = await axios.get(`${this.minerNodeUrl}/job/${jobId}/result`, { timeout: 30_000 });
    return res.data;
  }

  /**
   * Submit + poll until the miner returns a verdict result.
   */
  async publishAndWait(request) {
    const { jobId } = await this.publish(request);
    const deadline = Date.now() + this.pollTimeout;

    while (Date.now() < deadline) {
      try {
        const result = await this.getJobResult(jobId);
        if (result?.verdict && result.status !== 'computing') {
          return { jobId, ...result };
        }
        if (result?.status === 'done' || result?.verdict) {
          return { jobId, ...result };
        }
      } catch (err) {
        if (err.response?.status !== 202 && err.response?.status !== 404) {
          throw err;
        }
      }
      await new Promise(r => setTimeout(r, this.pollInterval));
    }

    throw new Error(`Miner job ${jobId} timed out after ${this.pollTimeout}ms`);
  }

  /**
   * Map miner /job/:id/result to the legacy /checker response shape.
   */
  static toCheckerShape(minerResult, address) {
    const signals = minerResult.evidence?.signalsUsed
      || minerResult.signalsUsed
      || minerResult.signals
      || [];

    const profile = minerResult.profile || null;

    return {
      input: address,
      results: Array.isArray(signals) ? signals : [],
      verdict: minerResult.verdict || 'UNCERTAIN',
      confidence: minerResult.confidence ?? 0.5,
      reasoning: minerResult.reasoning || '',
      profile,
      farcasterData: minerResult.farcasterData || profile?.farcasterData || null,
      paragraphData: minerResult.paragraphData || profile?.paragraphData || null,
      vibeData: profile?.vibeData || null,
      source: 'miner-network',
      jobId: minerResult.jobId,
      minerWallet: minerResult.minerWallet || null,
    };
  }
}

module.exports = { ScanRequestPublisher, POH_IDENTITY_SKILL };