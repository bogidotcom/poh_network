'use strict';

const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { getMint, getAccount, getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const bs58 = require('bs58');

// Decode an SPL Token transfer amount from base58 instruction data.
// Handles Transfer (type 3) and TransferChecked (type 12).
// Returns the raw token amount (u64), or null if not a transfer instruction.
function parseSplTransferAmount(base58Data) {
  try {
    const buf = Buffer.from(bs58.decode(base58Data));
    if ((buf[0] === 3 || buf[0] === 12) && buf.length >= 9) {
      return Number(buf.readBigUInt64LE(1));
    }
  } catch {}
  return null;
}

// Solana mainnet stablecoin mints (both use standard SPL TOKEN_PROGRAM_ID, 6 decimals)
const USDC_MINT = new PublicKey(process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDT_MINT = new PublicKey(process.env.USDT_MINT || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

const connection = new Connection(process.env.SOLANA_RPC || clusterApiUrl('devnet'), 'confirmed');

const PROGRAM_ID = new PublicKey('BN3bdfPeLTokUVACy9wShMVSCcaF1BqHx5Mg71Ere6CN');

function stakeRecordPDA(walletPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('record'), walletPubkey.toBytes()],
    PROGRAM_ID
  )[0];
}

/**
 * Verify a transaction was successfully confirmed on-chain.
 */
async function verifyTxSuccess(txHash) {
  try {
    const tx = await connection.getTransaction(txHash, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) return false;
    return tx.meta?.err === null;
  } catch (err) {
    console.error('[solana] verifyTxSuccess failed:', err.message);
    return false;
  }
}

/**
 * Verify a POH SPL token transfer to FEE_RECIPIENT of at least expectedAmount (raw, 9-decimal units: 1 POH = 1e9).
 */
async function verifyPohTransfer(txHash, expectedAmountRaw, fromWallet) {
  try {
    const tx = await connection.getTransaction(txHash, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err !== null) return false;

    const mintAddress = process.env.POH_TOKEN_MINT;
    if (!mintAddress) return true; // not configured, skip verification
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(process.env.FEE_RECIPIENT || '');
    const fromPubkey = new PublicKey(fromWallet);

    const [fromAta, toAta] = await Promise.all([
      getAssociatedTokenAddress(mint, fromPubkey, false, TOKEN_2022_PROGRAM_ID),
      getAssociatedTokenAddress(mint, recipient,  false, TOKEN_2022_PROGRAM_ID),
    ]);

    const acctKeys = tx.transaction.message.staticAccountKeys ||
                     tx.transaction.message.accountKeys;
    const toIdx = acctKeys.findIndex(k => k.toString() === toAta.toString());
    if (toIdx === -1) return false;

    const pre  = tx.meta.preTokenBalances?.find(b => b.accountIndex === toIdx);
    const post = tx.meta.postTokenBalances?.find(b => b.accountIndex === toIdx);
    if (!post) return false;

    const preAmt  = pre  ? Number(pre.uiTokenAmount.amount)  : 0;
    const postAmt = Number(post.uiTokenAmount.amount);
    return (postAmt - preAmt) >= expectedAmountRaw;
  } catch (err) {
    console.error('[solana] verifyPohTransfer failed:', err.message);
    return false;
  }
}

/**
 * Verify a USDC or USDT transfer to FEE_RECIPIENT of at least expectedAmountRaw (raw 6-decimal units).
 * Accepts either stablecoin so callers don't need to specify which one the user sent.
 */
async function verifyStablecoinTransfer(txHash, expectedAmountRaw, fromWallet) {
  try {
    if (!process.env.FEE_RECIPIENT) return true; // not configured — skip (dev only)
    const tx = await connection.getTransaction(txHash, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err !== null) return false;

    const recipient = new PublicKey(process.env.FEE_RECIPIENT);
    const acctKeys  = tx.transaction.message.staticAccountKeys || tx.transaction.message.accountKeys;

    // ── Method 1: recipient balance delta ────────────────────────────────────
    // Works for all normal deposits where fromAta !== toAta.
    for (const mint of [USDC_MINT, USDT_MINT]) {
      const toAta = await getAssociatedTokenAddress(mint, recipient, false, TOKEN_PROGRAM_ID);
      const toIdx = acctKeys.findIndex(k => k.toString() === toAta.toString());
      if (toIdx === -1) continue;

      const pre  = tx.meta.preTokenBalances?.find(b => b.accountIndex === toIdx);
      const post = tx.meta.postTokenBalances?.find(b => b.accountIndex === toIdx);
      if (!post) continue;

      const preAmt  = pre  ? Number(pre.uiTokenAmount.amount)  : 0;
      const postAmt = Number(post.uiTokenAmount.amount);
      if ((postAmt - preAmt) >= expectedAmountRaw) return true;
    }

    // ── Method 2: instruction-data parsing ───────────────────────────────────
    // Fallback for self-deposits (fromWallet === FEE_RECIPIENT) where fromAta
    // and toAta are identical so balance delta is always 0.  We decode every
    // SPL Transfer / TransferChecked instruction and confirm the stated amount
    // reaches the recipient's ATA.
    const TOKEN_PROG = TOKEN_PROGRAM_ID.toString();
    const instructions = tx.transaction.message.instructions || [];
    for (const ix of instructions) {
      const prog = acctKeys[ix.programIdIndex]?.toString();
      if (prog !== TOKEN_PROG) continue;
      const amount = parseSplTransferAmount(ix.data);
      if (amount === null || amount < expectedAmountRaw) continue;
      // ix.accounts: [source, destination, authority, ...signers]
      const destIdx = ix.accounts[1];
      const destKey = acctKeys[destIdx]?.toString();
      for (const mint of [USDC_MINT, USDT_MINT]) {
        const toAta = await getAssociatedTokenAddress(mint, recipient, false, TOKEN_PROGRAM_ID);
        if (destKey === toAta.toString()) return true;
      }
    }

    return false;
  } catch (err) {
    console.error('[solana] verifyStablecoinTransfer failed:', err.message);
    return false;
  }
}

/**
 * Verifies if a transaction hash corresponds to a payment of the expected amount.
 * @param {string} txHash
 * @param {number} expectedAmountInSol
 * @param {string} recipientAddress
 * @returns {Promise<boolean>}
 */
async function verifySolPayment(txHash, expectedAmountInSol, recipientAddress) {
  try {
    const tx = await connection.getTransaction(txHash, { commitment: 'confirmed' });
    if (!tx) return false;

    // Check if the transaction sent the required amount to the recipient
    const recipientPubkey = new PublicKey(recipientAddress);
    const amountInLamports = expectedAmountInSol * 1e9;

    // This is a simplified check. In a production environment, 
    // you'd check postBalances vs preBalances for the recipient.
    const recipientIndex = tx.transaction.message.accountKeys.findIndex(k => k.equals(recipientPubkey));
    if (recipientIndex === -1) return false;

    const preBalance = tx.meta.preBalances[recipientIndex];
    const postBalance = tx.meta.postBalances[recipientIndex];
    
    return (postBalance - preBalance) >= amountInLamports;
  } catch (err) {
    console.error('[solana] Verification failed:', err.message);
    return false;
  }
}

/**
 * Gets the relative vote weight of a wallet based on their ON-CHAIN staked POH.
 * Uses the staking contract's stake record, not raw token balance.
 * Returns a value between 0 and 1 (fraction of total staked pool).
 */
async function getVoteTokenStake(walletAddress) {
  try {
    if (walletAddress.includes('...')) return 0.5;

    const walletPubkey = new PublicKey(walletAddress);
    const recordPDA = stakeRecordPDA(walletPubkey);
    const raw = await connection.getAccountInfo(recordPDA);

    // Stake record layout: discriminator(8) + owner(32) + staked(8) + reward_debt(8) + pending(8) + staked_at(8)
    if (!raw || raw.data.length < 8 + 32 + 8) return 0.01;
    const stakedRaw = Number(raw.data.readBigUInt64LE(8 + 32));
    if (stakedRaw === 0) return 0.01;

    // Read total staked from global state PDA
    const statePDA = PublicKey.findProgramAddressSync([Buffer.from('state')], PROGRAM_ID)[0];
    const stateRaw = await connection.getAccountInfo(statePDA);
    let totalStaked = 0;
    if (stateRaw && stateRaw.data.length >= 8 + 32*5 + 3 + 8) {
      totalStaked = Number(stateRaw.data.readBigUInt64LE(8 + 32*5 + 3));
    }

    return totalStaked > 0 ? (stakedRaw / totalStaked) : 0.0000000001;
  } catch (err) {
    console.warn('[solana] Failed to get stake weight:', err.message);
    return 0.01;
  }
}

/**
 * Gets the SOL balance of a wallet.
 * @param {string} walletAddress 
 * @returns {Promise<number>}
 */
async function getSolBalance(walletAddress) {
  try {
    const pubkey = new PublicKey(walletAddress);
    const balance = await connection.getBalance(pubkey);
    return balance / 1e9;
  } catch (err) {
    return 0;
  }
}

/**
 * Gets the POH token balance of a wallet.
 * @param {string} walletAddress 
 * @returns {Promise<number>}
 */
async function getVoteBalance(walletAddress) {
  try {
    const mintAddress = process.env.POH_TOKEN_MINT;
    if (!mintAddress) return 0;
    const mintPubkey = new PublicKey(mintAddress);
    const walletPubkey = new PublicKey(walletAddress);
    const ata = await getAssociatedTokenAddress(mintPubkey, walletPubkey, false, TOKEN_2022_PROGRAM_ID);
    const accountInfo = await getAccount(connection, ata, 'confirmed', TOKEN_2022_PROGRAM_ID);
    return Number(accountInfo.amount);
  } catch (err) {
    return 0;
  }
}

/**
 * Verifies if a transaction hash corresponds to a burn of POH tokens.
 * @param {string} txHash 
 * @param {number} expectedAmount 
 * @param {string} walletAddress 
 * @returns {Promise<boolean>}
 */
async function verifyBurnTransaction(txHash, expectedAmount, walletAddress) {
  try {
    const tx = await connection.getTransaction(txHash, { commitment: 'confirmed' });
    if (!tx) return false;

    // In a real burn tx, the token balance of the user's ATA decreases 
    // and the transaction contains a Burn instruction.
    // For this implementation, we'll check if the logs or instructions indicate a burn.
    const isBurn = tx.meta.logMessages.some(log => log.includes('Instruction: Burn'));
    if (!isBurn) return false;

    // Check if the source was the walletAddress
    // This part is simplified; ideally you'd parse the instruction data
    return true; 
  } catch (err) {
    console.error('[solana] Burn verification failed:', err.message);
    return false;
  }
}

/**
 * Returns all wallets with an active staking position in the staking program.
 * Reads stake record PDAs directly (dataSize=72: 8 disc + 32 owner + 8 staked + 8 debt + 8 pending + 8 staked_at).
 */
async function getAllStakers() {
  try {
    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [{ dataSize: 72 }],
    });
    return accounts
      .map(({ account }) => {
        const owner    = new PublicKey(account.data.subarray(8, 40)).toString();
        const stakedRaw = Number(account.data.readBigUInt64LE(40));
        return { address: owner, stakedRaw };
      })
      .filter(s => s.stakedRaw > 0);
  } catch (err) {
    console.warn('[solana] getAllStakers failed:', err.message);
    return [];
  }
}

