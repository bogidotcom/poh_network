import { ref } from 'vue'
import axios from 'axios'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'

// Solana mainnet stablecoin mints (standard SPL, 6 decimals)
const STABLE_MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
}

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
  const depositToken     = ref('USDC')   // 'USDC' | 'USDT'
  const depositLoading   = ref(false)
  const depositMsg       = ref(null)
  const upgradeToken     = ref('USDC')  // 'USDC' | 'USDT' for upgrade payment

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
      const mintPubkey = new PublicKey(STABLE_MINTS[depositToken.value])
      const walletPubkey = new PublicKey(walletAddress.value)
      const recipientPubkey = new PublicKey(FEE_RECIPIENT.value)
      // Guard: FEE_RECIPIENT must not be the depositing wallet itself
      if (walletPubkey.equals(recipientPubkey)) {
        throw new Error('Deposit recipient is the same as your wallet — check FEE_RECIPIENT config.')
      }

      // USDC/USDT use standard SPL TOKEN_PROGRAM_ID (no 4th arg needed)
      const fromAta = await getAssociatedTokenAddress(mintPubkey, walletPubkey)
      const toAta   = await getAssociatedTokenAddress(mintPubkey, recipientPubkey)

      // Verify sender ATA exists (gives a clearer error than InvalidAccountData)
      const fromAtaInfo = await connection.getAccountInfo(fromAta)
      if (!fromAtaInfo) throw new Error(`You don't have a ${depositToken.value} token account. Send some ${depositToken.value} to your wallet first.`)

      const tx = new Transaction()

      // Create recipient ATA if it doesn't exist yet (e.g. first USDT deposit ever)
      const toAtaInfo = await connection.getAccountInfo(toAta)
      if (!toAtaInfo) {
        tx.add(createAssociatedTokenAccountInstruction(
          walletPubkey,    // payer (sender covers the rent)
          toAta,           // ATA address to create
          recipientPubkey, // owner of the new ATA
          mintPubkey,      // token mint
        ))
      }

      tx.add(
        createTransferInstruction(fromAta, toAta, walletPubkey, BigInt(Math.floor(amount * 1_000_000_000)))
      )
      const txHash = await signAndSendTransaction(tx)
      const res = await axios.post('/profile/deposit', { address: walletAddress.value, txHash, amount })
      depositMsg.value = `Deposited $${amount} ${depositToken.value} ✓`
      if (profileData.value?.profile) profileData.value.profile.balance = res.data.balance
      depositAmount.value = ''
    } catch (err) {
      depositMsg.value = err.response?.data?.error || err.message || 'Deposit failed'
    } finally {
      depositLoading.value = false
    }
  }

  // Upgrade to Startup plan: pays exactly 1000 USDC/USDT to FEE_RECIPIENT
  async function upgradeToStartup() {
    if (!connected.value || !walletAddress.value) {
      profileError.value = 'Connect wallet first'
      return false
    }
    try {
      const amount = 1000
      const token = upgradeToken.value  // User-selected: USDC or USDT

      const connection = new Connection(SOLANA_RPC.value, 'confirmed')
      const walletPubkey = new PublicKey(walletAddress.value)
      const recipientPubkey = new PublicKey(FEE_RECIPIENT.value)
      const mintPubkey = new PublicKey(STABLE_MINTS[token])

      const fromAta = await getAssociatedTokenAddress(mintPubkey, walletPubkey)
      const toAta = await getAssociatedTokenAddress(mintPubkey, recipientPubkey)

      // Verify sender ATA exists (gives a clearer error)
      const fromAtaInfo = await connection.getAccountInfo(fromAta)
      if (!fromAtaInfo) throw new Error(`You don't have a ${token} token account. Send some ${token} to your wallet first.`)

      const tx = new Transaction()

      const toAtaInfo = await connection.getAccountInfo(toAta)
      if (!toAtaInfo) {
        tx.add(createAssociatedTokenAccountInstruction(
          walletPubkey, toAta, recipientPubkey, mintPubkey
        ))
      }

      tx.add(
        createTransferInstruction(fromAta, toAta, walletPubkey, BigInt(amount) * 1_000_000n)
      )

      const txHash = await signAndSendTransaction(tx)

      // Call backend to verify payment and grant startup plan
      const res = await axios.post('/profile/subscribe', {
        address: walletAddress.value,
        txHash,
        plan: 'startup'
      })

      profileData.value = res.data
      return true
    } catch (err) {
      profileError.value = err.response?.data?.error || err.message || 'Upgrade failed'
      return false
    }
  }

  return {
    profileData,
    profileLoading,
    profileError,
    signupLoading,
    showDepositModal,
    depositAmount,
    depositToken,
    depositLoading,
    depositMsg,
    upgradeToken,
    loadProfile,
    signupProfile,
    rotateApiKey,
    submitDeposit,
    upgradeToStartup,
  }
}
