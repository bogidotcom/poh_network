import { ref } from 'vue'
import axios from 'axios'

const DEFAULT_BOOTNODES = [
  'https://poh.assetux.com',
  'https://bootnode.proofofhuman.ge',
  'https://proofofhuman.ge',
]

/**
 * useMinerNetwork
 * Discovers verified poh-miner peers from bootnode and provides helpers
 * to publish a verdict job to a miner node and pull the result (verdict + profile + evidence).
 * Accepts an array of bootnode URLs and tries each in order until one succeeds.
 */
export function useMinerNetwork(bootnodes = DEFAULT_BOOTNODES) {
  const _bootnodes = Array.isArray(bootnodes) ? bootnodes : [bootnodes]

  const peers = ref([])
  const selectedPeer = ref(null)
  const isDiscovering = ref(false)
  const isSubmitting = ref(false)
  const lastError = ref(null)

  async function discoverPeers() {
    isDiscovering.value = true
    lastError.value = null
    try {
      let data = null
      for (const url of _bootnodes) {
        try {
          const res = await axios.get(`${url}/peers`, { timeout: 8000 })
          data = res.data
          break
        } catch (e) {
          console.warn(`[miner-network] bootnode ${url} unavailable:`, e?.message)
        }
      }
      if (!data) throw new Error('All bootnodes unavailable')
      const list = Array.isArray(data?.peers) ? data.peers : []
      // Only keep peers that look usable and preferably verified (post-protection)
      peers.value = list.filter(p => p && p.host && (p.walletApiPort || p.port || 3456))
      // Auto-pick a good one (prefer verified + non-localhost)
      if (peers.value.length) {
        const verified = peers.value.filter(p => p.verified)
        const pool = verified.length ? verified : peers.value
        const nonLocal = pool.find(p => {
          const h = (p.host || '').toLowerCase()
          return !h.includes('localhost') && !h.startsWith('127.') && !h.startsWith('0.0.0.0') && !h.startsWith('::1')
        })
        selectedPeer.value = nonLocal || pool[0]
      }
    } catch (e) {
      lastError.value = e?.message || 'Discovery failed'
      console.warn('[miner-network] peer discovery failed:', e?.message)
      // keep previous peers
    } finally {
      isDiscovering.value = false
    }
  }

  function getNodeBase(peer = null) {
    const p = peer || selectedPeer.value
    if (!p) return null
    const port = p.walletApiPort || p.port || 3456
    let host = p.host || 'localhost'
    // If the peer reports localhost but we're in browser, user may need to override, but keep as-is
    return `http://${host}:${port}`
  }

  async function submitJobToPeer(address, peer = null) {
    const base = getNodeBase(peer)
    if (!base) throw new Error('No miner peer selected')
    const payload = {
      type: 'verdict',
      payload: { address: String(address || '').trim() }
    }
    const { data } = await axios.post(`${base}/job`, payload, { timeout: 15000 })
    if (!data?.jobId) throw new Error('Miner did not return a jobId')
    return { jobId: data.jobId, base }
  }

  async function pollResult(jobId, base, { maxAttempts = 40, intervalMs = 1500 } = {}) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await axios.get(`${base}/job/${jobId}/result`, { timeout: 8000 })
        if (resp.status === 200 && resp.data && resp.data.verdict) {
          return resp.data
        }
      } catch (err) {
        const status = err?.response?.status
        if (status === 202 || status === 404) {
          // still processing or not yet available
        } else {
          // transient network error etc, keep trying
        }
      }
      await new Promise(r => setTimeout(r, intervalMs))
    }
    throw new Error('Timed out waiting for result from miner node')
  }

  async function searchOnNetwork(address) {
    isSubmitting.value = true
    lastError.value = null
    try {
      if (!selectedPeer.value && peers.value.length === 0) {
        await discoverPeers()
      }
      const { jobId, base } = await submitJobToPeer(address)
      const result = await pollResult(jobId, base)
      // attach for convenience
      return { ...result, jobId, nodeBase: base }
    } catch (e) {
      lastError.value = e?.message || 'Network search failed'
      throw e
    } finally {
      isSubmitting.value = false
    }
  }

  async function postFeedback(address, aiVerdict, correction, comment = '', signals = []) {
    const base = getNodeBase()
    if (!base) throw new Error('No miner peer selected')
    const { data } = await axios.post(`${base}/api/brain/feedback`, {
      address, aiVerdict, correction, comment, signals,
    }, { timeout: 10000 })
    return data
  }

  async function postVote(method, voteType, vote, stakeWeight = 1, feedback = null) {
    const base = getNodeBase()
    if (!base) throw new Error('No miner peer selected')
    const { data } = await axios.post(`${base}/api/brain/vote`, {
      method, voteType, vote, stakeWeight, feedback,
    }, { timeout: 10000 })
    return data
  }

  async function fetchMethods() {
    const base = getNodeBase()
    if (!base) throw new Error('No miner peer selected')
    const { data } = await axios.get(`${base}/methods`, { timeout: 10000 })
    return data
  }

  async function fetchProfile(address) {
    const base = getNodeBase()
    if (!base) throw new Error('No miner peer selected')
    const { data } = await axios.get(`${base}/profile/${encodeURIComponent(address)}`, { timeout: 10000 })
    return data
  }

  return {
    BOOTNODE_URL: _bootnodes[0],
    peers,
    selectedPeer,
    isDiscovering,
    isSubmitting,
    lastError,
    discoverPeers,
    submitJobToPeer,
    pollResult,
    searchOnNetwork,
    getNodeBase,
    postFeedback,
    postVote,
    fetchMethods,
    fetchProfile,
  }
}