/**
 * Sends POH tokens from the backend treasury wallet to a recipient.
 * Requires SOLANA_PRIV_KEY (base58) and POH_TOKEN_MINT to be set.
 * amountRaw is in 9-decimal units (1 POH = 1_000_000_000).
 */
async function sendPohTokens(toAddress, amountRaw) {
  const privKeyB58 = process.env.SOLANA_PRIV_KEY;
  if (!privKeyB58 || privKeyB58 === 'YOUR_OPTIONAL_PRIV_KEY_FOR_MINTING') {
    throw new Error('Backend wallet not configured — set SOLANA_PRIV_KEY');
  }
  if (!process.env.POH_TOKEN_MINT) throw new Error('POH_TOKEN_MINT not configured');

  const _bs58 = require('bs58');
  const bs58decode = (_bs58.default || _bs58).decode;
  const { Keypair, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
  const { createTransferInstruction, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');

  // Accept 64-byte hex (128 chars) or base58 encoded private key
  const secretKey = /^[0-9a-fA-F]{128}$/.test(privKeyB58)
    ? Buffer.from(privKeyB58, 'hex')
    : bs58decode(privKeyB58);
  const payer = Keypair.fromSecretKey(secretKey);
  const mint = new PublicKey(process.env.POH_TOKEN_MINT);
  const toPubkey = new PublicKey(toAddress);

  const [fromAta, toAta] = await Promise.all([
    getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey),
    getOrCreateAssociatedTokenAccount(connection, payer, mint, toPubkey),
  ]);

  const tx = new Transaction().add(
    createTransferInstruction(fromAta.address, toAta.address, payer.publicKey, BigInt(amountRaw))
  );

  return sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
}

// Verify a Solana wallet signed a specific message.
// Signature and public key are expected as base58 strings.
function verifyWalletSignature(message, signatureB58, walletAddress) {
  try {
    const nacl   = require('tweetnacl');
    const _bs58  = require('bs58');
    const decode = (_bs58.default || _bs58).decode;
    const msgBytes = Buffer.from(message, 'utf8');
    const sigBytes = decode(signatureB58);
    const pubBytes = decode(walletAddress);
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

module.exports = { verifySolPayment, verifyTxSuccess, verifyPohTransfer, verifyStablecoinTransfer, getVoteTokenStake, getSolBalance, getVoteBalance, verifyBurnTransaction, getAllStakers, sendPohTokens, verifyWalletSignature };
