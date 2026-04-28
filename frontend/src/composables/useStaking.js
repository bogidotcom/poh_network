import { ref, watch } from 'vue'
import { useWallet } from './useWallet.js'
import { useConfig } from './useConfig.js'
import {
  getPohBalance, getStakeInfo, getGlobalState,
  stakeTokens, unstakeTokens, claimStakerRewards,
} from '../lib/pohProgram.js'

const { walletAddress, walletProvider, connected } = useWallet()
const { POH_MINT, SOLANA_RPC } = useConfig()

const pohBalance    = ref(0)
const stakedBalance = ref(0)
const claimable     = ref(0)
const totalStaked   = ref(0)

const stakeAmount    = ref('')
const unstakeAmount  = ref('')
const stakeLoading   = ref(false)
const unstakeLoading = ref(false)
const claimLoading   = ref(false)
const stakeMessage   = ref(null)

async function loadPohBalance() {
  if (!walletAddress.value || !POH_MINT.value) return
  const [bal, stakeInfo, global] = await Promise.all([
    getPohBalance(walletAddress.value, POH_MINT.value, SOLANA_RPC.value),
    getStakeInfo(walletAddress.value, SOLANA_RPC.value),
    getGlobalState(SOLANA_RPC.value),
  ])
  pohBalance.value    = bal
  stakedBalance.value = stakeInfo.staked
  claimable.value     = stakeInfo.pendingRewards
  totalStaked.value   = global?.totalStaked ?? 0
}

async function submitStake() {
  if (!connected.value) { stakeMessage.value = 'Connect wallet to stake'; return }
  const amount = parseFloat(stakeAmount.value)
  if (!amount || amount <= 0) { stakeMessage.value = 'Enter a valid amount'; return }
  if (amount > pohBalance.value) { stakeMessage.value = 'Insufficient POH balance'; return }
  stakeLoading.value = true; stakeMessage.value = null
  try {
    await stakeTokens(walletProvider.value, walletAddress.value, POH_MINT.value, SOLANA_RPC.value, amount)
    stakeMessage.value = `Staked ${amount} POH ✓`
    stakeAmount.value = ''
    await loadPohBalance()
  } catch (err) {
    stakeMessage.value = err.message || 'Stake failed'
  } finally { stakeLoading.value = false }
}

async function submitUnstake() {
  if (!connected.value) { stakeMessage.value = 'Connect wallet to unstake'; return }
  const amount = parseFloat(unstakeAmount.value)
  if (!amount || amount <= 0) { stakeMessage.value = 'Enter a valid amount'; return }
  if (amount > stakedBalance.value) { stakeMessage.value = 'Insufficient staked balance'; return }
  unstakeLoading.value = true; stakeMessage.value = null
  try {
    await unstakeTokens(walletProvider.value, walletAddress.value, POH_MINT.value, SOLANA_RPC.value, amount)
    stakeMessage.value = `Unstaked ${amount} POH ✓`
    unstakeAmount.value = ''
    await loadPohBalance()
  } catch (err) {
    stakeMessage.value = err.message || 'Unstake failed'
  } finally { unstakeLoading.value = false }
}

async function claimRewards() {
  if (!connected.value) { stakeMessage.value = 'Connect wallet to claim'; return }
  claimLoading.value = true; stakeMessage.value = null
  try {
    await claimStakerRewards(walletProvider.value, walletAddress.value, POH_MINT.value, SOLANA_RPC.value)
    stakeMessage.value = `Claimed ${claimable.value.toFixed(4)} POH ✓`
    await loadPohBalance()
  } catch (err) {
    stakeMessage.value = err.message || 'Claim failed'
  } finally { claimLoading.value = false }
}

watch(walletAddress, (addr) => { if (addr && POH_MINT.value) loadPohBalance() })

export function useStaking() {
  return {
    pohBalance, stakedBalance, claimable, totalStaked,
    stakeAmount, unstakeAmount,
    stakeLoading, unstakeLoading, claimLoading, stakeMessage,
    loadPohBalance, submitStake, submitUnstake, claimRewards,
  }
}
