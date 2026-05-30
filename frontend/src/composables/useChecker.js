import { ref, computed, watch, shallowRef } from 'vue'
import axios from 'axios'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'

// Solana mainnet stablecoin mints (standard SPL TOKEN_PROGRAM_ID, 6 decimals)
const STABLE_MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
}

export function useChecker({ walletAddress, connected, POH_MINT, FEE_RECIPIENT, SOLANA_RPC, signAndSendTransaction }) {
  const scanInput            = ref('')
  const selectedPlatform     = ref(null)  // null = auto-detect; 'twitter' | 'farcaster' | etc.
  // Auto-lowercase domain names; reset platform on new input
  watch(scanInput, v => {
    if (v.includes('.') && v !== v.toLowerCase()) scanInput.value = v.toLowerCase()
    selectedPlatform.value = null  // clear platform choice on every new keystroke
  })
  const resolvedInputDisplay = ref('')
  const checkerResults       = ref(null)
  const ofacResult           = ref(null) // top-level OFAC field from single scans
  const euResult             = ref(null)
  const ukResult             = ref(null)
  const showEvidence         = ref(false)
  const brainVerdict         = ref(null)
  const brainPolling         = ref(false)
  const brainKey             = ref(null)
  const faucetLoading        = ref(false)
  const faucetMsg            = ref(null)
  const batchFile            = ref(null)
  const batchRowCount        = ref(0)
  const batchRows            = ref([])
  const isResolving          = ref(false)
  const loading              = ref(false)
  const error                = ref(null)
  const batchJobId           = ref(null)
  const batchPolling         = ref(false)
  const batchProgress        = ref(null) // { done, total, percent }
  const isBatchScan          = ref(false)
  const inlineScanProfile    = ref(null) // populated when cache hit includes enriched profile
  const resolveResults       = shallowRef([])  // multi-match list when resolve returns >1
  const resolveQuery         = ref('')         // the original query that produced resolveResults

  const detectedChain = computed(() => {
    const v = scanInput.value?.trim()
    if (!v) return null
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return 'evm'
    if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/i.test(v)) return 'bitcoin'
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) return 'tron'
    if (/^(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}$/.test(v)) return 'ton'
    if (/^G[A-Z2-7]{55}$/.test(v)) return 'xlm'
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return 'solana'
    // Hint for platform-prefixed or @ searches
    if (v.startsWith('@') || v.includes(':')) return 'custom'
    return null
  })

  function isWalletAddress(input) {
    if (!input) return false
    if (/^0x[0-9a-fA-F]{40}$/.test(input)) return true
    if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,87}$/i.test(input)) return true
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(input)) return true
    if (/^(EQ|UQ|kQ|0Q)[a-zA-Z0-9_-]{46}$/.test(input)) return true
    if (/^G[A-Z2-7]{55}$/.test(input)) return true
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input)) return true
    return false
  }

  async function resolveToAddress(input, platformOverride) {
    const trimmed = input.trim()
    if (isWalletAddress(trimmed)) return trimmed

    // ── Platform override (user picked a chip) ────────────────────────────────
    if (platformOverride) {
      const q = `${platformOverride}:${trimmed}`
      const res = await axios.get('/checker/resolve', { params: { q } })
      const hits = res.data?.results || []
      if (hits.length === 1) return hits[0].address
      if (hits.length > 1) {
        resolveResults.value = hits
        resolveQuery.value   = trimmed
        const err = new Error('MULTI_RESULT')
        err.resolveResults = hits
        throw err
      }
      throw new Error(`No ${platformOverride} account found for "${trimmed}"`)
    }

    // .sol domain → Bonfida SNS
    if (trimmed.endsWith('.sol')) {
      const domain = trimmed.slice(0, -4)
      const res = await axios.get(`https://sns-sdk-proxy.bonfida.workers.dev/resolve/${domain}`)
      if (res.data?.result) return res.data.result
      throw new Error(`Could not resolve "${trimmed}" — SNS domain not found`)
    }

    // ENS / Space ID domains
    try {
      const res = await axios.get('https://nameapi.space.id/getAddress', { params: { domain: trimmed } })
      if (res.data?.code === 0 && res.data.address) return res.data.address
    } catch { /* fall through to ZNS */ }

    // ZNS domains
    const ZNS_TLD_CHAIN = {
      ink: 57073, bnb: 56, base: 8453, blast: 81457, polygon: 137,
      zora: 7777777, scroll: 534352, taiko: 167000, bera: 80094,
      sonic: 146, kaia: 8217, abstract: 2741, defi: 130, unichain: 1301,
      soneium: 1868, plume: 98865, hemi: 43111, xrpl: 1440002,
    }
    const tld = trimmed.split('.').pop()?.toLowerCase()
    const onlyDomain = trimmed.split('.').slice(0, -1).join('.')

    const znsChains = ZNS_TLD_CHAIN[tld] ? [ZNS_TLD_CHAIN[tld]] : Object.values(ZNS_TLD_CHAIN)
    for (const chain of znsChains) {
      try {
        const res = await axios.get('https://zns.bio/api/resolveDomain', { params: { chain, domain: onlyDomain } })
        if (res.data?.code === 200 && isWalletAddress(res.data.address)) return res.data.address
      } catch { /* try next chain */ }
    }

    // ── Fallback: backend /checker/resolve (name, @handle, platform:handle, free text) ──
    try {
      const res = await axios.get('/checker/resolve', { params: { q: trimmed } })
      const hits = res.data?.results || []
      if (hits.length === 1) return hits[0].address
      if (hits.length > 1) {
        // Surface results to the caller via resolveResults — caller must pick
        resolveResults.value = hits
        resolveQuery.value   = trimmed
        // Throw a special sentinel so runCheck knows to stop and show picker
        const err = new Error('MULTI_RESULT')
        err.resolveResults = hits
        throw err
      }
    } catch (e) {
      if (e.message === 'MULTI_RESULT') throw e
      /* network/API error — fall through to final error */
    }

    throw new Error(`Could not resolve "${trimmed}" — try an address, domain, or platform:handle`)
  }

  const handleFileSelect = (event) => {
    const file = event.target.files[0]
    if (file) {
      batchFile.value = file
      const reader = new FileReader()
      reader.onload = (e) => {
        const lines = e.target.result.split('\n').filter(r => r.trim())
        const rows = lines.slice(1) // skip header
        batchRows.value = rows.map(r => r.split(',')[0].trim().replace(/^"(.*)"$/, '$1'))
        batchRowCount.value = rows.length
      }
      reader.readAsText(file)
    }
  }

  const claimFaucet = async () => {
    if (!walletAddress.value) { error.value = 'Connect wallet first'; return }
    faucetLoading.value = true
    faucetMsg.value = null
    try {
      const res = await axios.post('/profile/faucet', { address: walletAddress.value })
      faucetMsg.value = { ok: true, text: `10 000 POH sent — tx: ${res.data.txHash?.slice(0, 16)}…` }
    } catch (err) {
      faucetMsg.value = { ok: false, text: err.response?.data?.error || 'Faucet failed' }
    } finally {
      faucetLoading.value = false
    }
  }

  // Called when the user picks one result from a multi-resolve list
  const pickResolveResult = (hit) => {
    resolveResults.value = []
    scanInput.value      = hit.address
    resolvedInputDisplay.value = hit.displayName
      ? `${hit.displayName} (${hit.address})`
      : hit.handle ? `${hit.handle} → ${hit.address}` : hit.address
    runCheck()
  }

  const runCheck = async () => {
    if (!connected.value) return
    checkerResults.value  = null
    ofacResult.value      = null
    brainVerdict.value    = null
    brainPolling.value    = false
    brainKey.value        = null
    batchProgress.value   = null
    batchPolling.value    = false
    isBatchScan.value     = !!batchFile.value
    inlineScanProfile.value = null
    resolveResults.value  = []
    loading.value = true
    isResolving.value = true
    error.value = null
    resolvedInputDisplay.value = ''
    try {
      let resolvedInputs = []
      if (batchFile.value) {
        // Use allSettled so one bad address doesn't kill the whole batch
        const settled = await Promise.allSettled(batchRows.value.map(resolveToAddress))
        resolvedInputs = settled.filter(r => r.status === 'fulfilled').map(r => r.value)
        const skipped  = settled.filter(r => r.status === 'rejected').length
        if (skipped) console.warn(`[batch] skipped ${skipped} unresolvable address(es)`)
        if (!resolvedInputs.length) throw new Error('No valid addresses to scan — check CSV format')
      } else {
        const resolved = await resolveToAddress(scanInput.value, selectedPlatform.value)
        if (resolved !== scanInput.value.trim()) {
          resolvedInputDisplay.value = resolved
        }
        resolvedInputs = [resolved]
      }
      isResolving.value = false

      let txHash = null
      const { data: pricingData } = await axios.get(`/checker/pricing?count=${resolvedInputs.length}`)
      const freeScanData = await axios.get('/profile/' + walletAddress.value).catch(() => null)
      const freeScansLeft = freeScanData?.data?.profile?.freeScansLeft ?? 100

      if (freeScansLeft < resolvedInputs.length && FEE_RECIPIENT.value) {
        // Payment in USDC (standard SPL — no TOKEN_2022_PROGRAM_ID needed)
        const costRaw      = pricingData.total   // raw 6-decimal USDC units
        const connection   = new Connection(SOLANA_RPC.value, 'confirmed')
        const mintPubkey   = new PublicKey(STABLE_MINTS.USDC)
        const walletPubkey = new PublicKey(walletAddress.value)
        const recipientPubkey = new PublicKey(FEE_RECIPIENT.value)
        // Default getAssociatedTokenAddress uses TOKEN_PROGRAM_ID — correct for USDC
        const fromAta = await getAssociatedTokenAddress(mintPubkey, walletPubkey)
        const toAta   = await getAssociatedTokenAddress(mintPubkey, recipientPubkey)
        const fromAtaInfo = await connection.getAccountInfo(fromAta)
        if (!fromAtaInfo) throw new Error('No USDC token account found in your wallet')
        const payTx = new Transaction()
        // Create recipient ATA if first time receiving USDC (avoids InvalidAccountData)
        const toAtaInfo = await connection.getAccountInfo(toAta)
        if (!toAtaInfo) {
          payTx.add(createAssociatedTokenAccountInstruction(walletPubkey, toAta, recipientPubkey, mintPubkey))
        }
        payTx.add(createTransferInstruction(fromAta, toAta, walletPubkey, BigInt(costRaw)))
        txHash = await signAndSendTransaction(payTx)
      }

      const formData = new FormData()
      if (batchFile.value) {
        const header = 'address\n'
        const csvContent = header + resolvedInputs.join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv' })
        formData.append('csv', blob, 'resolved.csv')
      } else {
        formData.append('input', resolvedInputs[0])
      }
      formData.append('walletAddress', walletAddress.value)
      if (txHash) formData.append('txHash', txHash)

      const res = await axios.post('/checker', formData)

      if (res.data.jobId) {
        batchJobId.value    = res.data.jobId
        batchPolling.value  = true
        batchProgress.value = { done: 0, total: res.data.total, percent: 0 }
        checkerResults.value = null
        const jobPoll = setInterval(async () => {
          try {
            const job = await axios.get(`/checker/job/${res.data.jobId}`)
            batchProgress.value = { done: job.data.done ?? 0, total: job.data.total, percent: job.data.percent ?? 0 }
            if (Array.isArray(job.data.results) && job.data.results.length) {
              checkerResults.value = job.data.results
            }
            if (job.data.status === 'done') {
              batchPolling.value = false
              clearInterval(jobPoll)
            }
          } catch { batchPolling.value = false; clearInterval(jobPoll) }
        }, 3000)
        setTimeout(() => { clearInterval(jobPoll); batchPolling.value = false }, 2 * 60 * 60 * 1000)
      } else {
        checkerResults.value = res.data.result
        ofacResult.value   = res.data.ofac || null
        euResult.value     = res.data.eu   || null
        ukResult.value     = res.data.uk   || null
        brainVerdict.value = null
        brainKey.value     = null
        showEvidence.value = false

        // ── Cache hit: verdict and profile are inline (no polling needed) ──
        if (res.data.verdict) {
          brainVerdict.value = {
            status:     'done',
            verdict:    res.data.verdict,
            confidence: res.data.confidence,
            reasoning:  res.data.reasoning,
          }
          brainPolling.value = false
        }
        if (res.data.profile) {
          inlineScanProfile.value = res.data.profile
        }

        // ── Fresh scan: poll brain endpoint for async verdict ───────────────
        const _brainKey = res.data.brainKey
        if (_brainKey) {
          brainKey.value = _brainKey
          brainPolling.value = true
          const poll = setInterval(async () => {
            try {
              const b = await axios.get(`/checker/brain/${encodeURIComponent(_brainKey)}`)
              if (b.data.status === 'done' || b.data.status === 'error') {
                brainVerdict.value = b.data
                brainPolling.value = false
                clearInterval(poll)
              }
            } catch { clearInterval(poll); brainPolling.value = false }
          }, 4000)
          setTimeout(() => { clearInterval(poll); brainPolling.value = false }, 180000)
        }
      }
    } catch (err) {
      if (err.message === 'MULTI_RESULT') {
        // resolveResults already populated — just stop loading, show picker
        isResolving.value = false
        loading.value = false
        return
      }
      console.log(err.data, err.message, err.response)
      error.value = err.response?.data?.error || err.message || 'Scan failed'
      isResolving.value = false
    } finally {
      loading.value = false
    }
  }

  return {
    scanInput,
    resolvedInputDisplay,
    checkerResults,
    ofacResult,
    euResult,
    ukResult,
    showEvidence,
    brainVerdict,
    brainPolling,
    brainKey,
    faucetLoading,
    faucetMsg,
    batchFile,
    batchRowCount,
    batchRows,
    isResolving,
    loading,
    error,
    detectedChain,
    resolveToAddress,
    handleFileSelect,
    claimFaucet,
    runCheck,
    batchJobId,
    batchPolling,
    batchProgress,
    isBatchScan,
    inlineScanProfile,
    resolveResults,
    resolveQuery,
    pickResolveResult,
    selectedPlatform,
  }
}
