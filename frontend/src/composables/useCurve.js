import { ref } from 'vue'
import axios from 'axios'
import {
  Connection, PublicKey, LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  DynamicBondingCurveClient,
  swapQuote,
  getPriceFromSqrtPrice,
} from '@meteora-ag/dynamic-bonding-curve-sdk'
import BN from 'bn.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'

export function useCurve({ walletAddress, walletProvider, SOLANA_RPC, pohFeeRecipient, referralWallet }) {
  const curveState   = ref(null)   // { poolAddress, mintAddress, currentPriceSol, ... }
  const chartCandles = ref([])
  const solBalance   = ref(0)
  const ownedTokens  = ref(0)      // user's signal token balance (on-chain SPL)
  const quoteResult  = ref(null)
  const loading      = ref(false)
  const error        = ref(null)

  // ── Referral — resolves WSOL ATA of referral wallet or POH fee recipient ──────
  // Meteora requires an SPL token account (WSOL ATA), not a wallet address.
  // Returns null if the ATA doesn't exist on-chain (safe — skips referral fee).
  const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112')

  async function getReferralTokenAccount(conn) {
    const addr = referralWallet?.value || pohFeeRecipient?.value
    if (!addr) return null
    try {
      const wallet = new PublicKey(addr)
      const ata    = getAssociatedTokenAddressSync(WSOL_MINT, wallet)
      const info   = await conn.getAccountInfo(ata)
      return info ? ata : null   // only pass ATA if it already exists on-chain
    } catch { return null }
  }

  // ── Connection helper ────────────────────────────────────────────────────────

  function getConn() {
    return new Connection(SOLANA_RPC.value || 'https://api.devnet.solana.com', 'confirmed')
  }

  // ── Balance ──────────────────────────────────────────────────────────────────

  async function loadSolBalance() {
    if (!walletAddress.value || !SOLANA_RPC.value) return
    try {
      const bal = await getConn().getBalance(new PublicKey(walletAddress.value))
      solBalance.value = bal / LAMPORTS_PER_SOL
    } catch { solBalance.value = 0 }
  }

  async function loadTokenBalance(mintAddress) {
    if (!walletAddress.value || !mintAddress) { ownedTokens.value = 0; return }
    try {
      const ata  = getAssociatedTokenAddressSync(new PublicKey(mintAddress), new PublicKey(walletAddress.value))
      const info = await getConn().getTokenAccountBalance(ata)
      ownedTokens.value = parseInt(info.value.amount) // raw units (6 decimals)
    } catch { ownedTokens.value = 0 }
  }

  // ── Curve state ──────────────────────────────────────────────────────────────

  async function loadCurveState(methodId) {
    if (!methodId) return
    try {
      const { data } = await axios.get(`/curves/${methodId}`)
      curveState.value = data
      await loadTokenBalance(data.mintAddress)
    } catch { curveState.value = null }
  }

  async function loadChart(methodId) {
    if (!methodId) return
    try {
      const { data } = await axios.get(`/curves/${methodId}/chart`)
      chartCandles.value = data.candles || []
    } catch { chartCandles.value = [] }
  }

  // ── Quote (via backend, which reads on-chain pool) ───────────────────────────
  // amount: SOL lamports (for buy) or raw token units (for sell)
  async function getQuote(methodId, action, amount) {
    quoteResult.value = null
    if (!methodId || !amount || amount <= 0) return
    try {
      const { data } = await axios.get(`/curves/${methodId}/quote`, {
        params: { action, amount },
      })
      quoteResult.value = data
    } catch { quoteResult.value = null }
  }

  // ── Buy: SOL → signal tokens (on-chain Meteora swap) ─────────────────────────
  async function buySignal(methodId, solLamports) {
    if (!walletAddress.value || !walletProvider.value)
      throw new Error('Wallet not connected')

    loading.value = true
    error.value   = null
    try {
      const { data: poolInfo } = await axios.get(`/curves/${methodId}`)
      if (!poolInfo?.poolAddress) throw new Error('Pool not found on server')

      const conn   = getConn()
      const client = DynamicBondingCurveClient.create(conn)
      const owner  = new PublicKey(walletAddress.value)
      const pool   = new PublicKey(poolInfo.poolAddress)

      // Get minimum amount out with 1 % slippage
      const referralTokenAccount = await getReferralTokenAccount(conn)
      const poolState  = await client.state.getPool(pool)
      const configState = await client.state.getPoolConfig(poolState.config)
      const quote       = swapQuote(poolState, configState, false /* buy base */, new BN(solLamports.toString()), 100 /* 1% slippage */, !!referralTokenAccount)

      const tx = await client.pool.swap({
        pool,
        amountIn:         new BN(solLamports.toString()),
        minimumAmountOut: quote.minimumAmountOut ?? quote.minimumOutputAmount,
        swapBaseForQuote: false,  // buying signal tokens with SOL
        owner,
        payer:            owner,
        referralTokenAccount,
      })

      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      tx.feePayer        = owner

      const signed = await walletProvider.value.signTransaction(tx)
      const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false })
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

      await Promise.all([loadCurveState(methodId), loadChart(methodId), loadSolBalance()])
      return sig
    } finally {
      loading.value = false
    }
  }

  // ── Sell: signal tokens → SOL (on-chain Meteora swap) ────────────────────────
  async function sellSignal(methodId, tokenAmount) {
    if (!walletAddress.value || !walletProvider.value)
      throw new Error('Wallet not connected')

    loading.value = true
    error.value   = null
    try {
      const { data: poolInfo } = await axios.get(`/curves/${methodId}`)
      if (!poolInfo?.poolAddress) throw new Error('Pool not found on server')

      const conn   = getConn()
      const client = DynamicBondingCurveClient.create(conn)
      const owner  = new PublicKey(walletAddress.value)
      const pool   = new PublicKey(poolInfo.poolAddress)

      // Get minimum SOL out with 1 % slippage
      const referralTokenAccount = await getReferralTokenAccount(conn)
      const poolState   = await client.state.getPool(pool)
      const configState = await client.state.getPoolConfig(poolState.config)
      const quote        = swapQuote(poolState, configState, true /* sell base */, new BN(tokenAmount.toString()), 100 /* 1% slippage */, !!referralTokenAccount)

      const tx = await client.pool.swap({
        pool,
        amountIn:         new BN(tokenAmount.toString()),
        minimumAmountOut: quote.minimumAmountOut ?? quote.minimumOutputAmount,
        swapBaseForQuote: true,   // selling signal tokens for SOL
        owner,
        payer:            owner,
        referralTokenAccount,
      })

      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      tx.feePayer        = owner

      const signed = await walletProvider.value.signTransaction(tx)
      const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false })
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

      await Promise.all([loadCurveState(methodId), loadChart(methodId), loadSolBalance()])
      return sig
    } finally {
      loading.value = false
    }
  }

  // ── Claim creator trading fees ────────────────────────────────────────────────
  async function claimCreatorFees(methodId) {
    if (!walletAddress.value || !walletProvider.value)
      throw new Error('Wallet not connected')

    loading.value = true
    error.value   = null
    try {
      const { data: poolInfo } = await axios.get(`/curves/${methodId}`)
      if (!poolInfo?.poolAddress) throw new Error('Pool not found')

      const conn   = getConn()
      const client = DynamicBondingCurveClient.create(conn)
      const owner  = new PublicKey(walletAddress.value)
      const pool   = new PublicKey(poolInfo.poolAddress)

      const tx = await client.creator.claimCreatorTradingFee({
        pool,
        creator:         owner,
        receiver:        owner,
        payer:           owner,
        maxBaseAmount:   BigInt('18446744073709551615'), // u64::MAX — claim all
        maxQuoteAmount:  BigInt('18446744073709551615'),
      })

      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash()
      tx.recentBlockhash = blockhash
      tx.feePayer        = owner

      const signed = await walletProvider.value.signTransaction(tx)
      const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false })
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')

      await loadSolBalance()
      return sig
    } finally {
      loading.value = false
    }
  }

  return {
    curveState, chartCandles, solBalance, ownedTokens, quoteResult, loading, error,
    loadSolBalance, loadCurveState, loadTokenBalance, loadChart, getQuote,
    buySignal, sellSignal, claimCreatorFees,
  }
}
