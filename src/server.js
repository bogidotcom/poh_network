'use strict';

require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');

app.use(express.json());
// Derive backend wallet address from SOLANA_PRIV_KEY so curve buys go to the right wallet
let CURVE_TREASURY = '';
try {
  const privKeyRaw = process.env.SOLANA_PRIV_KEY || '';
  if (privKeyRaw && privKeyRaw !== 'YOUR_OPTIONAL_PRIV_KEY_FOR_MINTING') {
    const { Keypair } = require('@solana/web3.js');
    const secretKey = /^[0-9a-fA-F]{128}$/.test(privKeyRaw)
      ? Buffer.from(privKeyRaw, 'hex')
      : require('bs58').decode(privKeyRaw);
    CURVE_TREASURY = Keypair.fromSecretKey(secretKey).publicKey.toBase58();
  }
} catch (e) {
  console.warn('[config] Could not derive CURVE_TREASURY from SOLANA_PRIV_KEY:', e.message);
}

app.get('/config', (req, res) => {
  res.json({
    SOLANA_RPC:   process.env.SOLANA_RPC      || 'https://api.devnet.solana.com',
    POH_MINT:     process.env.POH_TOKEN_MINT  || '',
    VOTE_MINT:    process.env.VOTE_TOKEN_MINT || '',
    FEE_RECIPIENT: process.env.FEE_RECIPIENT  || '',
    CURVE_TREASURY,
    STAKING_CONTRACT: process.env.STAKING_CONTRACT || '',
  });
});
app.use(express.static(path.join(__dirname, '../frontend/dist')));

// Routes
app.use('/evm', require('./routes/evm'));
app.use('/rest', require('./routes/rest'));
app.use('/methods', require('./routes/methods'));
app.use('/checker', require('./routes/checker'));
app.use('/abi', require('./routes/abi'));
app.use('/profile', require('./routes/profile'));
app.use('/ecosystem', require('./routes/ecosystem'));
app.use('/curves', require('./routes/curves'));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', endpoints: ['POST /evm', 'POST /rest'] });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
module.exports = { app, CURVE_TREASURY };

app.listen(PORT, () => {
  console.log(`Eval server listening on http://localhost:${PORT}`);

  // Ensure dedicated Ollama instance is running (non-blocking)
  require('../scripts/start-ollama').start();

  // Start background scheduler
  const { startScheduler } = require('./utils/scheduler');
  startScheduler();

  // Ensure POH fee recipient has a WSOL ATA so referral fee routing works on-chain
  require('./utils/meteora').ensureFeeRecipientWsolATA();
});
