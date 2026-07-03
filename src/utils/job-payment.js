'use strict';

const crypto = require('crypto');

/** 0.01 POH in μPOH (9 decimals). */
const DEFAULT_SCAN_FEE_UPOH = 10_000_000;

function computeJobPaymentHash({ jobId, requesterAddress, minerAddress, amount, nonce }) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ jobId, requesterAddress, minerAddress, amount, nonce }))
    .digest('hex');
}

function signWithPem(message, signingPrivateKeyPem) {
  const sig = crypto.sign(null, Buffer.from(message, 'utf8'), signingPrivateKeyPem);
  return sig.toString('base64');
}

function signJobPayment({ jobId, requesterAddress, minerAddress, amount, nonce }, signingPrivateKeyPem) {
  const txHash = computeJobPaymentHash({ jobId, requesterAddress, minerAddress, amount, nonce });
  const signature = signWithPem(txHash, signingPrivateKeyPem);
  return { txHash, signature };
}

module.exports = {
  DEFAULT_SCAN_FEE_UPOH,
  computeJobPaymentHash,
  signJobPayment,
};