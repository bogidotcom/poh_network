import { ref } from 'vue'
import axios from 'axios'
import { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js'

// Base58 encoder (mirrors useVoting.js approach — no extra dep)
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function encodeBase58(bytes) {
  let n = BigInt('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''))
  let result = ''
  while (n > 0n) { result = B58[Number(n % 58n)] + result; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; result = '1' + result }
  return result
}

export function useCurve({ walletAddress, walletProvider, adapterSignMessage, SOLANA_RPC, FEE_RECIPIENT }) {
  const curveState   = ref(null)
  const chartCandles = ref([])
  const solBalance   = ref(0)
  const ownedTokens  = ref(0)
  const quoteResult  = ref(null)
  const loading      = ref(false)
  const error        = ref(null)

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function loadSolBalance() {
    if (!walletAddress.value || !SOLANA_RPC.value) return
    try {
      const conn = new Connection(SOLANA_RPC.value, 'confirmed')
      const bal  = await conn.getBalance(new PublicKey(walletAddress.value))
      solBalance.value = bal / LAMPORTS_PER_SOL
    } catch { solBalance.value = 0 }
  }

  async function loadCurveState(methodId) {
    if (!methodId) return
    try {
      const { data } = await axios.get(`/curves/${methodId}`)
      curveState.value = data
    } catch { curveState.value = null }
    // Load owned tokens from profile
    if (walletAddress.value) {
      try {
        const { data } = await axios.get(`/profile/${walletAddress.value}`)
        ownedTokens.value = data?.profile?.signalTokens?.[methodId] || 0
      } catch { ownedTokens.value = 0 }
    }
  }

  async function loadChart(methodId) {
    if (!methodId) return
    try {
      const { data } = await axios.get(`/curves/${methodId}/chart`)
      chartCandles.value = data.candles || []
    } catch { chartCandles.value = [] }
  }

  async function getQuote(methodId, action, tokenAmount) {
    quoteResult.value = null
    if (!methodId || !tokenAmount || tokenAmount <= 0) return
    try {
      const { data } = await axios.get(`/curves/${methodId}/quote`, {
        params: { action, amount: tokenAmount, wallet: walletAddress.value || undefined },
      })
      quoteResult.value = data
    } catch (err) {
      quoteResult.value = null
    }
  }

  // ── Buy: send SOL → receive signal tokens ───────────────────────────────────
  async function buySignal(methodId, tokenAmount) {
    if (!walletAddress.value || !walletProvider.value)
      throw new Error('Wallet not connected')
    if (!FEE_RECIPIENT.value)
      throw new Error('FEE_RECIPIENT not configured')

    loading.value = true
    error.value   = null
    try {
      // Fetch quote for gross SOL cost
      const { data: quote } = await axios.get(`/curves/${methodId}/quote`, {
        params: { action: 'buy', amount: tokenAmount },
      })
      const lamports = quote.grossCostLamports

      // Build and send SOL transfer tx
      const conn = new Connection(SOLANA_RPC.value, 'confirmed')
      const { blockhash } = await conn.getLatestBlockhash()
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer: new PublicKey(walletAddress.value) }).add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(walletAddress.value),
          toPubkey:   new PublicKey(FEE_RECIPIENT.value),
          lamports:   BigInt(lamports),
        })
      )
      const signed  = await walletProvider.value.signTransaction(tx)
      const txHash  = await conn.sendRawTransaction(signed.serialize())
      await conn.confirmTransaction(txHash, 'confirmed')

      // Notify backend to credit tokens
      await axios.post(`/curves/${methodId}/buy`, { txHash, walletAddress: walletAddress.value, tokenAmount })

      await Promise.all([loadCurveState(methodId), loadChart(methodId), loadSolBalance()])
      return txHash
    } finally {
      loading.value = false
    }
  }

  // ── Sell: burn signal tokens → receive SOL ──────────────────────────────────
  async function sellSignal(methodId, tokenAmount) {
    if (!walletAddress.value || !adapterSignMessage.value)
      throw new Error('Wallet not connected or signing not supported')

    loading.value = true
    error.value   = null
    try {
      const ts      = Date.now()
      const message = `poh-sell-v1:${methodId}:${tokenAmount}:${walletAddress.value}:${ts}`
      const sigBytes = await adapterSignMessage.value(new TextEncoder().encode(message))
      const signature = encodeBase58(sigBytes)

      const { data } = await axios.post(`/curves/${methodId}/sell`, {
        walletAddress: walletAddress.value,
        tokenAmount,
        signature,
        message,
      })

      await Promise.all([loadCurveState(methodId), loadChart(methodId), loadSolBalance()])
      return data.txHash
    } finally {
      loading.value = false
    }
  }

  return {
    curveState, chartCandles, solBalance, ownedTokens, quoteResult, loading, error,
    loadSolBalance, loadCurveState, loadChart, getQuote, buySignal, sellSignal,
  }
}
