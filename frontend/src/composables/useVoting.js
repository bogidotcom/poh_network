import { ref, computed } from 'vue'
import axios from 'axios'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function encodeBase58(bytes) {
  let n = BigInt('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''))
  let result = ''
  while (n > 0n) { result = BASE58_ALPHABET[Number(n % 58n)] + result; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; result = '1' + result }
  return result
}

export function useVoting({ walletAddress, connected, adapterSignMessage }) {
  const votingList        = ref([])
  const voteIndex         = ref(0)
  const voteSubmitting    = ref(false)
  const voteFeedback      = ref('')
  const voteConfirmPending = ref(null)
  const feedbackValidating = ref(false)
  const myVotesData       = ref([])
  const loading           = ref(false)
  const error             = ref(null)

  const currentVoteItem = computed(() => votingList.value[voteIndex.value] ?? null)

  const loadVoting = async () => {
    loading.value = true
    try {
      const params = walletAddress.value ? { address: walletAddress.value } : {}
      const res = await axios.get('/methods/verifyer', { params })
      votingList.value = res.data.filter(m => !m.myVoted)
      voteIndex.value = 0
    } catch (err) {
      error.value = 'Failed to load voting queue'
    } finally {
      loading.value = false
    }
  }

  const castVote = async (voteVal) => {
    if (voteVal === 'skip') { voteIndex.value++; voteFeedback.value = ''; return }
    if (!connected.value) { error.value = 'Connect wallet to vote'; return }
    if (!adapterSignMessage.value) { error.value = 'Wallet does not support message signing'; return }

    // const fb = voteFeedback.value.trim()
    // if (fb) {
    //   feedbackValidating.value = true
    //   try {
    //     const res = await axios.post('/methods/verifyer/validate-feedback', { feedback: fb })
    //     if (!res.data.valid) {
    //       error.value = `Comment rejected: ${res.data.reason}`
    //       feedbackValidating.value = false
    //       return
    //     }
    //   } catch {
    //     // validation down — proceed
    //   } finally {
    //     feedbackValidating.value = false
    //   }
    // }

    voteConfirmPending.value = voteVal
  }

  const confirmVote = async () => {
    const voteVal = voteConfirmPending.value
    voteConfirmPending.value = null
    voteSubmitting.value = true
    try {
      const type     = 'method'
      const methodId = currentVoteItem.value.id
      const message  = `poh-vote-v1:${methodId}:${voteVal}:${type}:${walletAddress.value}:${Date.now()}`
      const sig = await adapterSignMessage.value(new TextEncoder().encode(message))
      const sig58 = encodeBase58(sig)
      await axios.post('/methods/verifyer/vote', {
        methodId, vote: voteVal, type,
        walletAddress: walletAddress.value,
        signature: sig58, message,
        feedback: voteFeedback.value.trim() || undefined,
      })
      voteFeedback.value = ''
      votingList.value.splice(voteIndex.value, 1)
    } catch (err) {
      error.value = err.response?.data?.error || err.message || 'Vote failed'
    } finally {
      voteSubmitting.value = false
    }
  }

  const loadMyVotes = async () => {
    if (!walletAddress.value) return
    try {
      const res = await axios.get(`/profile/${walletAddress.value}/votes`)
      myVotesData.value = res.data.votes || []
    } catch { myVotesData.value = [] }
  }

  async function fetchMethodsForGraph() {
    try {
      const res = await axios.get('/methods/verifyer')
      votingList.value = res.data.sort((a, b) => (a.score || 0) - (b.score || 0))
    } catch {}
  }

  return {
    votingList,
    voteIndex,
    voteSubmitting,
    voteFeedback,
    voteConfirmPending,
    feedbackValidating,
    currentVoteItem,
    myVotesData,
    loading,
    error,
    loadVoting,
    castVote,
    confirmVote,
    loadMyVotes,
    fetchMethodsForGraph,
  }
}
