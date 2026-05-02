import { ref } from 'vue'
import axios from 'axios'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
export function encodeBase58(bytes) {
  let n = BigInt('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''))
  let result = ''
  while (n > 0n) { result = BASE58_ALPHABET[Number(n % 58n)] + result; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; result = '1' + result }
  return result
}

export function useProfile({ walletAddress, connected, adapterSignMessage, POH_MINT, FEE_RECIPIENT, SOLANA_RPC, signAndSendTransaction, loadPohBalance }) {
  const profileData      = ref(null)
  const profileLoading   = ref(false)
  const profileError     = ref(null)
  const signupLoading    = ref(false)
  const showDepositModal = ref(false)
  const depositAmount    = ref('')
  const depositLoading   = ref(false)
  const depositMsg       = ref(null)
  const offchainClaimLoading = ref(false)
  const stakeMessage     = ref(null)

  async function loadProfile() {
    if (!walletAddress.value) return
    profileLoading.value = true
    profileError.value = null
    try {
      const res = await axios.get(`/profile/${walletAddress.value}`)
      profileData.value = res.data
    } catch (err) {
      if (err.response?.status === 404) profileData.value = null
      else profileError.value = err.response?.data?.error || 'Failed to load profile'
    } finally {
      profileLoading.value = false
    }
  }

  async function signupProfile() {
    if (!walletAddress.value || !adapterSignMessage.value) { profileError.value = 'Connect wallet first'; return }
    signupLoading.value = true
    profileError.value = null
    try {
      const message = `poh-profile-v1:${walletAddress.value}:${Date.now()}`
      const messageBytes = new TextEncoder().encode(message)
      const sigBytes = await adapterSignMessage.value(messageBytes)
      const bs58sig = encodeBase58(sigBytes)
      await axios.post('/profile/signup', { address: walletAddress.value, signature: bs58sig, message })
      await loadProfile()
    } catch (err) {
      profileError.value = err.response?.data?.error || err.message || 'Signup failed'
    } finally {
      signupLoading.value = false
    }
  }

  async function rotateApiKey() {
    if (!walletAddress.value) return
    try {
      const res = await axios.post('/profile/apikey/rotate', { address: walletAddress.value })
      if (profileData.value?.profile) profileData.value.profile.apiKey = res.data.apiKey
    } catch (err) {
      profileError.value = err.response?.data?.error || 'Rotate failed'
    }
  }

  async function submitDeposit() {
    if (!connected.value || !depositAmount.value) return
    const amount = parseFloat(depositAmount.value)
    if (!amount || amount <= 0) { depositMsg.value = 'Enter a valid amount'; return }
    depositLoading.value = true
    depositMsg.value = null
    try {
      const connection = new Connection(SOLANA_RPC.value, 'confirmed')
      const mintPubkey = new PublicKey(POH_MINT.value)
      const walletPubkey = new PublicKey(walletAddress.value)
      const recipientPubkey = new PublicKey(FEE_RECIPIENT.value)
      const fromAta = await getAssociatedTokenAddress(mintPubkey, walletPubkey)
      const toAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey)
      const tx = new Transaction().add(
        createTransferInstruction(fromAta, toAta, walletPubkey, BigInt(Math.floor(amount * 1_000_000)))
      )
      const txHash = await signAndSendTransaction(tx)
      const res = await axios.post('/profile/deposit', { address: walletAddress.value, txHash, amount })
      depositMsg.value = `Deposited ${amount} POH ✓`
      if (profileData.value?.profile) profileData.value.profile.balance = res.data.balance
      depositAmount.value = ''
    } catch (err) {
      depositMsg.value = err.response?.data?.error || err.message || 'Deposit failed'
    } finally {
      depositLoading.value = false
    }
  }

  async function claimOffchainBalance() {
    if (!connected.value) { stakeMessage.value = 'Connect wallet to claim'; return }
    offchainClaimLoading.value = true
    stakeMessage.value = null
    try {
      const res = await axios.post('/profile/claim', { address: walletAddress.value })
      const poh = (res.data.claimed / 1e6).toFixed(2)
      stakeMessage.value = `Claimed ${poh} POH off-chain rewards ✓`
      await loadProfile()
      if (loadPohBalance) await loadPohBalance()
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Claim failed'
      stakeMessage.value = msg
    } finally {
      offchainClaimLoading.value = false
    }
  }

  return {
    profileData,
    profileLoading,
    profileError,
    signupLoading,
    showDepositModal,
    depositAmount,
    depositLoading,
    depositMsg,
    offchainClaimLoading,
    stakeMessage,
    loadProfile,
    signupProfile,
    rotateApiKey,
    submitDeposit,
    claimOffchainBalance,
  }
}
