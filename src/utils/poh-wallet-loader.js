'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const ALGO    = 'aes-256-gcm';
const SALT    = 'poh-miner-wallet-v1';
const KEY_FILE = path.join(os.homedir(), '.poh-miner', '.wallet-key');

let _cachedKey = null;

function legacyMachineKey() {
  return crypto.scryptSync(`${os.hostname()}:${os.homedir()}`, SALT, 32);
}

function loadOrCreateKey() {
  if (_cachedKey) return _cachedKey;

  const envKey = process.env.POH_WALLET_KEY;
  if (envKey && envKey.length >= 16) {
    _cachedKey = crypto.createHash('sha256').update(envKey).digest();
    return _cachedKey;
  }

  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE);
    if (raw.length >= 32) {
      _cachedKey = raw.subarray(0, 32);
      return _cachedKey;
    }
  }

  for (const key of [legacyMachineKey()]) {
    _cachedKey = key;
    return _cachedKey;
  }
}

function decryptField(blob) {
  if (!blob || typeof blob !== 'object' || !blob.data) return null;
  for (const key of [loadOrCreateKey(), legacyMachineKey()]) {
    try {
      const iv   = Buffer.from(blob.iv, 'base64');
      const tag  = Buffer.from(blob.tag, 'base64');
      const data = Buffer.from(blob.data, 'base64');
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch { /* try next key */ }
  }
  return null;
}

function unsealWalletData(data) {
  if (!data) return null;
  const out = { ...data };
  if (data.encrypted) {
    if (data.privateKeyEnc) out.privateKey = decryptField(data.privateKeyEnc);
    if (data.signingPrivateKeyEnc) out.signingPrivateKey = decryptField(data.signingPrivateKeyEnc);
  }
  delete out.privateKeyEnc;
  delete out.signingPrivateKeyEnc;
  return out;
}

/**
 * Load a PoH wallet JSON (plain or encrypted) for job-fee signing.
 * Never log or return private key material to callers outside this module.
 */
function loadPohWallet(walletPath) {
  if (!walletPath || !fs.existsSync(walletPath)) {
    throw new Error(`POH job wallet not found: ${walletPath || '(unset)'}`);
  }
  const raw = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const wallet = unsealWalletData(raw);
  if (!wallet?.address) throw new Error('Wallet file missing address');
  if (!wallet.signingPrivateKey) throw new Error(`Wallet ${wallet.address} has no signingPrivateKey`);
  return {
    address: wallet.address,
    signingPrivateKey: wallet.signingPrivateKey,
    signingPublicKey: wallet.signingPublicKey || null,
    nonce: wallet.nonce ?? 0,
  };
}

module.exports = { loadPohWallet, unsealWalletData };