import { ref } from 'vue'
import axios from 'axios'

const POH_MINT         = ref('')
const FEE_RECIPIENT    = ref('')
const SOLANA_RPC       = ref('https://api.devnet.solana.com')
const STAKING_CONTRACT = ref('')

async function fetchConfig() {
  try {
    const { data } = await axios.get('/config')
    POH_MINT.value         = data.POH_MINT         ?? ''
    FEE_RECIPIENT.value    = data.FEE_RECIPIENT     ?? ''
    SOLANA_RPC.value       = data.SOLANA_RPC        ?? SOLANA_RPC.value
    STAKING_CONTRACT.value = data.STAKING_CONTRACT  ?? ''
  } catch (err) {
    console.error('[config] fetch failed', err)
  }
}

export function useConfig() {
  return { POH_MINT, FEE_RECIPIENT, SOLANA_RPC, STAKING_CONTRACT, fetchConfig }
}
