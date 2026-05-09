<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import axios from 'axios'
import BrainGraph from './BrainGraph.vue'
import ScannerSection from './ScannerSection.vue'
import ListingSection from './ListingSection.vue'
import VoteQueueSection from './VoteQueueSection.vue'
import ProfileSection from './ProfileSection.vue'
import ApiDocsSection from './ApiDocsSection.vue'
import {
  Search, PlusSquare, Vote,
  Activity, SquareArrowDown, PersonStanding, FolderCode, CreditCard, Bitcoin, Waypoints, FingerprintPattern, CandlestickChart,
  FingerprintIcon, FileUp, Trash2
} from 'lucide-vue-next'
import {
  Transaction,
} from '@solana/web3.js'
import { useWalletConnect } from '../composables/useWalletConnect.js'
import { useConfig } from '../composables/useConfig.js'
import { useChecker } from '../composables/useChecker.js'
import { useVoting } from '../composables/useVoting.js'
import { useListing } from '../composables/useListing.js'
import { useProfile } from '../composables/useProfile.js'
import {
  getPohBalance, getStakeInfo, getGlobalState,
  stakeTokens, unstakeTokens,
  castVote as castVoteOnChain, claimStakerRewards,
} from '../pohProgram.js'

// ── Devnet network suggestion — set to false to disable ───────────────────────
const SUGGEST_DEVNET_NETWORK = true

// ── UI State ──────────────────────────────────────────────────────────────────
const currentSection = ref('landing')
const mobileMenuOpen = ref(false)
const loading = ref(false)
const error = ref(null)
const showSection = (id) => { currentSection.value = id; mobileMenuOpen.value = false }

// ── Config ────────────────────────────────────────────────────────────────────
const { POH_MINT, FEE_RECIPIENT, SOLANA_RPC, STAKING_CONTRACT, fetchConfig } = useConfig()

// ── Wallet ────────────────────────────────────────────────────────────────────
const {
  publicKey,
  connected,
  connecting,
  wallets,
  walletName,
  adapterSignMessage,
  walletAddress,
  walletProvider,
  showWalletModal,
  shortAddress,
  connectWallet,
  disconnectWallet,
  signAndSendTransaction,
} = useWalletConnect({
  SOLANA_RPC,
  onConnect: () => {
    loadProfile()
    if (POH_MINT.value) loadPohBalance()
    if (currentSection.value === 'votes') loadVoting()
    if (SUGGEST_DEVNET_NETWORK) suggestDevnetNetwork()
  },
})

// ── Devnet network suggestion ─────────────────────────────────────────────────
// null = hidden  |  'manual' = show banner  |  'switching' = trying API
const networkSuggestion = ref(null)
const networkSwitchMsg   = ref(null) // feedback after auto-switch attempt

// Devnet genesis hash — used as chain ID by Phantom's wallet_switchSolanaChain
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaXggjvHo1'

// Per-wallet manual instructions shown in the banner
const networkInstructions = computed(() => {
  const name = walletName.value
  if (name === 'Phantom')  return 'Phantom → Settings → Developer Settings → Testnet Mode → Devnet'
  if (name === 'Solflare') return 'Solflare → Settings → Network → Devnet'
  if (name === 'Backpack') return 'Backpack → Settings → Preferences → Network → Devnet'
  return 'Wallet settings → Network → switch to Devnet'
})

async function suggestDevnetNetwork() {
  networkSuggestion.value = 'manual'
  networkSwitchMsg.value  = null
  // Try Phantom's programmatic switch (v22+) — other wallets will throw
  try {
    const provider = window.phantom?.solana ?? window.solana
    if (!provider?.request) return
    networkSuggestion.value = 'switching'
    await provider.request({
      method: 'wallet_switchSolanaChain',
      params:  { solana_chain_id: DEVNET_GENESIS },
    })
    // Phantom switched — hide banner
    networkSuggestion.value = null
  } catch (e) {
    // 4001 = user rejected; anything else = not supported
    networkSuggestion.value = 'manual'
    networkSwitchMsg.value  = e?.code === 4001 ? 'Rejected — switch manually below' : 'Auto-switch not supported — switch manually'
  }
}

async function retryNetworkSwitch() {
  networkSwitchMsg.value = null
  networkSuggestion.value = 'switching'
  try {
    const provider = window.phantom?.solana ?? window.solana
    await provider.request({
      method: 'wallet_switchSolanaChain',
      params:  { solana_chain_id: DEVNET_GENESIS },
    })
    networkSuggestion.value = null
  } catch (e) {
    networkSuggestion.value = 'manual'
    networkSwitchMsg.value  = e?.code === 4001 ? 'Rejected — switch manually' : 'Not supported — switch manually in wallet settings'
  }
}

function dismissNetworkSuggestion() {
  networkSuggestion.value = null
  networkSwitchMsg.value  = null
}

// ── Checker ───────────────────────────────────────────────────────────────────
const checker = useChecker({ walletAddress, connected, POH_MINT, FEE_RECIPIENT, SOLANA_RPC, signAndSendTransaction })
const {
  scanInput, resolvedInputDisplay, checkerResults, showEvidence,
  brainVerdict, brainPolling, brainKey, batchFile, batchRowCount, batchRows,
  isResolving, detectedChain, faucetLoading, faucetMsg,
  runCheck, handleFileSelect, claimFaucet,
  batchPolling, batchProgress,
  loading: checkerLoading,
} = checker

const showEvidencePass = ref(true)
const showEvidenceFail = ref(false)

// ── Verdict feedback ──────────────────────────────────────────────────────────
const feedbackSent      = ref(false)
const feedbackSubmitting = ref(false)

async function submitFeedback(correction, comment = '') {
  if (feedbackSubmitting.value || feedbackSent.value || !brainVerdict.value) return
  feedbackSubmitting.value = true
  try {
    await axios.post('/checker/feedback', {
      brainKey:  brainKey.value,
      address:   resolvedInputDisplay.value || scanInput.value,
      aiVerdict: brainVerdict.value.verdict,
      correction,
      comment:   comment || undefined,
    })
    feedbackSent.value = true
  } catch { /* silent */ } finally {
    feedbackSubmitting.value = false
  }
}

// Reset feedback state when a new scan starts
watch(checkerResults, () => { feedbackSent.value = false })

// Proxy error from checker to top-level error ref
watch(checker.error, val => { if (val) error.value = val })

// ── Voting ────────────────────────────────────────────────────────────────────
const voting = useVoting({ walletAddress, connected, adapterSignMessage })
const {
  votingList, voteIndex, voteSubmitting, voteFeedback,
  voteConfirmPending, feedbackValidating, currentVoteItem, myVotesData,
  loadVoting, castVote, confirmVote, loadMyVotes, fetchMethodsForGraph,
} = voting

watch(voting.error, val => { if (val) error.value = val })

// ── Network visualization ─────────────────────────────────────────────────────
const NET_CX = 400, NET_CY = 210

function netShortLabel(desc = '') {
  const segment = desc.split(' — ')[0].split(' – ')[0].split(' (')[0].trim()
  const words = segment.split(' ').slice(0, 2).join(' ')
  return words.length > 13 ? words.slice(0, 12) + '…' : words
}

function netDuration(id) {
  const h = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return (1.4 + (h % 8) * 0.2).toFixed(1) + 's'
}

const netNodes = computed(() => {
  const all  = votingList.value
  const evm  = all.filter(m => m.type === 'evm').slice(0, 6)
  const rest = all.filter(m => m.type === 'rest').slice(0, 5)
  const sol  = all.filter(m => m.type === 'solana').slice(0, 4)

  if (!all.length) return [
    { id:'s0', type:'evm',    label:'ETH Balance',  x:192, y:100 },
    { id:'s1', type:'evm',    label:'TX Count',     x:148, y:210 },
    { id:'s2', type:'evm',    label:'USDC Hold',    x:192, y:320 },
    { id:'s3', type:'rest',   label:'ENS',          x:295, y: 48 },
    { id:'s4', type:'rest',   label:'Farcaster',    x:400, y: 34 },
    { id:'s5', type:'rest',   label:'Gitcoin',      x:505, y: 48 },
    { id:'s6', type:'solana', label:'SOL Balance',  x:608, y:100 },
    { id:'s7', type:'solana', label:'SPL Token',    x:652, y:210 },
    { id:'s8', type:'solana', label:'TX Count',     x:608, y:320 },
  ]

  const R = 188
  const nodes = []
  const place = (arr, aStart, aSpan) => arr.forEach((m, i) => {
    const a = (aStart + (arr.length > 1 ? i * aSpan / (arr.length - 1) : aSpan / 2)) * Math.PI / 180
    nodes.push({ id: m.id, type: m.type, label: netShortLabel(m.description),
      x: Math.round(NET_CX + R * Math.cos(a)),
      y: Math.round(NET_CY + R * Math.sin(a)) })
  })
  place(evm,  140, 80)
  place(rest, 245, 50)
  place(sol,  320, 80)
  return nodes
})

const netActiveId   = ref(null)
const netBrainPulse = ref(false)
let _netTimer = null

function startNetAnim() {
  _netTimer = setInterval(() => {
    const nodes = netNodes.value
    if (!nodes.length) return
    netActiveId.value = nodes[Math.floor(Math.random() * nodes.length)].id
    setTimeout(() => { netBrainPulse.value = true  }, 680)
    setTimeout(() => { netBrainPulse.value = false; netActiveId.value = null }, 1100)
  }, 1700)
}

// ── Staking ───────────────────────────────────────────────────────────────────
const stakeAmount    = ref('')
const unstakeAmount  = ref('')
const stakeLoading   = ref(false)
const unstakeLoading = ref(false)
const stakeMessage   = ref(null)
const pohBalance     = ref(0)
const stakedBalance  = ref(0)
const claimable      = ref(0)
const totalStaked    = ref(0)
const claimLoading   = ref(false)

async function loadPohBalance() {
  if (!walletAddress.value || !POH_MINT.value) return
  pohBalance.value = await getPohBalance(walletAddress.value, POH_MINT.value, SOLANA_RPC.value)
  const info = await getStakeInfo(walletAddress.value, SOLANA_RPC.value)
  stakedBalance.value = info.staked
  claimable.value     = info.pendingRewards
  const global = await getGlobalState(SOLANA_RPC.value)
  if (global) totalStaked.value = global.totalStaked
}

async function submitStake() {
  if (!connected.value) { error.value = 'Connect wallet to stake'; return }
  const amount = parseFloat(stakeAmount.value)
  if (!amount || amount <= 0) { stakeMessage.value = 'Enter a valid POH amount'; return }
  if (amount > pohBalance.value) { stakeMessage.value = 'Insufficient POH balance'; return }
  stakeLoading.value = true
  stakeMessage.value = null
  try {
    const txHash = await stakeTokens(
      walletProvider.value, walletAddress.value, POH_MINT.value, SOLANA_RPC.value, amount
    )
    stakeMessage.value = `Staked ${amount} POH ✓`
    stakeAmount.value = ''
    await loadPohBalance()
  } catch (err) {
    stakeMessage.value = err.message || 'Stake failed'
  } finally {
    stakeLoading.value = false
  }
}

async function submitUnstake() {
  if (!connected.value) { error.value = 'Connect wallet to unstake'; return }
  const amount = parseFloat(unstakeAmount.value)
  if (!amount || amount <= 0) { stakeMessage.value = 'Enter a valid POH amount'; return }
  if (amount > stakedBalance.value) { stakeMessage.value = 'Insufficient staked balance'; return }
  unstakeLoading.value = true
  stakeMessage.value = null
  try {
    const txHash = await unstakeTokens(
      walletProvider.value, walletAddress.value, POH_MINT.value, SOLANA_RPC.value, amount
    )
    stakeMessage.value = `Unstaked ${amount} POH ✓`
    unstakeAmount.value = ''
    await loadPohBalance()
  } catch (err) {
    stakeMessage.value = err.message || 'Unstake failed'
  } finally {
    unstakeLoading.value = false
  }
}

async function claimRewards() {
  if (!connected.value) { error.value = 'Connect wallet to claim'; return }
  claimLoading.value = true
  stakeMessage.value = null
  try {
    await claimStakerRewards(
      walletProvider.value, walletAddress.value, POH_MINT.value, SOLANA_RPC.value
    )
    stakeMessage.value = `Claimed ${claimable.value.toFixed(4)} POH ✓`
    await loadPohBalance()
  } catch (err) {
    stakeMessage.value = err.message || 'Claim failed'
  } finally {
    claimLoading.value = false
  }
}

// ── Profile ───────────────────────────────────────────────────────────────────
const profile = useProfile({
  walletAddress, connected, adapterSignMessage,
  POH_MINT, FEE_RECIPIENT, SOLANA_RPC, signAndSendTransaction,
  loadPohBalance,
})
const {
  profileData, profileLoading, profileError, signupLoading,
  showDepositModal, depositAmount, depositLoading, depositMsg,
  offchainClaimLoading,
  loadProfile, signupProfile, rotateApiKey, submitDeposit, claimOffchainBalance,
} = profile

// stakeMessage from profile composable merged with local stakeMessage
watch(profile.stakeMessage, val => { if (val) stakeMessage.value = val })

// ── Listing ───────────────────────────────────────────────────────────────────
const listingComposable = useListing({
  walletAddress, walletProvider, connected, POH_MINT, SOLANA_RPC,
  pohBalance, loadPohBalance,
})
const {
  listing, headers, abiFns, abiLoading, abiError,
  LISTING_FEE_POH,
  addHeader, removeHeader, fetchAbi, pickMethod, submitListing,
} = listingComposable

watch(listingComposable.error, val => { if (val) error.value = val })

// ── Helpers ───────────────────────────────────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {})
}

function goTo(url) {
  window.open(url, '_blank')
}

function autoExpand(e) {
  const el = e.target
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// ── Watchers ──────────────────────────────────────────────────────────────────
watch(walletAddress, (addr) => {
  if (addr && POH_MINT.value) loadPohBalance()
  if (addr) loadProfile()
})

onMounted(async () => {
  await fetchConfig()
  if (currentSection.value === 'votes') loadVoting()
  if (connected.value) loadPohBalance()
  fetchMethodsForGraph()
  startNetAnim()
})

onUnmounted(() => {
  if (_netTimer) clearInterval(_netTimer)
})
</script>

<template>
  <div class="app-container">
    <!-- Devnet banner -->
    <div class="devnet-bar">
      <span class="devnet-label">DEVNET</span>
      <span class="devnet-sep">·</span>
      <span class="devnet-hint">Test environment — Not priced by markets. Valued by people.</span>
      <a href="https://faucet.solana.com/"
         target="_blank"
         style="
          color: rgb(245 158 11);
          text-decoration: none;
          font-size: 1rem;"
      >Claim Devnet SOL here</a>
      <div class="devnet-bar-right">
        <span v-if="faucetMsg" :class="['devnet-faucet-msg', faucetMsg.ok ? 'devnet-faucet-msg--ok' : 'devnet-faucet-msg--err']">
          {{ faucetMsg.text }}
        </span>
        <button
          class="devnet-faucet-btn"
          :disabled="faucetLoading || !connected"
          @click="claimFaucet"
          :title="connected ? 'Claim 10 000 test POH tokens' : 'Connect wallet first'"
        >{{ faucetLoading ? 'Sending…' : 'Claim 10K POH' }}</button>
      </div>
    </div>

    <!-- Network suggestion banner -->
    <Transition name="net-suggest">
      <div v-if="networkSuggestion" class="net-suggest-bar">
        <span :class="['net-suggest-icon', { 'net-suggest-spinning': networkSuggestion === 'switching' }]">{{ networkSuggestion === 'switching' ? '↻' : '⚠' }}</span>
        <span class="net-suggest-text">
          <template v-if="networkSuggestion === 'switching'">
            Requesting Devnet switch in your wallet…
          </template>
          <template v-else>
            <span v-if="networkSwitchMsg" class="net-suggest-feedback">{{ networkSwitchMsg }} · </span>
            Switch to <strong>Devnet</strong>: {{ networkInstructions }}
          </template>
        </span>
        <button
          v-if="networkSuggestion !== 'switching'"
          class="net-suggest-retry"
          @click="retryNetworkSwitch"
        >Try auto-switch</button>
        <button class="net-suggest-dismiss" @click="dismissNetworkSuggestion">✕</button>
      </div>
    </Transition>

    <header class="header">
      <div @click="showSection('landing')" class="logo">
        <img src="/poh-icon.png" alt="POH Logo">
      </div>

      <!-- Desktop nav -->
      <nav class="nav desktop-nav">
        <button :class="['nav-btn', { active: currentSection === 'checker' }]" @click="showSection('checker')">
          <Search class="icon" :size="14" /> Scan
        </button>
        <button :class="['nav-btn', { active: currentSection === 'listing' }]" @click="showSection('listing')">
          <PlusSquare class="icon" :size="14" /> Train
        </button>
        <button :class="['nav-btn', { active: currentSection === 'votes' }]" @click="showSection('votes'); loadVoting()">
          <Vote class="icon" :size="14" /> Vote
        </button>
        <button :class="['nav-btn', { active: currentSection === 'staking' }]" @click="showSection('staking')">
          <SquareArrowDown class="icon" :size="14" /> Stake
        </button>
        <button :class="['nav-btn', { active: currentSection === 'profile' }]" @click="showSection('profile'); loadProfile(); loadMyVotes()">
          <PersonStanding class="icon" :size="14" /> Profile
        </button>
        <button :class="['nav-btn', { active: currentSection === 'api' }]" @click="showSection('api')">
          <FolderCode class="icon" :size="14" /> API
        </button>
      </nav>

      <div class="header-right">
        <!-- Desktop wallet -->
        <div class="wallet-wrapper desktop-wallet">
          <button v-if="!connected" @click="showWalletModal = true" class="select-wallet-btn">
            Connect Wallet
          </button>
          <div v-else class="connected-status">
            <div class="status-indicator"></div>
            <span class="address-text">{{ shortAddress }}</span>
            <button @click="disconnectWallet" class="disconnect-link">Disconnect</button>
          </div>
        </div>

        <!-- Hamburger -->
        <button class="hamburger" @click="mobileMenuOpen = !mobileMenuOpen" :class="{ open: mobileMenuOpen }">
          <span></span><span></span><span></span>
        </button>
      </div>
    </header>

    <!-- Mobile menu -->
    <div class="mobile-menu" :class="{ open: mobileMenuOpen }" @click.self="mobileMenuOpen = false">
      <div class="mobile-menu-inner">
        <button :class="['mobile-nav-btn', { active: currentSection === 'landing' }]" @click="showSection('landing')">POH</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'checker' }]" @click="showSection('checker')">Scan</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'listing' }]" @click="showSection('listing')">Train</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'votes' }]" @click="showSection('votes'); loadVoting()">Feedback</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'api' }]" @click="showSection('api')">API</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'staking' }]" @click="showSection('staking')">Stake</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'profile' }]" @click="showSection('profile'); loadProfile(); loadMyVotes()">Profile</button>
        <div class="mobile-menu-divider"></div>
        <button v-if="!connected" @click="showWalletModal = true; mobileMenuOpen = false" class="mobile-nav-btn mobile-connect">
          Connect Wallet
        </button>
        <div v-else class="mobile-wallet-status">
          <div class="status-indicator"></div>
          <span class="address-text">{{ shortAddress }}</span>
          <button @click="disconnectWallet; mobileMenuOpen = false" class="disconnect-link">Disconnect</button>
        </div>
      </div>
    </div>

    <!-- Vote Confirmation Modal -->
    <div v-if="voteConfirmPending !== null" class="modal-overlay" @click.self="voteConfirmPending = null">
      <div class="glass-panel modal vote-confirm-modal">
        <h3 class="modal-title">Confirm your Feedback</h3>
        <p class="modal-desc">
          You're providing feedback that classifies the item as
          <strong :class="voteConfirmPending === true ? 'vote-confirm-human' : 'vote-confirm-bot'">
            {{ voteConfirmPending === true ? '✓ Human' : '✗ Bot / AI' }}
          </strong>
          on <em>{{ currentVoteItem?.description }}</em>.
        </p>
        <p class="modal-desc vote-confirm-warn">This cannot be changed after submission.</p>
        <div v-if="voteFeedback.trim()" class="vote-confirm-comment">
          <span class="vote-confirm-comment-label">Your comment</span>
          <span class="vote-confirm-comment-text">{{ voteFeedback.trim() }}</span>
        </div>
        <div class="modal-actions">
          <button class="vcs-btn vcs-btn-yes" :disabled="voteSubmitting" @click="confirmVote">
            {{ voteSubmitting ? 'Signing…' : 'Confirm & Sign' }}
          </button>
          <button class="modal-close" @click="voteConfirmPending = null">Cancel</button>
        </div>
      </div>
    </div>

    <!-- Wallet Selection Modal -->
    <div v-if="showWalletModal" class="modal-overlay" @click.self="showWalletModal = false">
      <div class="glass-panel modal wallet-select-modal">
        <h3 class="modal-title">Connect Wallet</h3>
        <div class="wallet-list">
          <button
            v-for="w in wallets"
            :key="w.name"
            class="wallet-option"
            :class="{ 'wallet-option--detected': w.readyState === 'Installed' }"
            @click="connectWallet(w.name, w.url)"
          >
            <img :src="w.icon" :alt="w.name" class="wallet-icon" />
            <span class="wallet-name">{{ w.name }}</span>
            <span v-if="w.readyState === 'Installed'" class="wallet-badge wallet-badge--detected">Detected</span>
            <span v-else class="wallet-badge wallet-badge--install">Install</span>
          </button>
        </div>
        <button class="modal-close" @click="showWalletModal = false">Cancel</button>
      </div>
    </div>

    <!-- Deposit POH Modal -->
    <div v-if="showDepositModal" class="modal-overlay" @click.self="showDepositModal = false">
      <div class="glass-panel modal">
        <h3 class="modal-title">Deposit POH</h3>
        <p class="modal-desc">Send POH to your off-chain API balance. Useful for API calls without wallet interaction.</p>
        <div class="flex-input" style="margin:1rem 0">
          <input type="number" v-model="depositAmount" placeholder="Amount in POH" class="premium-input flex-grow" min="1" step="1" />
        </div>
        <div v-if="depositMsg" :class="['deposit-msg', depositMsg.includes('✓') ? 'deposit-ok' : 'deposit-err']">{{ depositMsg }}</div>
        <button class="submit-listing-btn" :disabled="depositLoading || !depositAmount" @click="submitDeposit()">
          {{ depositLoading ? 'Sending...' : 'Send POH' }}
        </button>
        <button class="modal-close" @click="showDepositModal = false; depositMsg = null">Cancel</button>
      </div>
    </div>

    <main class="main">
      <div v-if="error" class="error-msg" @click="error = null">{{ error }}</div>

      <!-- Landing -->
      <div v-if="currentSection === 'landing'" class="landing">

        <!-- Problem screen -->
        <section class="problem-screen">
          <div class="problem-inner">
            <div class="problem-tag">THE PROBLEM</div>
            <h2 class="problem-title">Soon, there will be more AI-agents, than <span class="problem-accent">people</span></h2>
            <blockquote class="problem-quote">
              <div class="problem-quote-inner">
                <img src="/jensen-huang.jpg" alt="Jensen Huang" class="problem-quote-avatar" />
                <div>
                  <span class="problem-quote-name">Jensen Huang, CEO of NVIDIA</span>
                  <p class="problem-quote-text">"The company already has a lot more cybersecurity AI agents than people working on cybersecurity."</p>
                </div>
              </div>
            </blockquote>
            <button class="neon-btn" @click="showSection('checker')">Scan a Wallet →</button>
          </div>
        </section>
        
        <h2 class="problem-title" style="margin-top:10rem">Wallets and on-chain identities can no longer be trusted.</h2>

        <!-- ── Features (full-screen panels) ──────────────────────────────────────── -->
        <section class="feat-screen">
          <div class="feat-left">
            <div class="feat-tag">SCAN</div>
            <h2 class="feat-title">Human or AI?</h2>
            <p class="feat-body">Paste an EVM address, Solana address, or Web3 domain name. AI returns verdict instantly.</p>
            <button class="feat-cta" @click="showSection('checker')">Try the Scanner →</button>
          </div>
          <div class="feat-right">
            <svg class="feat-svg" viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Card background -->
              <rect x="10" y="10" width="400" height="300" rx="14" fill="#090909" stroke="#1a1a1a"/>
              <!-- Input bar -->
              <rect x="28" y="30" width="310" height="36" rx="7" fill="#111" stroke="#222"/>
              <text x="42" y="53" fill="#808080" font-size="11" font-family="monospace">6bvB3PTz48wozyPJeuTB77axexWu9MfU...</text>
              <rect x="346" y="30" width="52" height="36" rx="7" fill="#161616" stroke="#222"/>
              <text x="355" y="53" fill="#666" font-size="11" font-family="monospace">Scan</text>
              <!-- Divider -->
              <line x1="28" y1="80" x2="392" y2="80" stroke="#161616"/>
              <!-- Method rows — animated in sequence -->
              <g class="scan-row-1">
                <rect x="28" y="90" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="104" r="4" fill="#22c55e"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.4s" fill="freeze"/></circle>
                <text x="54" y="108" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.4s" fill="freeze"/>SOL balance &gt; 0.01</text>
                <text x="346" y="108" fill="#22c55e" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.4s" fill="freeze"/>✓</text>
              </g>
              <g class="scan-row-2">
                <rect x="28" y="122" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="136" r="4" fill="#22c55e"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.75s" fill="freeze"/></circle>
                <text x="54" y="140" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.75s" fill="freeze"/>SNS name registered</text>
                <text x="346" y="140" fill="#22c55e" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.75s" fill="freeze"/>✓</text>
              </g>
              <g>
                <rect x="28" y="154" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="168" r="4" fill="#ef4444"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.05s" fill="freeze"/></circle>
                <text x="54" y="172" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.05s" fill="freeze"/>Farcaster profile</text>
                <text x="340" y="172" fill="#ef4444" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.05s" fill="freeze"/>✗</text>
              </g>
              <g>
                <rect x="28" y="186" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="200" r="4" fill="#22c55e"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.35s" fill="freeze"/></circle>
                <text x="54" y="204" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.35s" fill="freeze"/>Galxe identity</text>
                <text x="346" y="204" fill="#22c55e" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.35s" fill="freeze"/>✓</text>
              </g>
              <g>
                <rect x="28" y="218" width="364" height="28" rx="5" fill="#0d0d0d"/>
                <circle cx="42" cy="232" r="4" fill="#22c55e"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.6s" fill="freeze"/></circle>
                <text x="54" y="236" fill="#808080" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.6s" fill="freeze"/>Artrade tokenised real-world art marketplace...</text>
                <text x="346" y="236" fill="#22c55e" font-size="10" font-family="monospace"><animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.6s" fill="freeze"/>✓</text>
              </g>
              <!-- Verdict badge -->
              <rect x="28" y="260" width="364" height="38" rx="8" fill="#0f1f0f" stroke="#1a4a1a">
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2s" fill="freeze"/>
                <animate attributeName="stroke" values="#111;#22c55e;#1a4a1a" dur="0.6s" begin="2s" fill="freeze"/>
              </rect>
              <text x="115" y="284" fill="#22c55e" font-size="13" font-weight="600" font-family="monospace">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.1s" fill="freeze"/>
                HUMAN · 87% confidence
              </text>
            </svg>
          </div>
        </section>

        <h2 class="problem-title">POH verifies humanity through evidence<br> — not promises.</h2>

        <section class="feat-screen feat-screen--alt">
          <div class="feat-right display-block">
            
            <div>
              <h2 class="net-subtitle">
                {{ votingList.length || '—' }} signals are live.
              </h2>
            </div>

            <BrainGraph :methods="votingList" />

            <div class="net-legend">
              <!-- <div class="net-legend-group">
                <div class="nl-item"><span class="nl-dot nl-dot--evm"></span>EVM</div>
                <div class="nl-item"><span class="nl-dot nl-dot--solana"></span>Solana</div>
                <div class="nl-item"><span class="nl-dot nl-dot--rest"></span>REST</div>
              </div> -->
              <div class="nl-sep"></div>
              <div class="net-legend-group">
                <div class="nl-item"><span class="nl-dot nl-dot--evm"></span>EVM</div>
                <div class="nl-item"><span class="nl-dot nl-dot--solana"></span>Solana</div>
                <div class="nl-item"><span class="nl-dot nl-dot--rest"></span>REST</div>
              </div>
            </div>
          </div>
          <div class="feat-left">
            <div class="feat-tag">SIGNALS</div>
            <h2 class="feat-title">Evidence from<br>every layer</h2>
            <p class="feat-body">Every signal runs in parallel. No single point of failure.</p>
            <button class="feat-cta" @click="showSection('votes'); loadVoting()">Browse Methods →</button>
          </div>
        </section>

        <h2 class="problem-title">Use Cases</h2>

        <!-- Benefit section -->
        <section class="benefit-section">
          <div class="benefit-header">
          </div>
          <div class="benefit-cards">
            <!-- Trading volume: animated candlestick chart -->
            <div class="benefit-card">
              <svg class="benefit-svg" viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="240" height="200" rx="12" fill="#090909" stroke="#1a1a1a"/>
                <!-- grid lines -->
                <line x1="20" y1="40"  x2="220" y2="40"  stroke="#1a1a1a" stroke-width="1"/>
                <line x1="20" y1="80"  x2="220" y2="80"  stroke="#1a1a1a" stroke-width="1"/>
                <line x1="20" y1="120" x2="220" y2="120" stroke="#1a1a1a" stroke-width="1"/>
                <line x1="20" y1="160" x2="220" y2="160" stroke="#1a1a1a" stroke-width="1"/>
                <!-- label -->
                <!-- candle 1 — bot wash trade (red) -->
                <line x1="48"  y1="55"  x2="48"  y2="45"  stroke="#ef4444" stroke-width="1.5">
                  <animate attributeName="y1" values="100;55" dur="0.4s" begin="0.2s" fill="freeze"/>
                  <animate attributeName="y2" values="100;45" dur="0.4s" begin="0.2s" fill="freeze"/>
                </line>
                <rect x="40" y="60" width="16" height="35" rx="1" fill="#1a0808" stroke="#ef4444" stroke-width="1.2">
                  <animate attributeName="y" values="95;60" dur="0.4s" begin="0.2s" fill="freeze"/>
                  <animate attributeName="height" values="0;35" dur="0.4s" begin="0.2s" fill="freeze"/>
                </rect>
                <line x1="48"  y1="95"  x2="48"  y2="108" stroke="#ef4444" stroke-width="1.5">
                  <animate attributeName="y1" values="100;95"  dur="0.2s" begin="0.5s" fill="freeze"/>
                  <animate attributeName="y2" values="100;108" dur="0.2s" begin="0.5s" fill="freeze"/>
                </line>
                <!-- candle 2 — bot (red) -->
                <line x1="80" y1="50" x2="80" y2="42" stroke="#ef4444" stroke-width="1.5">
                  <animate attributeName="y1" values="100;50" dur="0.4s" begin="0.45s" fill="freeze"/>
                  <animate attributeName="y2" values="100;42" dur="0.4s" begin="0.45s" fill="freeze"/>
                </line>
                <rect x="72" y="55" width="16" height="40" rx="1" fill="#1a0808" stroke="#ef4444" stroke-width="1.2">
                  <animate attributeName="y" values="95;55" dur="0.4s" begin="0.45s" fill="freeze"/>
                  <animate attributeName="height" values="0;40" dur="0.4s" begin="0.45s" fill="freeze"/>
                </rect>
                <line x1="80" y1="95" x2="80" y2="110" stroke="#ef4444" stroke-width="1.5">
                  <animate attributeName="y1" values="100;95"  dur="0.2s" begin="0.75s" fill="freeze"/>
                  <animate attributeName="y2" values="100;110" dur="0.2s" begin="0.75s" fill="freeze"/>
                </line>
                <!-- candle 3 — real (green) -->
                <line x1="112" y1="72" x2="112" y2="58" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;72" dur="0.4s" begin="0.7s" fill="freeze"/>
                  <animate attributeName="y2" values="100;58" dur="0.4s" begin="0.7s" fill="freeze"/>
                </line>
                <rect x="104" y="76" width="16" height="28" rx="1" fill="#0d1a0d" stroke="#22c55e" stroke-width="1.2">
                  <animate attributeName="y" values="100;76" dur="0.4s" begin="0.7s" fill="freeze"/>
                  <animate attributeName="height" values="0;28" dur="0.4s" begin="0.7s" fill="freeze"/>
                </rect>
                <line x1="112" y1="104" x2="112" y2="115" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;104" dur="0.2s" begin="0.9s" fill="freeze"/>
                  <animate attributeName="y2" values="100;115" dur="0.2s" begin="0.9s" fill="freeze"/>
                </line>
                <!-- candle 4 — real (green) -->
                <line x1="144" y1="65" x2="144" y2="52" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;65" dur="0.4s" begin="0.9s" fill="freeze"/>
                  <animate attributeName="y2" values="100;52" dur="0.4s" begin="0.9s" fill="freeze"/>
                </line>
                <rect x="136" y="70" width="16" height="32" rx="1" fill="#0d1a0d" stroke="#22c55e" stroke-width="1.2">
                  <animate attributeName="y" values="100;70" dur="0.4s" begin="0.9s" fill="freeze"/>
                  <animate attributeName="height" values="0;32" dur="0.4s" begin="0.9s" fill="freeze"/>
                </rect>
                <line x1="144" y1="102" x2="144" y2="112" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;102" dur="0.2s" begin="1.1s" fill="freeze"/>
                  <animate attributeName="y2" values="100;112" dur="0.2s" begin="1.1s" fill="freeze"/>
                </line>
                <!-- candle 5 — real (green) -->
                <line x1="176" y1="58" x2="176" y2="46" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;58" dur="0.4s" begin="1.1s" fill="freeze"/>
                  <animate attributeName="y2" values="100;46" dur="0.4s" begin="1.1s" fill="freeze"/>
                </line>
                <rect x="168" y="62" width="16" height="38" rx="1" fill="#0d1a0d" stroke="#22c55e" stroke-width="1.2">
                  <animate attributeName="y" values="100;62" dur="0.4s" begin="1.1s" fill="freeze"/>
                  <animate attributeName="height" values="0;38" dur="0.4s" begin="1.1s" fill="freeze"/>
                </rect>
                <line x1="176" y1="100" x2="176" y2="115" stroke="#22c55e" stroke-width="1.5">
                  <animate attributeName="y1" values="100;100" dur="0.2s" begin="1.3s" fill="freeze"/>
                  <animate attributeName="y2" values="100;115" dur="0.2s" begin="1.3s" fill="freeze"/>
                </line>
                <!-- scan line sweep -->
                <line x1="20" y1="30" x2="20" y2="165" stroke="#22c55e44" stroke-width="1">
                  <animate attributeName="x1" values="20;220;220" dur="2s" begin="0s" repeatCount="indefinite"/>
                  <animate attributeName="x2" values="20;220;220" dur="2s" begin="0s" repeatCount="indefinite"/>
                </line>
                <!-- bot label -->
                <text x="32" y="140" fill="#ef444480" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>BOT</text>
                <text x="64" y="140" fill="#ef444480" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.9s" fill="freeze"/>BOT</text>
                <text x="98" y="140" fill="#22c55e80" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.1s" fill="freeze"/>REAL</text>
                <text x="130" y="140" fill="#22c55e80" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.2s" fill="freeze"/>REAL</text>
                <text x="162" y="140" fill="#22c55e80" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.3s" fill="freeze"/>REAL</text>
                <!-- baseline -->
                <line x1="20" y1="160" x2="220" y2="160" stroke="#333" stroke-width="1"/>
              </svg>
              <p class="benefit-label">Detect Fake and real<br>Trading Volume</p>
            </div>

            <!-- Bot/Human classification: scanning fingerprint -->
            <div class="benefit-card">
              <svg class="benefit-svg" viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="240" height="200" rx="12" fill="#090909" stroke="#1a1a1a"/>
                <!-- left column: bot -->
                <rect x="20" y="35" width="88" height="110" rx="6" fill="#0d0d0d" stroke="#1e1e1e"/>
                <!-- robot head -->
                <rect x="44" y="50" width="40" height="30" rx="3" stroke="#ef4444" stroke-width="1.2" fill="none"/>
                <line x1="64" y1="50" x2="64" y2="44" stroke="#ef4444" stroke-width="1.2"/>
                <line x1="58" y1="44" x2="70" y2="44" stroke="#ef4444" stroke-width="1.2"/>
                <rect x="50" y="58" width="8" height="6" rx="1" stroke="#ef4444" stroke-width="1" fill="none"/>
                <rect x="70" y="58" width="8" height="6" rx="1" stroke="#ef4444" stroke-width="1" fill="none"/>
                <line x1="54" y1="72" x2="74" y2="72" stroke="#ef4444" stroke-width="1"/>
                <!-- bot label -->
                <text x="52" y="100" fill="#ef444480" font-size="8" font-family="monospace">BOT</text>
                <!-- verdict -->
                <text x="34" y="134" fill="#ef4444" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.4s" begin="1.2s" fill="freeze"/>✗ NOT HUMAN</text>

                <!-- right column: human -->
                <rect x="132" y="35" width="88" height="110" rx="6" fill="#0d1a0d" stroke="#1a3a1a"/>
                <!-- human figure -->
                <circle cx="176" cy="62" r="12" stroke="#22c55e" stroke-width="1.2" fill="none"/>
                <path d="M156 108 Q156 86 176 86 Q196 86 196 108" stroke="#22c55e" stroke-width="1.2" fill="none"/>
                <!-- human label -->
                <text x="158" y="122" fill="#22c55e80" font-size="8" font-family="monospace">HUMAN</text>
                <!-- verdict -->
                <text x="138" y="134" fill="#22c55e" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.4s" begin="1.5s" fill="freeze"/>✓ VERIFIED</text>

                <!-- scanning beam -->
                <rect x="20" y="35" width="200" height="4" rx="1" fill="#22c55e22" opacity="0">
                  <animate attributeName="opacity" values="0;1;1;0" dur="2.5s" repeatCount="indefinite"/>
                  <animate attributeName="y" values="35;145;145;35" dur="2.5s" repeatCount="indefinite"/>
                </rect>

                <!-- confidence bar -->
                <text x="20" y="163" fill="#666" font-size="7" font-family="monospace">confidence</text>
                <rect x="20" y="168" width="200" height="4" rx="2" fill="#111"/>
                <rect x="20" y="168" width="0" height="4" rx="2" fill="#22c55e">
                  <animate attributeName="width" values="0;148" dur="1s" begin="1.8s" fill="freeze"/>
                </rect>
                <text x="172" y="175" fill="#22c55e80" font-size="7" font-family="monospace" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.7s" fill="freeze"/>74%</text>
              </svg>
              <p class="benefit-label">Captcha<br>and Digital Identities</p>
            </div>

            <!-- AI portrait: wallet → signals → profile -->
            <div class="benefit-card">
              <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clip-path="url(#clip0_158_83)">
                <path d="M228 0H12C5.37258 0 0 5.37258 0 12V188C0 194.627 5.37258 200 12 200H228C234.627 200 240 194.627 240 188V12C240 5.37258 234.627 0 228 0Z" fill="#090909" stroke="#1A1A1A"/>
                <path d="M30 44H210" stroke="#1A1A1A" stroke-width="2"/>
                <path d="M30 52C34.4183 52 38 48.4183 38 44C38 39.5817 34.4183 36 30 36C25.5817 36 22 39.5817 22 44C22 48.4183 25.5817 52 30 52Z" fill="#0D1A0D" stroke="#22C55E" stroke-width="1.2"/>
                <path d="M30.6898 41.9091V47H30.0733V42.5554H30.0435L28.8006 43.3807V42.7543L30.0733 41.9091H30.6898Z" fill="#22C55E"/>
                <path d="M80 52C84.4183 52 88 48.4183 88 44C88 39.5817 84.4183 36 80 36C75.5817 36 72 39.5817 72 44C72 48.4183 75.5817 52 80 52Z" fill="#0D0D0D" stroke="#333333" stroke-width="1.2"/>
                <path d="M78.4078 47V46.5526L80.0882 44.7131C80.2855 44.4976 80.4479 44.3104 80.5755 44.1513C80.7031 43.9905 80.7975 43.8397 80.8588 43.6989C80.9218 43.5563 80.9533 43.4072 80.9533 43.2514C80.9533 43.0724 80.9102 42.9175 80.824 42.7866C80.7395 42.6557 80.6235 42.5546 80.476 42.4833C80.3285 42.4121 80.1628 42.3764 79.9789 42.3764C79.7833 42.3764 79.6126 42.417 79.4668 42.4982C79.3226 42.5778 79.2108 42.6896 79.1312 42.8338C79.0533 42.978 79.0144 43.147 79.0144 43.3409H78.4277C78.4277 43.0426 78.4965 42.7808 78.6341 42.5554C78.7716 42.33 78.9589 42.1544 79.1958 42.0284C79.4345 41.9025 79.7021 41.8395 79.9988 41.8395C80.2971 41.8395 80.5614 41.9025 80.7917 42.0284C81.0221 42.1544 81.2027 42.3242 81.3336 42.538C81.4645 42.7518 81.53 42.9896 81.53 43.2514C81.53 43.4387 81.496 43.6218 81.4281 43.8008C81.3618 43.9781 81.2458 44.1761 81.0801 44.3949C80.916 44.612 80.6882 44.8771 80.3965 45.1903L79.253 46.4134V46.4531H81.6195V47H78.4078Z" fill="#444444"/>
                <path d="M130 52C134.418 52 138 48.4183 138 44C138 39.5817 134.418 36 130 36C125.582 36 122 39.5817 122 44C122 48.4183 125.582 52 130 52Z" fill="#0D0D0D" stroke="#333333" stroke-width="1.2"/>
                <path d="M130.019 47.0696C129.691 47.0696 129.398 47.0133 129.141 46.9006C128.886 46.7879 128.683 46.6313 128.532 46.4308C128.383 46.2286 128.302 45.9941 128.289 45.7273H128.915C128.928 45.8913 128.985 46.033 129.084 46.1523C129.183 46.27 129.314 46.3612 129.474 46.4258C129.635 46.4904 129.813 46.5227 130.009 46.5227C130.227 46.5227 130.421 46.4846 130.59 46.4084C130.759 46.3321 130.892 46.2261 130.988 46.0902C131.084 45.9543 131.132 45.7969 131.132 45.6179C131.132 45.4306 131.086 45.2657 130.993 45.1232C130.9 44.979 130.764 44.8664 130.585 44.7852C130.406 44.704 130.188 44.6634 129.929 44.6634H129.521V44.1165H129.929C130.131 44.1165 130.309 44.08 130.461 44.0071C130.615 43.9342 130.735 43.8314 130.822 43.6989C130.909 43.5663 130.953 43.4105 130.953 43.2315C130.953 43.0592 130.915 42.9092 130.839 42.7816C130.763 42.654 130.655 42.5546 130.516 42.4833C130.378 42.4121 130.216 42.3764 130.029 42.3764C129.853 42.3764 129.687 42.4087 129.531 42.4734C129.377 42.5363 129.251 42.6283 129.154 42.7493C129.056 42.8686 129.003 43.0128 128.994 43.1818H128.398C128.408 42.915 128.488 42.6813 128.639 42.4808C128.79 42.2786 128.987 42.1212 129.231 42.0085C129.476 41.8958 129.745 41.8395 130.039 41.8395C130.353 41.8395 130.624 41.9033 130.849 42.0309C131.074 42.1568 131.247 42.3234 131.368 42.5305C131.489 42.7377 131.55 42.9614 131.55 43.2017C131.55 43.4884 131.474 43.7328 131.324 43.935C131.175 44.1372 130.972 44.2772 130.715 44.3551V44.3949C131.036 44.4479 131.287 44.5846 131.468 44.805C131.648 45.0238 131.739 45.2947 131.739 45.6179C131.739 45.8946 131.663 46.1432 131.513 46.3636C131.363 46.5824 131.16 46.7547 130.901 46.8807C130.643 47.0066 130.348 47.0696 130.019 47.0696Z" fill="#444444"/>
                <path d="M180 52C184.418 52 188 48.4183 188 44C188 39.5817 184.418 36 180 36C175.582 36 172 39.5817 172 44C172 48.4183 175.582 52 180 52Z" fill="#0D0D0D" stroke="#333333" stroke-width="1.2"/>
                <path d="M178.162 45.956V45.4489L180.399 41.9091H180.767V42.6946H180.519L178.828 45.3693V45.4091H181.841V45.956H178.162ZM180.558 47V45.8018V45.5657V41.9091H181.145V47H180.558Z" fill="#444444"/>
                <path d="M22.0456 59H21.5172C21.486 58.848 21.4313 58.7145 21.3532 58.5994C21.2765 58.4844 21.1827 58.3878 21.0719 58.3097C20.9625 58.2301 20.8411 58.1705 20.7076 58.1307C20.574 58.0909 20.4348 58.071 20.29 58.071C20.0257 58.071 19.7864 58.1378 19.5719 58.2713C19.3588 58.4048 19.1891 58.6016 19.0627 58.8615C18.9377 59.1214 18.8752 59.4403 18.8752 59.8182C18.8752 60.196 18.9377 60.5149 19.0627 60.7749C19.1891 61.0348 19.3588 61.2315 19.5719 61.3651C19.7864 61.4986 20.0257 61.5653 20.29 61.5653C20.4348 61.5653 20.574 61.5455 20.7076 61.5057C20.8411 61.4659 20.9625 61.407 21.0719 61.3288C21.1827 61.2493 21.2765 61.152 21.3532 61.0369C21.4313 60.9205 21.486 60.7869 21.5172 60.6364H22.0456C22.0059 60.8594 21.9334 61.0589 21.8283 61.2351C21.7232 61.4112 21.5925 61.5611 21.4363 61.6847C21.28 61.8068 21.1046 61.8999 20.91 61.9638C20.7168 62.0277 20.5101 62.0597 20.29 62.0597C19.9178 62.0597 19.5868 61.9688 19.2971 61.7869C19.0073 61.6051 18.7793 61.3466 18.6131 61.0114C18.4469 60.6761 18.3638 60.2784 18.3638 59.8182C18.3638 59.358 18.4469 58.9602 18.6131 58.625C18.7793 58.2898 19.0073 58.0312 19.2971 57.8494C19.5868 57.6676 19.9178 57.5767 20.29 57.5767C20.5101 57.5767 20.7168 57.6087 20.91 57.6726C21.1046 57.7365 21.28 57.8303 21.4363 57.9538C21.5925 58.076 21.7232 58.2251 21.8283 58.4013C21.9334 58.576 22.0059 58.7756 22.0456 59ZM24.1609 62.0682C23.8654 62.0682 23.6062 61.9979 23.3832 61.8572C23.1616 61.7166 22.9883 61.5199 22.8633 61.267C22.7397 61.0142 22.6779 60.7187 22.6779 60.3807C22.6779 60.0398 22.7397 59.7422 22.8633 59.4879C22.9883 59.2337 23.1616 59.0362 23.3832 58.8956C23.6062 58.755 23.8654 58.6847 24.1609 58.6847C24.4563 58.6847 24.7148 58.755 24.9364 58.8956C25.1594 59.0362 25.3327 59.2337 25.4563 59.4879C25.5813 59.7422 25.6438 60.0398 25.6438 60.3807C25.6438 60.7187 25.5813 61.0142 25.4563 61.267C25.3327 61.5199 25.1594 61.7166 24.9364 61.8572C24.7148 61.9979 24.4563 62.0682 24.1609 62.0682ZM24.1609 61.6165C24.3853 61.6165 24.57 61.5589 24.7148 61.4439C24.8597 61.3288 24.967 61.1776 25.0366 60.9901C25.1062 60.8026 25.141 60.5994 25.141 60.3807C25.141 60.1619 25.1062 59.9581 25.0366 59.7692C24.967 59.5803 24.8597 59.4276 24.7148 59.3111C24.57 59.1946 24.3853 59.1364 24.1609 59.1364C23.9364 59.1364 23.7518 59.1946 23.6069 59.3111C23.462 59.4276 23.3548 59.5803 23.2852 59.7692C23.2156 59.9581 23.1808 60.1619 23.1808 60.3807C23.1808 60.5994 23.2156 60.8026 23.2852 60.9901C23.3548 61.1776 23.462 61.3288 23.6069 61.4439C23.7518 61.5589 23.9364 61.6165 24.1609 61.6165ZM26.9142 60.0312V62H26.4114V58.7273H26.8972V59.2386H26.9398C27.0165 59.0724 27.133 58.9389 27.2892 58.8381C27.4455 58.7358 27.6472 58.6847 27.8944 58.6847C28.1159 58.6847 28.3098 58.7301 28.476 58.821C28.6422 58.9105 28.7715 59.0469 28.8638 59.2301C28.9561 59.4119 29.0023 59.642 29.0023 59.9205V62H28.4995V59.9545C28.4995 59.6974 28.4327 59.4972 28.2992 59.3537C28.1657 59.2088 27.9824 59.1364 27.7495 59.1364C27.589 59.1364 27.4455 59.1712 27.3191 59.2408C27.1941 59.3104 27.0953 59.4119 27.0229 59.5455C26.9505 59.679 26.9142 59.8409 26.9142 60.0312ZM30.424 60.0312V62H29.9212V58.7273H30.407V59.2386H30.4496C30.5263 59.0724 30.6428 58.9389 30.799 58.8381C30.9553 58.7358 31.157 58.6847 31.4041 58.6847C31.6257 58.6847 31.8196 58.7301 31.9858 58.821C32.152 58.9105 32.2813 59.0469 32.3736 59.2301C32.4659 59.4119 32.5121 59.642 32.5121 59.9205V62H32.0092V59.9545C32.0092 59.6974 31.9425 59.4972 31.8089 59.3537C31.6754 59.2088 31.4922 59.1364 31.2592 59.1364C31.0987 59.1364 30.9553 59.1712 30.8288 59.2408C30.7038 59.3104 30.6051 59.4119 30.5327 59.5455C30.4602 59.679 30.424 59.8409 30.424 60.0312ZM34.8031 62.0682C34.4877 62.0682 34.2157 61.9986 33.987 61.8594C33.7598 61.7188 33.5843 61.5227 33.4608 61.2713C33.3386 61.0185 33.2775 60.7244 33.2775 60.3892C33.2775 60.054 33.3386 59.7585 33.4608 59.5028C33.5843 59.2457 33.7562 59.0455 33.9764 58.902C34.198 58.7571 34.4565 58.6847 34.752 58.6847C34.9224 58.6847 35.0907 58.7131 35.2569 58.7699C35.4231 58.8267 35.5744 58.919 35.7108 59.0469C35.8471 59.1733 35.9558 59.3409 36.0368 59.5497C36.1177 59.7585 36.1582 60.0156 36.1582 60.321V60.5341H33.6355V60.0994H35.6468C35.6468 59.9148 35.6099 59.75 35.536 59.6051C35.4636 59.4602 35.3599 59.3459 35.225 59.2621C35.0914 59.1783 34.9338 59.1364 34.752 59.1364C34.5517 59.1364 34.3784 59.1861 34.2321 59.2855C34.0872 59.3835 33.9757 59.5114 33.8975 59.669C33.8194 59.8267 33.7804 59.9957 33.7804 60.1761V60.4659C33.7804 60.7131 33.823 60.9226 33.9082 61.0945C33.9949 61.2649 34.1149 61.3949 34.2683 61.4844C34.4217 61.5724 34.6 61.6165 34.8031 61.6165C34.9352 61.6165 35.0545 61.598 35.161 61.5611C35.269 61.5227 35.362 61.4659 35.4402 61.3906C35.5183 61.3139 35.5787 61.2187 35.6213 61.1051L36.1071 61.2415C36.0559 61.4062 35.97 61.5511 35.8493 61.6761C35.7285 61.7997 35.5794 61.8963 35.4018 61.9659C35.2243 62.0341 35.0247 62.0682 34.8031 62.0682ZM38.2527 62.0682C37.9458 62.0682 37.6816 61.9957 37.46 61.8509C37.2385 61.706 37.068 61.5064 36.9487 61.2521C36.8294 60.9979 36.7697 60.7074 36.7697 60.3807C36.7697 60.0483 36.8308 59.755 36.9529 59.5007C37.0765 59.245 37.2484 59.0455 37.4686 58.902C37.6902 58.7571 37.9487 58.6847 38.2441 58.6847C38.4743 58.6847 38.6816 58.7273 38.8663 58.8125C39.051 58.8977 39.2022 59.017 39.3201 59.1705C39.438 59.3239 39.5112 59.5028 39.5396 59.7074H39.0368C38.9984 59.5582 38.9132 59.4261 38.7811 59.3111C38.6504 59.1946 38.4743 59.1364 38.2527 59.1364C38.0566 59.1364 37.8848 59.1875 37.737 59.2898C37.5907 59.3906 37.4764 59.5334 37.394 59.718C37.313 59.9013 37.2725 60.1165 37.2725 60.3636C37.2725 60.6165 37.3123 60.8366 37.3919 61.0241C37.4728 61.2116 37.5865 61.3572 37.7328 61.4609C37.8805 61.5646 38.0538 61.6165 38.2527 61.6165C38.3833 61.6165 38.502 61.5938 38.6085 61.5483C38.715 61.5028 38.8052 61.4375 38.8791 61.3523C38.9529 61.267 39.0055 61.1648 39.0368 61.0455H39.5396C39.5112 61.2386 39.4409 61.4126 39.3287 61.5675C39.2179 61.7209 39.0708 61.843 38.8876 61.9339C38.7058 62.0234 38.4941 62.0682 38.2527 62.0682ZM41.698 58.7273V59.1534H40.002V58.7273H41.698ZM40.4963 57.9432H40.9991V61.0625C40.9991 61.2045 41.0197 61.3111 41.0609 61.3821C41.1035 61.4517 41.1575 61.4986 41.2228 61.5227C41.2896 61.5455 41.3599 61.5568 41.4338 61.5568C41.4892 61.5568 41.5346 61.554 41.5701 61.5483C41.6056 61.5412 41.6341 61.5355 41.6554 61.5312L41.7576 61.983C41.7235 61.9957 41.676 62.0085 41.6149 62.0213C41.5538 62.0355 41.4764 62.0426 41.3826 62.0426C41.2406 62.0426 41.1014 62.0121 40.965 61.951C40.8301 61.8899 40.7179 61.7969 40.6284 61.6719C40.5403 61.5469 40.4963 61.3892 40.4963 61.1989V57.9432Z" fill="#22C55E" fill-opacity="0.376471"/>
                <path d="M72.5072 57.6364L73.8026 61.3097H73.8538L75.1492 57.6364H75.7032L74.1009 62H73.5555L71.9532 57.6364H72.5072ZM77.3822 62.0682C77.0669 62.0682 76.7948 61.9986 76.5661 61.8594C76.3389 61.7188 76.1634 61.5227 76.0399 61.2713C75.9177 61.0185 75.8566 60.7244 75.8566 60.3892C75.8566 60.054 75.9177 59.7585 76.0399 59.5028C76.1634 59.2457 76.3353 59.0455 76.5555 58.902C76.7771 58.7571 77.0356 58.6847 77.3311 58.6847C77.5015 58.6847 77.6698 58.7131 77.836 58.7699C78.0022 58.8267 78.1535 58.919 78.2899 59.0469C78.4262 59.1733 78.5349 59.3409 78.6159 59.5497C78.6968 59.7585 78.7373 60.0156 78.7373 60.321V60.5341H76.2146V60.0994H78.2259C78.2259 59.9148 78.189 59.75 78.1151 59.6051C78.0427 59.4602 77.939 59.3459 77.8041 59.2621C77.6705 59.1783 77.5129 59.1364 77.3311 59.1364C77.1308 59.1364 76.9575 59.1861 76.8112 59.2855C76.6663 59.3835 76.5548 59.5114 76.4767 59.669C76.3985 59.8267 76.3595 59.9957 76.3595 60.1761V60.4659C76.3595 60.7131 76.4021 60.9226 76.4873 61.0945C76.574 61.2649 76.694 61.3949 76.8474 61.4844C77.0008 61.5724 77.1791 61.6165 77.3822 61.6165C77.5143 61.6165 77.6336 61.598 77.7401 61.5611C77.8481 61.5227 77.9411 61.4659 78.0193 61.3906C78.0974 61.3139 78.1578 61.2187 78.2004 61.1051L78.6862 61.2415C78.635 61.4062 78.5491 61.5511 78.4284 61.6761C78.3076 61.7997 78.1585 61.8963 77.9809 61.9659C77.8034 62.0341 77.6038 62.0682 77.3822 62.0682ZM79.5022 62V58.7273H79.988V59.2216H80.0221C80.0818 59.0597 80.1897 58.9283 80.346 58.8274C80.5022 58.7266 80.6784 58.6761 80.8744 58.6761C80.9113 58.6761 80.9575 58.6768 81.0129 58.6783C81.0683 58.6797 81.1102 58.6818 81.1386 58.6847V59.196C81.1215 59.1918 81.0825 59.1854 81.0214 59.1768C80.9617 59.1669 80.8985 59.1619 80.8318 59.1619C80.6727 59.1619 80.5306 59.1953 80.4056 59.2621C80.282 59.3274 80.184 59.4183 80.1116 59.5348C80.0406 59.6499 80.0051 59.7812 80.0051 59.929V62H79.5022ZM81.7346 62V58.7273H82.2375V62H81.7346ZM81.9903 58.1818C81.8923 58.1818 81.8078 58.1484 81.7368 58.0817C81.6672 58.0149 81.6324 57.9347 81.6324 57.8409C81.6324 57.7472 81.6672 57.6669 81.7368 57.6001C81.8078 57.5334 81.8923 57.5 81.9903 57.5C82.0883 57.5 82.1721 57.5334 82.2417 57.6001C82.3128 57.6669 82.3483 57.7472 82.3483 57.8409C82.3483 57.9347 82.3128 58.0149 82.2417 58.0817C82.1721 58.1484 82.0883 58.1818 81.9903 58.1818ZM84.6159 58.7273V59.1534H82.8517V58.7273H84.6159ZM83.3801 62V58.2756C83.3801 58.0881 83.4241 57.9318 83.5122 57.8068C83.6002 57.6818 83.7146 57.5881 83.8552 57.5256C83.9958 57.4631 84.1443 57.4318 84.3005 57.4318C84.4241 57.4318 84.5249 57.4418 84.6031 57.4616C84.6812 57.4815 84.7394 57.5 84.7778 57.517L84.6329 57.9517C84.6073 57.9432 84.5718 57.9325 84.5264 57.9197C84.4823 57.907 84.4241 57.9006 84.3517 57.9006C84.1855 57.9006 84.0654 57.9425 83.9916 58.0263C83.9191 58.1101 83.8829 58.233 83.8829 58.3949V62H83.3801ZM85.6444 63.2273C85.5592 63.2273 85.4832 63.2202 85.4165 63.206C85.3497 63.1932 85.3035 63.1804 85.278 63.1676L85.4058 62.7244C85.528 62.7557 85.6359 62.767 85.7297 62.7585C85.8234 62.75 85.9065 62.7081 85.979 62.6328C86.0528 62.5589 86.1203 62.4389 86.1814 62.2727L86.2751 62.017L85.0649 58.7273H85.6104L86.5138 61.3352H86.5479L87.4513 58.7273H87.9967L86.6075 62.4773C86.545 62.6463 86.4676 62.7862 86.3753 62.897C86.2829 63.0092 86.1757 63.0923 86.0535 63.1463C85.9328 63.2003 85.7964 63.2273 85.6444 63.2273Z" fill="#666666"/>
                <path d="M122.533 62V57.6364H123.062V61.5312H125.09V62H122.533ZM127.212 62.0682C126.897 62.0682 126.625 61.9986 126.396 61.8594C126.169 61.7188 125.994 61.5227 125.87 61.2713C125.748 61.0185 125.687 60.7244 125.687 60.3892C125.687 60.054 125.748 59.7585 125.87 59.5028C125.994 59.2457 126.165 59.0455 126.386 58.902C126.607 58.7571 126.866 58.6847 127.161 58.6847C127.332 58.6847 127.5 58.7131 127.666 58.7699C127.832 58.8267 127.984 58.919 128.12 59.0469C128.256 59.1733 128.365 59.3409 128.446 59.5497C128.527 59.7585 128.567 60.0156 128.567 60.321V60.5341H126.045V60.0994H128.056C128.056 59.9148 128.019 59.75 127.945 59.6051C127.873 59.4602 127.769 59.3459 127.634 59.2621C127.501 59.1783 127.343 59.1364 127.161 59.1364C126.961 59.1364 126.788 59.1861 126.641 59.2855C126.496 59.3835 126.385 59.5114 126.307 59.669C126.229 59.8267 126.19 59.9957 126.19 60.1761V60.4659C126.19 60.7131 126.232 60.9226 126.317 61.0945C126.404 61.2649 126.524 61.3949 126.677 61.4844C126.831 61.5724 127.009 61.6165 127.212 61.6165C127.344 61.6165 127.464 61.598 127.57 61.5611C127.678 61.5227 127.771 61.4659 127.849 61.3906C127.927 61.3139 127.988 61.2187 128.03 61.1051L128.516 61.2415C128.465 61.4062 128.379 61.5511 128.258 61.6761C128.138 61.7997 127.989 61.8963 127.811 61.9659C127.633 62.0341 127.434 62.0682 127.212 62.0682ZM130.295 62.0767C130.088 62.0767 129.9 62.0376 129.731 61.9595C129.562 61.88 129.427 61.7656 129.328 61.6165C129.229 61.4659 129.179 61.2841 129.179 61.071C129.179 60.8835 129.216 60.7315 129.29 60.6151C129.364 60.4972 129.462 60.4048 129.586 60.3381C129.709 60.2713 129.846 60.2216 129.995 60.1889C130.146 60.1548 130.297 60.1278 130.449 60.108C130.648 60.0824 130.809 60.0632 130.932 60.0504C131.057 60.0362 131.148 60.0128 131.205 59.9801C131.263 59.9474 131.293 59.8906 131.293 59.8097V59.7926C131.293 59.5824 131.235 59.419 131.12 59.3026C131.006 59.1861 130.834 59.1278 130.602 59.1278C130.362 59.1278 130.174 59.1804 130.038 59.2855C129.901 59.3906 129.805 59.5028 129.75 59.6222L129.273 59.4517C129.358 59.2528 129.472 59.098 129.614 58.9872C129.757 58.875 129.913 58.7969 130.082 58.7528C130.253 58.7074 130.42 58.6847 130.585 58.6847C130.69 58.6847 130.811 58.6974 130.947 58.723C131.085 58.7472 131.218 58.7976 131.346 58.8743C131.475 58.951 131.582 59.0668 131.668 59.2216C131.753 59.3764 131.795 59.5838 131.795 59.8438V62H131.293V61.5568H131.267C131.233 61.6278 131.176 61.7038 131.097 61.7848C131.017 61.8658 130.911 61.9347 130.779 61.9915C130.647 62.0483 130.486 62.0767 130.295 62.0767ZM130.372 61.625C130.571 61.625 130.739 61.5859 130.875 61.5078C131.013 61.4297 131.116 61.3288 131.186 61.2053C131.257 61.0817 131.293 60.9517 131.293 60.8153V60.3551C131.271 60.3807 131.224 60.4041 131.152 60.4254C131.081 60.4453 130.998 60.4631 130.905 60.4787C130.812 60.4929 130.722 60.5057 130.634 60.517C130.547 60.527 130.477 60.5355 130.423 60.5426C130.293 60.5597 130.17 60.5874 130.057 60.6257C129.945 60.6626 129.854 60.7187 129.784 60.794C129.716 60.8679 129.682 60.9687 129.682 61.0966C129.682 61.2713 129.746 61.4034 129.876 61.4929C130.006 61.581 130.172 61.625 130.372 61.625ZM132.713 62V58.7273H133.199V59.2216H133.233C133.293 59.0597 133.401 58.9283 133.557 58.8274C133.713 58.7266 133.889 58.6761 134.085 58.6761C134.122 58.6761 134.168 58.6768 134.224 58.6783C134.279 58.6797 134.321 58.6818 134.35 58.6847V59.196C134.332 59.1918 134.293 59.1854 134.232 59.1768C134.173 59.1669 134.109 59.1619 134.043 59.1619C133.884 59.1619 133.742 59.1953 133.617 59.2621C133.493 59.3274 133.395 59.4183 133.323 59.5348C133.252 59.6499 133.216 59.7812 133.216 59.929V62H132.713ZM135.448 60.0312V62H134.946V58.7273H135.431V59.2386H135.474C135.551 59.0724 135.667 58.9389 135.823 58.8381C135.98 58.7358 136.181 58.6847 136.429 58.6847C136.65 58.6847 136.844 58.7301 137.01 58.821C137.176 58.9105 137.306 59.0469 137.398 59.2301C137.49 59.4119 137.536 59.642 137.536 59.9205V62H137.034V59.9545C137.034 59.6974 136.967 59.4972 136.833 59.3537C136.7 59.2088 136.517 59.1364 136.284 59.1364C136.123 59.1364 135.98 59.1712 135.853 59.2408C135.728 59.3104 135.63 59.4119 135.557 59.5455C135.485 59.679 135.448 59.8409 135.448 60.0312Z" fill="#666666"/>
                <path d="M177.802 59H177.274C177.243 58.848 177.188 58.7145 177.11 58.5994C177.033 58.4844 176.94 58.3878 176.829 58.3097C176.719 58.2301 176.598 58.1705 176.464 58.1307C176.331 58.0909 176.192 58.071 176.047 58.071C175.783 58.071 175.543 58.1378 175.329 58.2713C175.116 58.4048 174.946 58.6016 174.82 58.8615C174.695 59.1214 174.632 59.4403 174.632 59.8182C174.632 60.196 174.695 60.5149 174.82 60.7749C174.946 61.0348 175.116 61.2315 175.329 61.3651C175.543 61.4986 175.783 61.5653 176.047 61.5653C176.192 61.5653 176.331 61.5455 176.464 61.5057C176.598 61.4659 176.719 61.407 176.829 61.3288C176.94 61.2493 177.033 61.152 177.11 61.0369C177.188 60.9205 177.243 60.7869 177.274 60.6364H177.802C177.763 60.8594 177.69 61.0589 177.585 61.2351C177.48 61.4112 177.349 61.5611 177.193 61.6847C177.037 61.8068 176.861 61.8999 176.667 61.9638C176.474 62.0277 176.267 62.0597 176.047 62.0597C175.675 62.0597 175.344 61.9688 175.054 61.7869C174.764 61.6051 174.536 61.3466 174.37 61.0114C174.204 60.6761 174.121 60.2784 174.121 59.8182C174.121 59.358 174.204 58.9602 174.37 58.625C174.536 58.2898 174.764 58.0312 175.054 57.8494C175.344 57.6676 175.675 57.5767 176.047 57.5767C176.267 57.5767 176.474 57.6087 176.667 57.6726C176.861 57.7365 177.037 57.8303 177.193 57.9538C177.349 58.076 177.48 58.2251 177.585 58.4013C177.69 58.576 177.763 58.7756 177.802 59ZM179.96 62.0682C179.645 62.0682 179.373 61.9986 179.144 61.8594C178.917 61.7188 178.742 61.5227 178.618 61.2713C178.496 61.0185 178.435 60.7244 178.435 60.3892C178.435 60.054 178.496 59.7585 178.618 59.5028C178.742 59.2457 178.913 59.0455 179.134 58.902C179.355 58.7571 179.614 58.6847 179.909 58.6847C180.08 58.6847 180.248 58.7131 180.414 58.7699C180.58 58.8267 180.732 58.919 180.868 59.0469C181.004 59.1733 181.113 59.3409 181.194 59.5497C181.275 59.7585 181.315 60.0156 181.315 60.321V60.5341H178.793V60.0994H180.804C180.804 59.9148 180.767 59.75 180.693 59.6051C180.621 59.4602 180.517 59.3459 180.382 59.2621C180.249 59.1783 180.091 59.1364 179.909 59.1364C179.709 59.1364 179.536 59.1861 179.389 59.2855C179.244 59.3835 179.133 59.5114 179.055 59.669C178.977 59.8267 178.938 59.9957 178.938 60.1761V60.4659C178.938 60.7131 178.98 60.9226 179.065 61.0945C179.152 61.2649 179.272 61.3949 179.426 61.4844C179.579 61.5724 179.757 61.6165 179.96 61.6165C180.092 61.6165 180.212 61.598 180.318 61.5611C180.426 61.5227 180.519 61.4659 180.597 61.3906C180.676 61.3139 180.736 61.2187 180.778 61.1051L181.264 61.2415C181.213 61.4062 181.127 61.5511 181.006 61.6761C180.886 61.7997 180.737 61.8963 180.559 61.9659C180.381 62.0341 180.182 62.0682 179.96 62.0682ZM182.08 62V58.7273H182.566V59.2216H182.6C182.66 59.0597 182.768 58.9283 182.924 58.8274C183.08 58.7266 183.256 58.6761 183.453 58.6761C183.489 58.6761 183.536 58.6768 183.591 58.6783C183.646 58.6797 183.688 58.6818 183.717 58.6847V59.196C183.7 59.1918 183.661 59.1854 183.6 59.1768C183.54 59.1669 183.477 59.1619 183.41 59.1619C183.251 59.1619 183.109 59.1953 182.984 59.2621C182.86 59.3274 182.762 59.4183 182.69 59.5348C182.619 59.6499 182.583 59.7812 182.583 59.929V62H182.08ZM185.941 58.7273V59.1534H184.245V58.7273H185.941ZM184.739 57.9432H185.242V61.0625C185.242 61.2045 185.263 61.3111 185.304 61.3821C185.347 61.4517 185.401 61.4986 185.466 61.5227C185.533 61.5455 185.603 61.5568 185.677 61.5568C185.732 61.5568 185.778 61.554 185.813 61.5483C185.849 61.5412 185.877 61.5355 185.899 61.5312L186.001 61.983C185.967 61.9957 185.919 62.0085 185.858 62.0213C185.797 62.0355 185.72 62.0426 185.626 62.0426C185.484 62.0426 185.345 62.0121 185.208 61.951C185.073 61.8899 184.961 61.7969 184.872 61.6719C184.783 61.5469 184.739 61.3892 184.739 61.1989V57.9432Z" fill="#666666"/>
                <path d="M14.5284 84V79.6364H16.0028C16.3452 79.6364 16.625 79.6982 16.8423 79.8217C17.0611 79.9439 17.223 80.1094 17.3281 80.3182C17.4332 80.527 17.4858 80.7599 17.4858 81.017C17.4858 81.2741 17.4332 81.5078 17.3281 81.718C17.2244 81.9283 17.0639 82.0959 16.8466 82.2209C16.6293 82.3445 16.3509 82.4062 16.0114 82.4062H14.9545V81.9375H15.9943C16.2287 81.9375 16.4169 81.897 16.5589 81.8161C16.701 81.7351 16.804 81.6257 16.8679 81.4879C16.9332 81.3487 16.9659 81.1918 16.9659 81.017C16.9659 80.8423 16.9332 80.6861 16.8679 80.5483C16.804 80.4105 16.7003 80.3026 16.5568 80.2244C16.4134 80.1449 16.223 80.1051 15.9858 80.1051H15.0568V84H14.5284ZM18.0707 84H17.5167L19.119 79.6364H19.6644L21.2667 84H20.7127L19.4087 80.3267H19.3746L18.0707 84ZM18.2752 82.2955H20.5082V82.7642H18.2752V82.2955ZM21.9464 84V79.6364H23.4208C23.7617 79.6364 24.0415 79.6946 24.2603 79.8111C24.479 79.9261 24.641 80.0845 24.7461 80.2862C24.8512 80.4879 24.9038 80.7173 24.9038 80.9744C24.9038 81.2315 24.8512 81.4595 24.7461 81.6584C24.641 81.8572 24.4798 82.0135 24.2624 82.1271C24.0451 82.2393 23.7674 82.2955 23.4293 82.2955H22.2362V81.8182H23.4123C23.6452 81.8182 23.8327 81.7841 23.9748 81.7159C24.1183 81.6477 24.2219 81.5511 24.2859 81.4261C24.3512 81.2997 24.3839 81.1491 24.3839 80.9744C24.3839 80.7997 24.3512 80.647 24.2859 80.5163C24.2205 80.3857 24.1161 80.2848 23.9727 80.2138C23.8292 80.1413 23.6396 80.1051 23.4038 80.1051H22.4748V84H21.9464ZM24.0004 82.0398L25.0742 84H24.4606L23.4038 82.0398H24.0004ZM25.5456 80.1051V79.6364H28.8184V80.1051H27.4462V84H26.9178V80.1051H25.5456ZM30.1623 79.6364V84H29.6339V79.6364H30.1623ZM34.7331 81H34.2047C34.1735 80.848 34.1188 80.7145 34.0407 80.5994C33.964 80.4844 33.8702 80.3878 33.7594 80.3097C33.65 80.2301 33.5286 80.1705 33.3951 80.1307C33.2615 80.0909 33.1223 80.071 32.9775 80.071C32.7132 80.071 32.4739 80.1378 32.2594 80.2713C32.0463 80.4048 31.8766 80.6016 31.7502 80.8615C31.6252 81.1214 31.5627 81.4403 31.5627 81.8182C31.5627 82.196 31.6252 82.5149 31.7502 82.7749C31.8766 83.0348 32.0463 83.2315 32.2594 83.3651C32.4739 83.4986 32.7132 83.5653 32.9775 83.5653C33.1223 83.5653 33.2615 83.5455 33.3951 83.5057C33.5286 83.4659 33.65 83.407 33.7594 83.3288C33.8702 83.2493 33.964 83.152 34.0407 83.0369C34.1188 82.9205 34.1735 82.7869 34.2047 82.6364H34.7331C34.6934 82.8594 34.6209 83.0589 34.5158 83.2351C34.4107 83.4112 34.28 83.5611 34.1238 83.6847C33.9675 83.8068 33.7921 83.8999 33.5975 83.9638C33.4043 84.0277 33.1976 84.0597 32.9775 84.0597C32.6053 84.0597 32.2743 83.9688 31.9846 83.7869C31.6948 83.6051 31.4668 83.3466 31.3006 83.0114C31.1344 82.6761 31.0513 82.2784 31.0513 81.8182C31.0513 81.358 31.1344 80.9602 31.3006 80.625C31.4668 80.2898 31.6948 80.0312 31.9846 79.8494C32.2743 79.6676 32.6053 79.5767 32.9775 79.5767C33.1976 79.5767 33.4043 79.6087 33.5975 79.6726C33.7921 79.7365 33.9675 79.8303 34.1238 79.9538C34.28 80.076 34.4107 80.2251 34.5158 80.4013C34.6209 80.576 34.6934 80.7756 34.7331 81ZM36.1154 79.6364V84H35.587V79.6364H36.1154ZM37.1749 84V79.6364H38.6493C38.9917 79.6364 39.2715 79.6982 39.4888 79.8217C39.7076 79.9439 39.8695 80.1094 39.9746 80.3182C40.0797 80.527 40.1323 80.7599 40.1323 81.017C40.1323 81.2741 40.0797 81.5078 39.9746 81.718C39.8709 81.9283 39.7104 82.0959 39.4931 82.2209C39.2757 82.3445 38.9973 82.4062 38.6578 82.4062H37.601V81.9375H38.6408C38.8752 81.9375 39.0634 81.897 39.2054 81.8161C39.3475 81.7351 39.4505 81.6257 39.5144 81.4879C39.5797 81.3487 39.6124 81.1918 39.6124 81.017C39.6124 80.8423 39.5797 80.6861 39.5144 80.5483C39.4505 80.4105 39.3468 80.3026 39.2033 80.2244C39.0598 80.1449 38.8695 80.1051 38.6323 80.1051H37.7033V84H37.1749ZM40.7172 84H40.1632L41.7654 79.6364H42.3109L43.9132 84H43.3592L42.0552 80.3267H42.0211L40.7172 84ZM40.9217 82.2955H43.1547V82.7642H40.9217V82.2955ZM48.0531 79.6364V84H47.5417L45.1639 80.5739H45.1213V84H44.5929V79.6364H45.1042L47.4906 83.071H47.5332V79.6364H48.0531ZM48.8718 80.1051V79.6364H52.1445V80.1051H50.7724V84H50.244V80.1051H48.8718ZM55.3464 80.7273C55.3208 80.5114 55.2172 80.3438 55.0353 80.2244C54.8535 80.1051 54.6305 80.0455 54.3663 80.0455C54.1731 80.0455 54.0041 80.0767 53.8592 80.1392C53.7157 80.2017 53.6035 80.2876 53.5225 80.397C53.443 80.5064 53.4032 80.6307 53.4032 80.7699C53.4032 80.8864 53.4309 80.9865 53.4863 81.0703C53.5431 81.1527 53.6156 81.2216 53.7037 81.277C53.7917 81.331 53.8841 81.3757 53.9806 81.4112C54.0772 81.4453 54.166 81.473 54.247 81.4943L54.6902 81.6136C54.8038 81.6435 54.9302 81.6847 55.0694 81.7372C55.21 81.7898 55.3443 81.8615 55.4721 81.9524C55.6014 82.0419 55.7079 82.157 55.7917 82.2976C55.8755 82.4382 55.9174 82.6108 55.9174 82.8153C55.9174 83.0511 55.8556 83.2642 55.7321 83.4545C55.6099 83.6449 55.4309 83.7962 55.1951 83.9084C54.9608 84.0206 54.676 84.0767 54.3407 84.0767C54.0282 84.0767 53.7576 84.0263 53.5289 83.9254C53.3017 83.8246 53.1227 83.6839 52.992 83.5036C52.8627 83.3232 52.7896 83.1136 52.7725 82.875H53.318C53.3322 83.0398 53.3876 83.1761 53.4842 83.2841C53.5822 83.3906 53.7058 83.4702 53.8549 83.5227C54.0055 83.5739 54.1674 83.5994 54.3407 83.5994C54.5424 83.5994 54.7235 83.5668 54.8841 83.5014C55.0446 83.4347 55.1717 83.3423 55.2654 83.2244C55.3592 83.1051 55.4061 82.9659 55.4061 82.8068C55.4061 82.6619 55.3656 82.544 55.2846 82.4531C55.2037 82.3622 55.0971 82.2884 54.965 82.2315C54.8329 82.1747 54.6902 82.125 54.5368 82.0824L53.9998 81.929C53.6589 81.831 53.389 81.6911 53.1902 81.5092C52.9913 81.3274 52.8919 81.0895 52.8919 80.7955C52.8919 80.5511 52.9579 80.3381 53.09 80.1562C53.2235 79.973 53.4025 79.831 53.627 79.7301C53.8528 79.6278 54.1049 79.5767 54.3833 79.5767C54.6646 79.5767 54.9146 79.6271 55.1333 79.728C55.3521 79.8274 55.5254 79.9638 55.6532 80.1371C55.7825 80.3104 55.8507 80.5071 55.8578 80.7273H55.3464Z" fill="#444444"/>
                <path d="M212 90H16C14.8954 90 14 90.8954 14 92V100C14 101.105 14.8954 102 16 102H212C213.105 102 214 101.105 214 100V92C214 90.8954 213.105 90 212 90Z" fill="#0D0D0D" stroke="#1A1A1A"/>
                <path d="M19.875 99.0597C19.554 99.0597 19.2805 98.9723 19.0547 98.7976C18.8288 98.6214 18.6563 98.3665 18.5369 98.0327C18.4176 97.6974 18.358 97.2926 18.358 96.8182C18.358 96.3466 18.4176 95.9439 18.5369 95.6101C18.6577 95.2749 18.831 95.0192 19.0568 94.843C19.2841 94.6655 19.5568 94.5767 19.875 94.5767C20.1932 94.5767 20.4652 94.6655 20.6911 94.843C20.9183 95.0192 21.0916 95.2749 21.2109 95.6101C21.3317 95.9439 21.392 96.3466 21.392 96.8182C21.392 97.2926 21.3324 97.6974 21.2131 98.0327C21.0938 98.3665 20.9212 98.6214 20.6953 98.7976C20.4695 98.9723 20.196 99.0597 19.875 99.0597ZM19.875 98.5909C20.1932 98.5909 20.4403 98.4375 20.6165 98.1307C20.7926 97.8239 20.8807 97.3864 20.8807 96.8182C20.8807 96.4403 20.8402 96.1186 20.7592 95.853C20.6797 95.5874 20.5646 95.3849 20.4141 95.2457C20.2649 95.1065 20.0852 95.0369 19.875 95.0369C19.5597 95.0369 19.3132 95.1925 19.1357 95.5036C18.9581 95.8132 18.8693 96.2514 18.8693 96.8182C18.8693 97.196 18.9091 97.517 18.9886 97.7812C19.0682 98.0455 19.1825 98.2464 19.3317 98.3842C19.4822 98.522 19.6634 98.5909 19.875 98.5909ZM24.767 98.2159L22.3636 95.8125L22.6875 95.4886L25.0909 97.892L24.767 98.2159ZM22.6875 98.2159L22.3636 97.892L24.767 95.4886L25.0909 95.8125L22.6875 98.2159ZM26.0545 98.1051V97.6705L27.9721 94.6364H28.2875V95.3097H28.0744L26.6255 97.6023V97.6364H29.2079V98.1051H26.0545ZM28.1085 99V97.973V97.7706V94.6364H28.6113V99H28.1085ZM31.4723 95.7273V96.1534H29.7081V95.7273H31.4723ZM30.2365 99V95.2756C30.2365 95.0881 30.2805 94.9318 30.3686 94.8068C30.4567 94.6818 30.571 94.5881 30.7116 94.5256C30.8523 94.4631 31.0007 94.4318 31.157 94.4318C31.2805 94.4318 31.3814 94.4418 31.4595 94.4616C31.5376 94.4815 31.5959 94.5 31.6342 94.517L31.4893 94.9517C31.4638 94.9432 31.4283 94.9325 31.3828 94.9197C31.3388 94.907 31.2805 94.9006 31.2081 94.9006C31.0419 94.9006 30.9219 94.9425 30.848 95.0263C30.7756 95.1101 30.7393 95.233 30.7393 95.3949V99H30.2365ZM32.1685 99V98.6165L33.6088 97.0398C33.7779 96.8551 33.9171 96.6946 34.0265 96.5582C34.1358 96.4205 34.2168 96.2912 34.2694 96.1705C34.3233 96.0483 34.3503 95.9205 34.3503 95.7869C34.3503 95.6335 34.3134 95.5007 34.2395 95.3885C34.1671 95.2763 34.0676 95.1896 33.9412 95.1286C33.8148 95.0675 33.6728 95.0369 33.5151 95.0369C33.3475 95.0369 33.2012 95.0717 33.0762 95.1413C32.9526 95.2095 32.8567 95.3054 32.7885 95.429C32.7218 95.5526 32.6884 95.6974 32.6884 95.8636H32.1855C32.1855 95.608 32.2445 95.3835 32.3624 95.1903C32.4803 94.9972 32.6408 94.8466 32.8439 94.7386C33.0485 94.6307 33.2779 94.5767 33.5321 94.5767C33.7878 94.5767 34.0144 94.6307 34.2118 94.7386C34.4093 94.8466 34.5641 94.9922 34.6763 95.1754C34.7885 95.3587 34.8446 95.5625 34.8446 95.7869C34.8446 95.9474 34.8155 96.1044 34.7573 96.2578C34.7005 96.4098 34.601 96.5795 34.459 96.767C34.3184 96.9531 34.123 97.1804 33.873 97.4489L32.8929 98.4972V98.5312H34.9213V99H32.1685ZM36.1763 99.0341C36.0712 99.0341 35.981 98.9964 35.9057 98.9212C35.8304 98.8459 35.7928 98.7557 35.7928 98.6506C35.7928 98.5455 35.8304 98.4553 35.9057 98.38C35.981 98.3047 36.0712 98.267 36.1763 98.267C36.2814 98.267 36.3716 98.3047 36.4469 98.38C36.5222 98.4553 36.5598 98.5455 36.5598 98.6506C36.5598 98.7202 36.5421 98.7841 36.5066 98.8423C36.4725 98.9006 36.4263 98.9474 36.3681 98.983C36.3113 99.017 36.2473 99.0341 36.1763 99.0341ZM37.8127 99.0341C37.7076 99.0341 37.6174 98.9964 37.5421 98.9212C37.4668 98.8459 37.4292 98.7557 37.4292 98.6506C37.4292 98.5455 37.4668 98.4553 37.5421 98.38C37.6174 98.3047 37.7076 98.267 37.8127 98.267C37.9178 98.267 38.008 98.3047 38.0833 98.38C38.1586 98.4553 38.1962 98.5455 38.1962 98.6506C38.1962 98.7202 38.1784 98.7841 38.1429 98.8423C38.1088 98.9006 38.0627 98.9474 38.0044 98.983C37.9476 99.017 37.8837 99.0341 37.8127 99.0341ZM39.449 99.0341C39.3439 99.0341 39.2537 98.9964 39.1784 98.9212C39.1032 98.8459 39.0655 98.7557 39.0655 98.6506C39.0655 98.5455 39.1032 98.4553 39.1784 98.38C39.2537 98.3047 39.3439 98.267 39.449 98.267C39.5542 98.267 39.6444 98.3047 39.7196 98.38C39.7949 98.4553 39.8326 98.5455 39.8326 98.6506C39.8326 98.7202 39.8148 98.7841 39.7793 98.8423C39.7452 98.9006 39.699 98.9474 39.6408 98.983C39.584 99.017 39.5201 99.0341 39.449 99.0341ZM45.1012 95.7273L43.891 99H43.3796L42.1694 95.7273H42.7148L43.6183 98.3352H43.6523L44.5558 95.7273H45.1012ZM47.0199 99.0682C46.7045 99.0682 46.4325 98.9986 46.2038 98.8594C45.9766 98.7188 45.8011 98.5227 45.6776 98.2713C45.5554 98.0185 45.4943 97.7244 45.4943 97.3892C45.4943 97.054 45.5554 96.7585 45.6776 96.5028C45.8011 96.2457 45.973 96.0455 46.1932 95.902C46.4148 95.7571 46.6733 95.6847 46.9688 95.6847C47.1392 95.6847 47.3075 95.7131 47.4737 95.7699C47.6399 95.8267 47.7912 95.919 47.9276 96.0469C48.0639 96.1733 48.1726 96.3409 48.2536 96.5497C48.3345 96.7585 48.375 97.0156 48.375 97.321V97.5341H45.8523V97.0994H47.8636C47.8636 96.9148 47.8267 96.75 47.7528 96.6051C47.6804 96.4602 47.5767 96.3459 47.4418 96.2621C47.3082 96.1783 47.1506 96.1364 46.9688 96.1364C46.7685 96.1364 46.5952 96.1861 46.4489 96.2855C46.304 96.3835 46.1925 96.5114 46.1143 96.669C46.0362 96.8267 45.9972 96.9957 45.9972 97.1761V97.4659C45.9972 97.7131 46.0398 97.9226 46.125 98.0945C46.2116 98.2649 46.3317 98.3949 46.4851 98.4844C46.6385 98.5724 46.8168 98.6165 47.0199 98.6165C47.152 98.6165 47.2713 98.598 47.3778 98.5611C47.4858 98.5227 47.5788 98.4659 47.657 98.3906C47.7351 98.3139 47.7955 98.2187 47.8381 98.1051L48.3239 98.2415C48.2727 98.4062 48.1868 98.5511 48.0661 98.6761C47.9453 98.7997 47.7962 98.8963 47.6186 98.9659C47.4411 99.0341 47.2415 99.0682 47.0199 99.0682ZM49.1399 99V95.7273H49.6257V96.2216H49.6598C49.7195 96.0597 49.8274 95.9283 49.9837 95.8274C50.1399 95.7266 50.3161 95.6761 50.5121 95.6761C50.549 95.6761 50.5952 95.6768 50.6506 95.6783C50.706 95.6797 50.7479 95.6818 50.7763 95.6847V96.196C50.7592 96.1918 50.7202 96.1854 50.6591 96.1768C50.5994 96.1669 50.5362 96.1619 50.4695 96.1619C50.3104 96.1619 50.1683 96.1953 50.0433 96.2621C49.9197 96.3274 49.8217 96.4183 49.7493 96.5348C49.6783 96.6499 49.6428 96.7812 49.6428 96.929V99H49.1399ZM51.3723 99V95.7273H51.8752V99H51.3723ZM51.628 95.1818C51.53 95.1818 51.4455 95.1484 51.3745 95.0817C51.3049 95.0149 51.2701 94.9347 51.2701 94.8409C51.2701 94.7472 51.3049 94.6669 51.3745 94.6001C51.4455 94.5334 51.53 94.5 51.628 94.5C51.726 94.5 51.8098 94.5334 51.8794 94.6001C51.9505 94.6669 51.986 94.7472 51.986 94.8409C51.986 94.9347 51.9505 95.0149 51.8794 95.0817C51.8098 95.1484 51.726 95.1818 51.628 95.1818ZM54.2536 95.7273V96.1534H52.4893V95.7273H54.2536ZM53.0178 99V95.2756C53.0178 95.0881 53.0618 94.9318 53.1499 94.8068C53.2379 94.6818 53.3523 94.5881 53.4929 94.5256C53.6335 94.4631 53.782 94.4318 53.9382 94.4318C54.0618 94.4318 54.1626 94.4418 54.2408 94.4616C54.3189 94.4815 54.3771 94.5 54.4155 94.517L54.2706 94.9517C54.245 94.9432 54.2095 94.9325 54.1641 94.9197C54.12 94.907 54.0618 94.9006 53.9893 94.9006C53.8232 94.9006 53.7031 94.9425 53.6293 95.0263C53.5568 95.1101 53.5206 95.233 53.5206 95.3949V99H53.0178ZM54.9583 99V95.7273H55.4611V99H54.9583ZM55.214 95.1818C55.1159 95.1818 55.0314 95.1484 54.9604 95.0817C54.8908 95.0149 54.856 94.9347 54.856 94.8409C54.856 94.7472 54.8908 94.6669 54.9604 94.6001C55.0314 94.5334 55.1159 94.5 55.214 94.5C55.312 94.5 55.3958 94.5334 55.4654 94.6001C55.5364 94.6669 55.5719 94.7472 55.5719 94.8409C55.5719 94.9347 55.5364 95.0149 55.4654 95.0817C55.3958 95.1484 55.312 95.1818 55.214 95.1818ZM57.7543 99.0682C57.4389 99.0682 57.1669 98.9986 56.9382 98.8594C56.7109 98.7188 56.5355 98.5227 56.4119 98.2713C56.2898 98.0185 56.2287 97.7244 56.2287 97.3892C56.2287 97.054 56.2898 96.7585 56.4119 96.5028C56.5355 96.2457 56.7074 96.0455 56.9276 95.902C57.1491 95.7571 57.4077 95.6847 57.7031 95.6847C57.8736 95.6847 58.0419 95.7131 58.2081 95.7699C58.3743 95.8267 58.5256 95.919 58.6619 96.0469C58.7983 96.1733 58.907 96.3409 58.9879 96.5497C59.0689 96.7585 59.1094 97.0156 59.1094 97.321V97.5341H56.5866V97.0994H58.598C58.598 96.9148 58.5611 96.75 58.4872 96.6051C58.4148 96.4602 58.3111 96.3459 58.1761 96.2621C58.0426 96.1783 57.8849 96.1364 57.7031 96.1364C57.5028 96.1364 57.3295 96.1861 57.1832 96.2855C57.0384 96.3835 56.9268 96.5114 56.8487 96.669C56.7706 96.8267 56.7315 96.9957 56.7315 97.1761V97.4659C56.7315 97.7131 56.7741 97.9226 56.8594 98.0945C56.946 98.2649 57.0661 98.3949 57.2195 98.4844C57.3729 98.5724 57.5511 98.6165 57.7543 98.6165C57.8864 98.6165 58.0057 98.598 58.1122 98.5611C58.2202 98.5227 58.3132 98.4659 58.3913 98.3906C58.4695 98.3139 58.5298 98.2187 58.5724 98.1051L59.0582 98.2415C59.0071 98.4062 58.9212 98.5511 58.8004 98.6761C58.6797 98.7997 58.5305 98.8963 58.353 98.9659C58.1754 99.0341 57.9759 99.0682 57.7543 99.0682ZM61.1101 99.0682C60.8374 99.0682 60.5966 98.9993 60.3878 98.8615C60.179 98.7223 60.0156 98.5263 59.8977 98.2734C59.7798 98.0192 59.7209 97.7188 59.7209 97.3722C59.7209 97.0284 59.7798 96.7301 59.8977 96.4773C60.0156 96.2244 60.1797 96.0291 60.3899 95.8913C60.6001 95.7536 60.843 95.6847 61.1186 95.6847C61.3317 95.6847 61.5 95.7202 61.6236 95.7912C61.7486 95.8608 61.8438 95.9403 61.9091 96.0298C61.9759 96.1179 62.0277 96.1903 62.0646 96.2472H62.1072V94.6364H62.6101V99H62.1243V98.4972H62.0646C62.0277 98.5568 61.9751 98.6321 61.907 98.723C61.8388 98.8125 61.7415 98.8928 61.6151 98.9638C61.4886 99.0334 61.3203 99.0682 61.1101 99.0682ZM61.1783 98.6165C61.38 98.6165 61.5504 98.5639 61.6896 98.4588C61.8288 98.3523 61.9347 98.2053 62.0071 98.0178C62.0795 97.8288 62.1158 97.6108 62.1158 97.3636C62.1158 97.1193 62.0803 96.9055 62.0092 96.7223C61.9382 96.5376 61.8331 96.3942 61.6939 96.2919C61.5547 96.1882 61.3828 96.1364 61.1783 96.1364C60.9652 96.1364 60.7876 96.1911 60.6456 96.3004C60.505 96.4084 60.3991 96.5554 60.3281 96.7415C60.2585 96.9261 60.2237 97.1335 60.2237 97.3636C60.2237 97.5966 60.2592 97.8082 60.3303 97.9986C60.4027 98.1875 60.5092 98.3381 60.6499 98.4503C60.7919 98.5611 60.968 98.6165 61.1783 98.6165ZM65.4759 97.0312L65.7997 96.6989L66.9247 97.8068L69.2514 95.4886L69.5838 95.821L66.9247 98.4716L65.4759 97.0312Z" fill="#666666"/>
                <path d="M212 106H16C14.8954 106 14 106.895 14 108V116C14 117.105 14.8954 118 16 118H212C213.105 118 214 117.105 214 116V108C214 106.895 213.105 106 212 106Z" fill="#0D0D0D" stroke="#1A1A1A"/>
                <path d="M19.875 115.06C19.554 115.06 19.2805 114.972 19.0547 114.798C18.8288 114.621 18.6563 114.366 18.5369 114.033C18.4176 113.697 18.358 113.293 18.358 112.818C18.358 112.347 18.4176 111.944 18.5369 111.61C18.6577 111.275 18.831 111.019 19.0568 110.843C19.2841 110.665 19.5568 110.577 19.875 110.577C20.1932 110.577 20.4652 110.665 20.6911 110.843C20.9183 111.019 21.0916 111.275 21.2109 111.61C21.3317 111.944 21.392 112.347 21.392 112.818C21.392 113.293 21.3324 113.697 21.2131 114.033C21.0938 114.366 20.9212 114.621 20.6953 114.798C20.4695 114.972 20.196 115.06 19.875 115.06ZM19.875 114.591C20.1932 114.591 20.4403 114.437 20.6165 114.131C20.7926 113.824 20.8807 113.386 20.8807 112.818C20.8807 112.44 20.8402 112.119 20.7592 111.853C20.6797 111.587 20.5646 111.385 20.4141 111.246C20.2649 111.107 20.0852 111.037 19.875 111.037C19.5597 111.037 19.3132 111.192 19.1357 111.504C18.9581 111.813 18.8693 112.251 18.8693 112.818C18.8693 113.196 18.9091 113.517 18.9886 113.781C19.0682 114.045 19.1825 114.246 19.3317 114.384C19.4822 114.522 19.6634 114.591 19.875 114.591ZM22.5852 111.727L23.3693 113.065L24.1534 111.727H24.733L23.6761 113.364L24.733 115H24.1534L23.3693 113.73L22.5852 115H22.0057L23.0455 113.364L22.0057 111.727H22.5852ZM26.4135 115.077C26.2061 115.077 26.0179 115.038 25.8489 114.96C25.6799 114.88 25.5456 114.766 25.4462 114.616C25.3468 114.466 25.2971 114.284 25.2971 114.071C25.2971 113.884 25.334 113.732 25.4078 113.615C25.4817 113.497 25.5804 113.405 25.704 113.338C25.8276 113.271 25.964 113.222 26.1131 113.189C26.2637 113.155 26.415 113.128 26.5669 113.108C26.7658 113.082 26.927 113.063 27.0506 113.05C27.1756 113.036 27.2665 113.013 27.3233 112.98C27.3816 112.947 27.4107 112.891 27.4107 112.81V112.793C27.4107 112.582 27.3532 112.419 27.2381 112.303C27.1245 112.186 26.9519 112.128 26.7203 112.128C26.4803 112.128 26.2921 112.18 26.1557 112.286C26.0194 112.391 25.9235 112.503 25.8681 112.622L25.3908 112.452C25.476 112.253 25.5897 112.098 25.7317 111.987C25.8752 111.875 26.0314 111.797 26.2005 111.753C26.3709 111.707 26.5385 111.685 26.7033 111.685C26.8084 111.685 26.9292 111.697 27.0655 111.723C27.2033 111.747 27.3361 111.798 27.464 111.874C27.5932 111.951 27.7005 112.067 27.7857 112.222C27.8709 112.376 27.9135 112.584 27.9135 112.844V115H27.4107V114.557H27.3851C27.351 114.628 27.2942 114.704 27.2147 114.785C27.1351 114.866 27.0293 114.935 26.8972 114.991C26.7651 115.048 26.6039 115.077 26.4135 115.077ZM26.4902 114.625C26.6891 114.625 26.8567 114.586 26.9931 114.508C27.1309 114.43 27.2346 114.329 27.3042 114.205C27.3752 114.082 27.4107 113.952 27.4107 113.815V113.355C27.3894 113.381 27.3425 113.404 27.2701 113.425C27.199 113.445 27.1167 113.463 27.0229 113.479C26.9306 113.493 26.8404 113.506 26.7523 113.517C26.6657 113.527 26.5953 113.536 26.5414 113.543C26.4107 113.56 26.2885 113.587 26.1749 113.626C26.0627 113.663 25.9718 113.719 25.9022 113.794C25.834 113.868 25.7999 113.969 25.7999 114.097C25.7999 114.271 25.8645 114.403 25.9938 114.493C26.1245 114.581 26.29 114.625 26.4902 114.625ZM30.212 110.577C30.391 110.578 30.57 110.612 30.7489 110.679C30.9279 110.746 31.0913 110.857 31.239 111.011C31.3867 111.165 31.5053 111.374 31.5948 111.64C31.6843 111.906 31.729 112.239 31.729 112.639C31.729 113.027 31.6921 113.371 31.6183 113.673C31.5458 113.972 31.4407 114.225 31.3029 114.431C31.1665 114.637 31.0004 114.793 30.8043 114.9C30.6097 115.006 30.3896 115.06 30.1438 115.06C29.8995 115.06 29.6815 115.011 29.4897 114.915C29.2994 114.817 29.1431 114.681 29.021 114.508C28.9002 114.333 28.8228 114.131 28.7887 113.901H29.3086C29.3555 114.101 29.4485 114.266 29.5877 114.397C29.7283 114.526 29.9137 114.591 30.1438 114.591C30.4805 114.591 30.7461 114.444 30.9407 114.15C31.1367 113.856 31.2347 113.44 31.2347 112.903H31.2006C31.1211 113.023 31.0266 113.126 30.9173 113.212C30.8079 113.299 30.6864 113.366 30.5529 113.413C30.4194 113.46 30.2773 113.483 30.1268 113.483C29.8768 113.483 29.6474 113.421 29.4386 113.298C29.2312 113.173 29.065 113.001 28.94 112.784C28.8164 112.565 28.7546 112.315 28.7546 112.034C28.7546 111.767 28.8143 111.523 28.9336 111.301C29.0543 111.078 29.2234 110.901 29.4407 110.768C29.6594 110.636 29.9165 110.572 30.212 110.577ZM30.212 111.045C30.033 111.045 29.8718 111.09 29.7283 111.18C29.5863 111.268 29.4734 111.387 29.3896 111.538C29.3072 111.687 29.266 111.852 29.266 112.034C29.266 112.216 29.3058 112.381 29.3853 112.531C29.4663 112.678 29.5763 112.796 29.7156 112.884C29.8562 112.971 30.016 113.014 30.195 113.014C30.3299 113.014 30.4556 112.988 30.5721 112.935C30.6886 112.881 30.7901 112.808 30.8768 112.716C30.9648 112.622 31.0337 112.516 31.0835 112.398C31.1332 112.279 31.158 112.155 31.158 112.026C31.158 111.855 31.1168 111.695 31.0344 111.546C30.9535 111.397 30.8413 111.276 30.6978 111.184C30.5558 111.092 30.3938 111.045 30.212 111.045ZM34.101 110.636V115H33.5726V111.19H33.5471L32.4817 111.898V111.361L33.5726 110.636H34.101ZM35.4732 115.034C35.3681 115.034 35.2779 114.996 35.2026 114.921C35.1273 114.846 35.0897 114.756 35.0897 114.651C35.0897 114.545 35.1273 114.455 35.2026 114.38C35.2779 114.305 35.3681 114.267 35.4732 114.267C35.5783 114.267 35.6685 114.305 35.7438 114.38C35.8191 114.455 35.8567 114.545 35.8567 114.651C35.8567 114.72 35.839 114.784 35.8034 114.842C35.7694 114.901 35.7232 114.947 35.665 114.983C35.6081 115.017 35.5442 115.034 35.4732 115.034ZM37.1096 115.034C37.0044 115.034 36.9142 114.996 36.839 114.921C36.7637 114.846 36.726 114.756 36.726 114.651C36.726 114.545 36.7637 114.455 36.839 114.38C36.9142 114.305 37.0044 114.267 37.1096 114.267C37.2147 114.267 37.3049 114.305 37.3801 114.38C37.4554 114.455 37.4931 114.545 37.4931 114.651C37.4931 114.72 37.4753 114.784 37.4398 114.842C37.4057 114.901 37.3596 114.947 37.3013 114.983C37.2445 115.017 37.1806 115.034 37.1096 115.034ZM38.7459 115.034C38.6408 115.034 38.5506 114.996 38.4753 114.921C38.4 114.846 38.3624 114.756 38.3624 114.651C38.3624 114.545 38.4 114.455 38.4753 114.38C38.5506 114.305 38.6408 114.267 38.7459 114.267C38.851 114.267 38.9412 114.305 39.0165 114.38C39.0918 114.455 39.1294 114.545 39.1294 114.651C39.1294 114.72 39.1117 114.784 39.0762 114.842C39.0421 114.901 38.9959 114.947 38.9377 114.983C38.8809 115.017 38.8169 115.034 38.7459 115.034ZM44.3981 111.727L43.1879 115H42.6765L41.4663 111.727H42.0117L42.9151 114.335H42.9492L43.8526 111.727H44.3981ZM46.3168 115.068C46.0014 115.068 45.7294 114.999 45.5007 114.859C45.2734 114.719 45.098 114.523 44.9744 114.271C44.8523 114.018 44.7912 113.724 44.7912 113.389C44.7912 113.054 44.8523 112.759 44.9744 112.503C45.098 112.246 45.2699 112.045 45.4901 111.902C45.7116 111.757 45.9702 111.685 46.2656 111.685C46.4361 111.685 46.6044 111.713 46.7706 111.77C46.9368 111.827 47.0881 111.919 47.2244 112.047C47.3608 112.173 47.4695 112.341 47.5504 112.55C47.6314 112.759 47.6719 113.016 47.6719 113.321V113.534H45.1491V113.099H47.1605C47.1605 112.915 47.1236 112.75 47.0497 112.605C46.9773 112.46 46.8736 112.346 46.7386 112.262C46.6051 112.178 46.4474 112.136 46.2656 112.136C46.0653 112.136 45.892 112.186 45.7457 112.286C45.6009 112.384 45.4893 112.511 45.4112 112.669C45.3331 112.827 45.294 112.996 45.294 113.176V113.466C45.294 113.713 45.3366 113.923 45.4219 114.094C45.5085 114.265 45.6286 114.395 45.782 114.484C45.9354 114.572 46.1136 114.616 46.3168 114.616C46.4489 114.616 46.5682 114.598 46.6747 114.561C46.7827 114.523 46.8757 114.466 46.9538 114.391C47.032 114.314 47.0923 114.219 47.1349 114.105L47.6207 114.241C47.5696 114.406 47.4837 114.551 47.3629 114.676C47.2422 114.8 47.093 114.896 46.9155 114.966C46.7379 115.034 46.5384 115.068 46.3168 115.068ZM48.4368 115V111.727H48.9226V112.222H48.9567C49.0163 112.06 49.1243 111.928 49.2805 111.827C49.4368 111.727 49.6129 111.676 49.8089 111.676C49.8459 111.676 49.892 111.677 49.9474 111.678C50.0028 111.68 50.0447 111.682 50.0732 111.685V112.196C50.0561 112.192 50.017 112.185 49.956 112.177C49.8963 112.167 49.8331 112.162 49.7663 112.162C49.6072 112.162 49.4652 112.195 49.3402 112.262C49.2166 112.327 49.1186 112.418 49.0462 112.535C48.9751 112.65 48.9396 112.781 48.9396 112.929V115H48.4368ZM50.6692 115V111.727H51.1721V115H50.6692ZM50.9249 111.182C50.8269 111.182 50.7424 111.148 50.6713 111.082C50.6017 111.015 50.5669 110.935 50.5669 110.841C50.5669 110.747 50.6017 110.667 50.6713 110.6C50.7424 110.533 50.8269 110.5 50.9249 110.5C51.0229 110.5 51.1067 110.533 51.1763 110.6C51.2473 110.667 51.2828 110.747 51.2828 110.841C51.2828 110.935 51.2473 111.015 51.1763 111.082C51.1067 111.148 51.0229 111.182 50.9249 111.182ZM53.5504 111.727V112.153H51.7862V111.727H53.5504ZM52.3146 115V111.276C52.3146 111.088 52.3587 110.932 52.4467 110.807C52.5348 110.682 52.6491 110.588 52.7898 110.526C52.9304 110.463 53.0788 110.432 53.2351 110.432C53.3587 110.432 53.4595 110.442 53.5376 110.462C53.6158 110.482 53.674 110.5 53.7124 110.517L53.5675 110.952C53.5419 110.943 53.5064 110.933 53.4609 110.92C53.4169 110.907 53.3587 110.901 53.2862 110.901C53.12 110.901 53 110.942 52.9261 111.026C52.8537 111.11 52.8175 111.233 52.8175 111.395V115H52.3146ZM54.2551 115V111.727H54.758V115H54.2551ZM54.5108 111.182C54.4128 111.182 54.3283 111.148 54.2573 111.082C54.1877 111.015 54.1529 110.935 54.1529 110.841C54.1529 110.747 54.1877 110.667 54.2573 110.6C54.3283 110.533 54.4128 110.5 54.5108 110.5C54.6088 110.5 54.6926 110.533 54.7623 110.6C54.8333 110.667 54.8688 110.747 54.8688 110.841C54.8688 110.935 54.8333 111.015 54.7623 111.082C54.6926 111.148 54.6088 111.182 54.5108 111.182ZM57.0511 115.068C56.7358 115.068 56.4638 114.999 56.2351 114.859C56.0078 114.719 55.8324 114.523 55.7088 114.271C55.5866 114.018 55.5256 113.724 55.5256 113.389C55.5256 113.054 55.5866 112.759 55.7088 112.503C55.8324 112.246 56.0043 112.045 56.2244 111.902C56.446 111.757 56.7045 111.685 57 111.685C57.1705 111.685 57.3388 111.713 57.505 111.77C57.6712 111.827 57.8224 111.919 57.9588 112.047C58.0952 112.173 58.2038 112.341 58.2848 112.55C58.3658 112.759 58.4062 113.016 58.4062 113.321V113.534H55.8835V113.099H57.8949C57.8949 112.915 57.858 112.75 57.7841 112.605C57.7116 112.46 57.608 112.346 57.473 112.262C57.3395 112.178 57.1818 112.136 57 112.136C56.7997 112.136 56.6264 112.186 56.4801 112.286C56.3352 112.384 56.2237 112.511 56.1456 112.669C56.0675 112.827 56.0284 112.996 56.0284 113.176V113.466C56.0284 113.713 56.071 113.923 56.1562 114.094C56.2429 114.265 56.3629 114.395 56.5163 114.484C56.6697 114.572 56.848 114.616 57.0511 114.616C57.1832 114.616 57.3026 114.598 57.4091 114.561C57.517 114.523 57.6101 114.466 57.6882 114.391C57.7663 114.314 57.8267 114.219 57.8693 114.105L58.3551 114.241C58.304 114.406 58.218 114.551 58.0973 114.676C57.9766 114.8 57.8274 114.896 57.6499 114.966C57.4723 115.034 57.2727 115.068 57.0511 115.068ZM60.407 115.068C60.1342 115.068 59.8935 114.999 59.6847 114.862C59.4759 114.722 59.3125 114.526 59.1946 114.273C59.0767 114.019 59.0178 113.719 59.0178 113.372C59.0178 113.028 59.0767 112.73 59.1946 112.477C59.3125 112.224 59.4766 112.029 59.6868 111.891C59.897 111.754 60.1399 111.685 60.4155 111.685C60.6286 111.685 60.7969 111.72 60.9205 111.791C61.0455 111.861 61.1406 111.94 61.206 112.03C61.2727 112.118 61.3246 112.19 61.3615 112.247H61.4041V110.636H61.907V115H61.4212V114.497H61.3615C61.3246 114.557 61.272 114.632 61.2038 114.723C61.1357 114.812 61.0384 114.893 60.9119 114.964C60.7855 115.033 60.6172 115.068 60.407 115.068ZM60.4751 114.616C60.6768 114.616 60.8473 114.564 60.9865 114.459C61.1257 114.352 61.2315 114.205 61.304 114.018C61.3764 113.829 61.4126 113.611 61.4126 113.364C61.4126 113.119 61.3771 112.906 61.3061 112.722C61.2351 112.538 61.13 112.394 60.9908 112.292C60.8516 112.188 60.6797 112.136 60.4751 112.136C60.2621 112.136 60.0845 112.191 59.9425 112.3C59.8018 112.408 59.696 112.555 59.625 112.741C59.5554 112.926 59.5206 113.134 59.5206 113.364C59.5206 113.597 59.5561 113.808 59.6271 113.999C59.6996 114.187 59.8061 114.338 59.9467 114.45C60.0888 114.561 60.2649 114.616 60.4751 114.616ZM64.7727 113.031L65.0966 112.699L66.2216 113.807L68.5483 111.489L68.8807 111.821L66.2216 114.472L64.7727 113.031Z" fill="#666666"/>
                <path d="M212 122H16C14.8954 122 14 122.895 14 124V132C14 133.105 14.8954 134 16 134H212C213.105 134 214 133.105 214 132V124C214 122.895 213.105 122 212 122Z" fill="#0D0D0D" stroke="#1A1A1A"/>
                <path d="M19.875 131.06C19.554 131.06 19.2805 130.972 19.0547 130.798C18.8288 130.621 18.6563 130.366 18.5369 130.033C18.4176 129.697 18.358 129.293 18.358 128.818C18.358 128.347 18.4176 127.944 18.5369 127.61C18.6577 127.275 18.831 127.019 19.0568 126.843C19.2841 126.665 19.5568 126.577 19.875 126.577C20.1932 126.577 20.4652 126.665 20.6911 126.843C20.9183 127.019 21.0916 127.275 21.2109 127.61C21.3317 127.944 21.392 128.347 21.392 128.818C21.392 129.293 21.3324 129.697 21.2131 130.033C21.0938 130.366 20.9212 130.621 20.6953 130.798C20.4695 130.972 20.196 131.06 19.875 131.06ZM19.875 130.591C20.1932 130.591 20.4403 130.437 20.6165 130.131C20.7926 129.824 20.8807 129.386 20.8807 128.818C20.8807 128.44 20.8402 128.119 20.7592 127.853C20.6797 127.587 20.5646 127.385 20.4141 127.246C20.2649 127.107 20.0852 127.037 19.875 127.037C19.5597 127.037 19.3132 127.192 19.1357 127.504C18.9581 127.813 18.8693 128.251 18.8693 128.818C18.8693 129.196 18.9091 129.517 18.9886 129.781C19.0682 130.045 19.1825 130.246 19.3317 130.384C19.4822 130.522 19.6634 130.591 19.875 130.591ZM24.767 130.216L22.3636 127.812L22.6875 127.489L25.0909 129.892L24.767 130.216ZM22.6875 130.216L22.3636 129.892L24.767 127.489L25.0909 127.812L22.6875 130.216ZM26.2931 131L28.2449 127.139V127.105H25.9949V126.636H28.7903V127.131L26.8471 131H26.2931ZM29.6612 131V126.636H30.1641V128.247H30.2067C30.2436 128.19 30.2947 128.118 30.3601 128.03C30.4268 127.94 30.522 127.861 30.6456 127.791C30.7706 127.72 30.9396 127.685 31.1527 127.685C31.4283 127.685 31.6712 127.754 31.8814 127.891C32.0916 128.029 32.2557 128.224 32.3736 128.477C32.4915 128.73 32.5504 129.028 32.5504 129.372C32.5504 129.719 32.4915 130.019 32.3736 130.273C32.2557 130.526 32.0923 130.722 31.8835 130.862C31.6747 130.999 31.4339 131.068 31.1612 131.068C30.951 131.068 30.7827 131.033 30.6562 130.964C30.5298 130.893 30.4325 130.812 30.3643 130.723C30.2962 130.632 30.2436 130.557 30.2067 130.497H30.147V131H29.6612ZM30.1555 129.364C30.1555 129.611 30.1918 129.829 30.2642 130.018C30.3366 130.205 30.4425 130.352 30.5817 130.459C30.7209 130.564 30.8913 130.616 31.093 130.616C31.3033 130.616 31.4787 130.561 31.6193 130.45C31.7614 130.338 31.8679 130.187 31.9389 129.999C32.0114 129.808 32.0476 129.597 32.0476 129.364C32.0476 129.134 32.0121 128.926 31.9411 128.741C31.8714 128.555 31.7656 128.408 31.6236 128.3C31.483 128.191 31.3061 128.136 31.093 128.136C30.8885 128.136 30.7166 128.188 30.5774 128.292C30.4382 128.394 30.3331 128.538 30.2621 128.722C30.1911 128.906 30.1555 129.119 30.1555 129.364ZM34.7855 131.06C34.5043 131.06 34.2536 131.011 34.0334 130.915C33.8146 130.818 33.6406 130.684 33.5114 130.512C33.3835 130.339 33.3139 130.138 33.3026 129.909H33.8395C33.8509 130.05 33.8991 130.171 33.9844 130.273C34.0696 130.374 34.1811 130.452 34.3189 130.508C34.4567 130.563 34.6094 130.591 34.777 130.591C34.9645 130.591 35.1307 130.558 35.2756 130.493C35.4205 130.428 35.5341 130.337 35.6165 130.22C35.6989 130.104 35.7401 129.969 35.7401 129.815C35.7401 129.655 35.7003 129.513 35.6207 129.391C35.5412 129.268 35.4247 129.171 35.2713 129.102C35.1179 129.032 34.9304 128.997 34.7088 128.997H34.3594V128.528H34.7088C34.8821 128.528 35.0341 128.497 35.1648 128.435C35.2969 128.372 35.3999 128.284 35.4737 128.17C35.549 128.057 35.5866 127.923 35.5866 127.77C35.5866 127.622 35.554 127.494 35.4886 127.384C35.4233 127.275 35.331 127.19 35.2116 127.129C35.0938 127.067 34.9545 127.037 34.794 127.037C34.6435 127.037 34.5014 127.065 34.3679 127.12C34.2358 127.174 34.1278 127.253 34.044 127.357C33.9602 127.459 33.9148 127.582 33.9077 127.727H33.3963C33.4048 127.499 33.4737 127.298 33.603 127.126C33.7322 126.953 33.9013 126.818 34.1101 126.722C34.3203 126.625 34.5511 126.577 34.8026 126.577C35.0724 126.577 35.304 126.631 35.4972 126.741C35.6903 126.849 35.8388 126.991 35.9425 127.169C36.0462 127.347 36.098 127.538 36.098 127.744C36.098 127.99 36.0334 128.2 35.9041 128.373C35.7763 128.546 35.6023 128.666 35.3821 128.733V128.767C35.6577 128.812 35.8729 128.93 36.0277 129.119C36.1825 129.306 36.2599 129.538 36.2599 129.815C36.2599 130.053 36.1953 130.266 36.0661 130.455C35.9382 130.642 35.7635 130.79 35.5419 130.898C35.3203 131.006 35.0682 131.06 34.7855 131.06ZM37.3716 131.034C37.2665 131.034 37.1763 130.996 37.101 130.921C37.0257 130.846 36.9881 130.756 36.9881 130.651C36.9881 130.545 37.0257 130.455 37.101 130.38C37.1763 130.305 37.2665 130.267 37.3716 130.267C37.4767 130.267 37.5669 130.305 37.6422 130.38C37.7175 130.455 37.7551 130.545 37.7551 130.651C37.7551 130.72 37.7374 130.784 37.7019 130.842C37.6678 130.901 37.6216 130.947 37.5634 130.983C37.5066 131.017 37.4426 131.034 37.3716 131.034ZM39.008 131.034C38.9029 131.034 38.8127 130.996 38.7374 130.921C38.6621 130.846 38.6245 130.756 38.6245 130.651C38.6245 130.545 38.6621 130.455 38.7374 130.38C38.8127 130.305 38.9029 130.267 39.008 130.267C39.1131 130.267 39.2033 130.305 39.2786 130.38C39.3539 130.455 39.3915 130.545 39.3915 130.651C39.3915 130.72 39.3738 130.784 39.3382 130.842C39.3042 130.901 39.258 130.947 39.1998 130.983C39.1429 131.017 39.079 131.034 39.008 131.034ZM40.6444 131.034C40.5392 131.034 40.449 130.996 40.3738 130.921C40.2985 130.846 40.2608 130.756 40.2608 130.651C40.2608 130.545 40.2985 130.455 40.3738 130.38C40.449 130.305 40.5392 130.267 40.6444 130.267C40.7495 130.267 40.8397 130.305 40.915 130.38C40.9902 130.455 41.0279 130.545 41.0279 130.651C41.0279 130.72 41.0101 130.784 40.9746 130.842C40.9405 130.901 40.8944 130.947 40.8361 130.983C40.7793 131.017 40.7154 131.034 40.6444 131.034ZM45.0778 127.727V128.153H43.3136V127.727H45.0778ZM43.842 131V127.276C43.842 127.088 43.886 126.932 43.9741 126.807C44.0621 126.682 44.1765 126.588 44.3171 126.526C44.4577 126.463 44.6062 126.432 44.7624 126.432C44.886 126.432 44.9869 126.442 45.065 126.462C45.1431 126.482 45.2013 126.5 45.2397 126.517L45.0948 126.952C45.0692 126.943 45.0337 126.933 44.9883 126.92C44.9442 126.907 44.886 126.901 44.8136 126.901C44.6474 126.901 44.5273 126.942 44.4535 127.026C44.381 127.11 44.3448 127.233 44.3448 127.395V131H43.842ZM46.2853 126.636V131H45.7825V126.636H46.2853ZM48.1694 131.077C47.962 131.077 47.7738 131.038 47.6048 130.96C47.4357 130.88 47.3015 130.766 47.2021 130.616C47.1026 130.466 47.0529 130.284 47.0529 130.071C47.0529 129.884 47.0898 129.732 47.1637 129.615C47.2376 129.497 47.3363 129.405 47.4599 129.338C47.5835 129.271 47.7198 129.222 47.869 129.189C48.0195 129.155 48.1708 129.128 48.3228 129.108C48.5217 129.082 48.6829 129.063 48.8065 129.05C48.9315 129.036 49.0224 129.013 49.0792 128.98C49.1374 128.947 49.1665 128.891 49.1665 128.81V128.793C49.1665 128.582 49.109 128.419 48.994 128.303C48.8803 128.186 48.7077 128.128 48.4762 128.128C48.2362 128.128 48.0479 128.18 47.9116 128.286C47.7752 128.391 47.6793 128.503 47.6239 128.622L47.1467 128.452C47.2319 128.253 47.3455 128.098 47.4876 127.987C47.631 127.875 47.7873 127.797 47.9563 127.753C48.1268 127.707 48.2944 127.685 48.4592 127.685C48.5643 127.685 48.685 127.697 48.8214 127.723C48.9592 127.747 49.092 127.798 49.2198 127.874C49.3491 127.951 49.4563 128.067 49.5415 128.222C49.6268 128.376 49.6694 128.584 49.6694 128.844V131H49.1665V130.557H49.141C49.1069 130.628 49.0501 130.704 48.9705 130.785C48.891 130.866 48.7852 130.935 48.6531 130.991C48.521 131.048 48.3597 131.077 48.1694 131.077ZM48.2461 130.625C48.445 130.625 48.6126 130.586 48.7489 130.508C48.8867 130.43 48.9904 130.329 49.06 130.205C49.131 130.082 49.1665 129.952 49.1665 129.815V129.355C49.1452 129.381 49.0984 129.404 49.0259 129.425C48.9549 129.445 48.8725 129.463 48.7788 129.479C48.6864 129.493 48.5962 129.506 48.5082 129.517C48.4215 129.527 48.3512 129.536 48.2972 129.543C48.1665 129.56 48.0444 129.587 47.9308 129.626C47.8185 129.663 47.7276 129.719 47.658 129.794C47.5898 129.868 47.5558 129.969 47.5558 130.097C47.5558 130.271 47.6204 130.403 47.7496 130.493C47.8803 130.581 48.0458 130.625 48.2461 130.625ZM51.9082 132.295C51.6653 132.295 51.4565 132.264 51.2818 132.202C51.1071 132.141 50.9615 132.06 50.845 131.959C50.7299 131.859 50.6383 131.753 50.5701 131.639L50.9707 131.358C51.0162 131.418 51.0737 131.486 51.1433 131.562C51.2129 131.641 51.3081 131.708 51.4288 131.765C51.551 131.823 51.7108 131.852 51.9082 131.852C52.1724 131.852 52.3904 131.788 52.5623 131.661C52.7342 131.533 52.8201 131.332 52.8201 131.06V130.395H52.7775C52.7406 130.455 52.688 130.528 52.6199 130.616C52.5531 130.703 52.4565 130.781 52.3301 130.849C52.2051 130.915 52.036 130.949 51.823 130.949C51.5588 130.949 51.3216 130.886 51.1113 130.761C50.9025 130.636 50.737 130.455 50.6149 130.216C50.4941 129.977 50.4338 129.687 50.4338 129.347C50.4338 129.011 50.4927 128.719 50.6106 128.471C50.7285 128.221 50.8926 128.028 51.1028 127.891C51.313 127.754 51.5559 127.685 51.8315 127.685C52.0446 127.685 52.2136 127.72 52.3386 127.791C52.465 127.861 52.5616 127.94 52.6284 128.03C52.6966 128.118 52.7491 128.19 52.786 128.247H52.8372V127.727H53.323V131.094C53.323 131.375 53.2591 131.604 53.1312 131.78C53.0048 131.957 52.8343 132.087 52.6199 132.17C52.4068 132.254 52.1696 132.295 51.9082 132.295ZM51.8912 130.497C52.0929 130.497 52.2633 130.451 52.4025 130.359C52.5417 130.266 52.6475 130.134 52.72 129.96C52.7924 129.787 52.8287 129.58 52.8287 129.338C52.8287 129.102 52.7931 128.894 52.7221 128.714C52.6511 128.533 52.546 128.392 52.4068 128.29C52.2676 128.187 52.0957 128.136 51.8912 128.136C51.6781 128.136 51.5005 128.19 51.3585 128.298C51.2179 128.406 51.112 128.551 51.041 128.733C50.9714 128.915 50.9366 129.116 50.9366 129.338C50.9366 129.565 50.9721 129.766 51.0431 129.941C51.1156 130.114 51.2221 130.251 51.3627 130.35C51.5048 130.448 51.6809 130.497 51.8912 130.497ZM55.5645 132.295C55.3216 132.295 55.1127 132.264 54.938 132.202C54.7633 132.141 54.6177 132.06 54.5012 131.959C54.3862 131.859 54.2946 131.753 54.2264 131.639L54.627 131.358C54.6724 131.418 54.7299 131.486 54.7995 131.562C54.8691 131.641 54.9643 131.708 55.085 131.765C55.2072 131.823 55.367 131.852 55.5645 131.852C55.8287 131.852 56.0467 131.788 56.2186 131.661C56.3904 131.533 56.4764 131.332 56.4764 131.06V130.395H56.4338C56.3968 130.455 56.3443 130.528 56.2761 130.616C56.2093 130.703 56.1127 130.781 55.9863 130.849C55.8613 130.915 55.6923 130.949 55.4792 130.949C55.215 130.949 54.9778 130.886 54.7676 130.761C54.5588 130.636 54.3933 130.455 54.2711 130.216C54.1504 129.977 54.09 129.687 54.09 129.347C54.09 129.011 54.149 128.719 54.2669 128.471C54.3848 128.221 54.5488 128.028 54.7591 127.891C54.9693 127.754 55.2122 127.685 55.4877 127.685C55.7008 127.685 55.8699 127.72 55.9949 127.791C56.1213 127.861 56.2179 127.94 56.2846 128.03C56.3528 128.118 56.4054 128.19 56.4423 128.247H56.4934V127.727H56.9792V131.094C56.9792 131.375 56.9153 131.604 56.7875 131.78C56.661 131.957 56.4906 132.087 56.2761 132.17C56.063 132.254 55.8258 132.295 55.5645 132.295ZM55.5474 130.497C55.7491 130.497 55.9196 130.451 56.0588 130.359C56.198 130.266 56.3038 130.134 56.3762 129.96C56.4487 129.787 56.4849 129.58 56.4849 129.338C56.4849 129.102 56.4494 128.894 56.3784 128.714C56.3074 128.533 56.2022 128.392 56.063 128.29C55.9238 128.187 55.752 128.136 55.5474 128.136C55.3343 128.136 55.1568 128.19 55.0147 128.298C54.8741 128.406 54.7683 128.551 54.6973 128.733C54.6277 128.915 54.5929 129.116 54.5929 129.338C54.5929 129.565 54.6284 129.766 54.6994 129.941C54.7718 130.114 54.8784 130.251 55.019 130.35C55.161 130.448 55.3372 130.497 55.5474 130.497ZM59.2718 131.068C58.9565 131.068 58.6845 130.999 58.4558 130.859C58.2285 130.719 58.0531 130.523 57.9295 130.271C57.8074 130.018 57.7463 129.724 57.7463 129.389C57.7463 129.054 57.8074 128.759 57.9295 128.503C58.0531 128.246 58.225 128.045 58.4451 127.902C58.6667 127.757 58.9252 127.685 59.2207 127.685C59.3912 127.685 59.5595 127.713 59.7257 127.77C59.8919 127.827 60.0431 127.919 60.1795 128.047C60.3159 128.173 60.4245 128.341 60.5055 128.55C60.5865 128.759 60.627 129.016 60.627 129.321V129.534H58.1042V129.099H60.1156C60.1156 128.915 60.0787 128.75 60.0048 128.605C59.9324 128.46 59.8287 128.346 59.6937 128.262C59.5602 128.178 59.4025 128.136 59.2207 128.136C59.0204 128.136 58.8471 128.186 58.7008 128.286C58.5559 128.384 58.4444 128.511 58.3663 128.669C58.2882 128.827 58.2491 128.996 58.2491 129.176V129.466C58.2491 129.713 58.2917 129.923 58.377 130.094C58.4636 130.265 58.5836 130.395 58.737 130.484C58.8904 130.572 59.0687 130.616 59.2718 130.616C59.4039 130.616 59.5233 130.598 59.6298 130.561C59.7377 130.523 59.8308 130.466 59.9089 130.391C59.987 130.314 60.0474 130.219 60.09 130.105L60.5758 130.241C60.5247 130.406 60.4387 130.551 60.318 130.676C60.1973 130.8 60.0481 130.896 59.8706 130.966C59.693 131.034 59.4934 131.068 59.2718 131.068ZM62.6277 131.068C62.3549 131.068 62.1142 130.999 61.9054 130.862C61.6966 130.722 61.5332 130.526 61.4153 130.273C61.2974 130.019 61.2385 129.719 61.2385 129.372C61.2385 129.028 61.2974 128.73 61.4153 128.477C61.5332 128.224 61.6973 128.029 61.9075 127.891C62.1177 127.754 62.3606 127.685 62.6362 127.685C62.8493 127.685 63.0176 127.72 63.1412 127.791C63.2662 127.861 63.3613 127.94 63.4267 128.03C63.4934 128.118 63.5453 128.19 63.5822 128.247H63.6248V126.636H64.1277V131H63.6419V130.497H63.5822C63.5453 130.557 63.4927 130.632 63.4245 130.723C63.3564 130.812 63.2591 130.893 63.1326 130.964C63.0062 131.033 62.8379 131.068 62.6277 131.068ZM62.6958 130.616C62.8975 130.616 63.068 130.564 63.2072 130.459C63.3464 130.352 63.4522 130.205 63.5247 130.018C63.5971 129.829 63.6333 129.611 63.6333 129.364C63.6333 129.119 63.5978 128.906 63.5268 128.722C63.4558 128.538 63.3507 128.394 63.2115 128.292C63.0723 128.188 62.9004 128.136 62.6958 128.136C62.4828 128.136 62.3052 128.191 62.1632 128.3C62.0225 128.408 61.9167 128.555 61.8457 128.741C61.7761 128.926 61.7413 129.134 61.7413 129.364C61.7413 129.597 61.7768 129.808 61.8478 129.999C61.9203 130.187 62.0268 130.338 62.1674 130.45C62.3095 130.561 62.4856 130.616 62.6958 130.616ZM67.8457 130.472L67.5133 130.139L70.1298 127.531L70.4622 127.864L67.8457 130.472ZM70.1298 130.472L67.5133 127.864L67.8457 127.531L70.4622 130.139L70.1298 130.472Z" fill="#666666"/>
                <!-- <path d="M20.527 154V153.553L22.2074 151.713C22.4046 151.498 22.567 151.31 22.6946 151.151C22.8222 150.991 22.9167 150.84 22.978 150.699C23.041 150.556 23.0724 150.407 23.0724 150.251C23.0724 150.072 23.0294 149.917 22.9432 149.787C22.8587 149.656 22.7427 149.555 22.5952 149.483C22.4477 149.412 22.282 149.376 22.098 149.376C21.9025 149.376 21.7318 149.417 21.5859 149.498C21.4418 149.578 21.3299 149.69 21.2504 149.834C21.1725 149.978 21.1335 150.147 21.1335 150.341H20.5469C20.5469 150.043 20.6156 149.781 20.7532 149.555C20.8907 149.33 21.078 149.154 21.315 149.028C21.5536 148.902 21.8213 148.839 22.1179 148.839C22.4162 148.839 22.6805 148.902 22.9109 149.028C23.1412 149.154 23.3219 149.324 23.4528 149.538C23.5837 149.752 23.6491 149.99 23.6491 150.251C23.6491 150.439 23.6152 150.622 23.5472 150.801C23.4809 150.978 23.3649 151.176 23.1992 151.395C23.0352 151.612 22.8073 151.877 22.5156 152.19L21.3722 153.413V153.453H23.7386V154H20.527ZM26.5749 148.67L24.9343 154.766H24.3974L26.038 148.67H26.5749ZM28.9806 154.07C28.6524 154.07 28.3599 154.013 28.1031 153.901C27.8479 153.788 27.6449 153.631 27.4941 153.431C27.3449 153.229 27.2637 152.994 27.2504 152.727H27.8769C27.8901 152.891 27.9465 153.033 28.0459 153.152C28.1453 153.27 28.2754 153.361 28.4362 153.426C28.5969 153.49 28.7751 153.523 28.9706 153.523C29.1894 153.523 29.3833 153.485 29.5523 153.408C29.7213 153.332 29.8539 153.226 29.95 153.09C30.0461 152.954 30.0942 152.797 30.0942 152.618C30.0942 152.431 30.0478 152.266 29.955 152.123C29.8622 151.979 29.7263 151.866 29.5473 151.785C29.3683 151.704 29.1496 151.663 28.8911 151.663H28.4834V151.116H28.8911C29.0932 151.116 29.2706 151.08 29.423 151.007C29.5771 150.934 29.6973 150.831 29.7835 150.699C29.8713 150.566 29.9152 150.411 29.9152 150.232C29.9152 150.059 29.8771 149.909 29.8009 149.782C29.7246 149.654 29.6169 149.555 29.4777 149.483C29.3402 149.412 29.1778 149.376 28.9905 149.376C28.8148 149.376 28.6491 149.409 28.4933 149.473C28.3392 149.536 28.2133 149.628 28.1155 149.749C28.0177 149.869 27.9647 150.013 27.9564 150.182H27.3598C27.3698 149.915 27.4501 149.681 27.6009 149.481C27.7517 149.279 27.949 149.121 28.1926 149.009C28.4378 148.896 28.7071 148.839 29.0004 148.839C29.3153 148.839 29.5854 148.903 29.8108 149.031C30.0362 149.157 30.2094 149.323 30.3303 149.531C30.4513 149.738 30.5118 149.961 30.5118 150.202C30.5118 150.488 30.4364 150.733 30.2856 150.935C30.1365 151.137 29.9334 151.277 29.6766 151.355V151.395C29.9981 151.448 30.2491 151.585 30.4298 151.805C30.6104 152.024 30.7007 152.295 30.7007 152.618C30.7007 152.895 30.6253 153.143 30.4745 153.364C30.3254 153.582 30.1215 153.755 29.863 153.881C29.6045 154.007 29.3103 154.07 28.9806 154.07ZM34.2828 151.703V154H33.6961V148.909H34.2828V150.778H34.3325C34.422 150.581 34.5562 150.425 34.7352 150.309C34.9158 150.191 35.1561 150.132 35.4561 150.132C35.7162 150.132 35.9441 150.184 36.1396 150.289C36.3352 150.391 36.4868 150.55 36.5945 150.763C36.7039 150.976 36.7586 151.246 36.7586 151.574V154H36.172V151.614C36.172 151.31 36.0932 151.076 35.9358 150.91C35.78 150.743 35.5638 150.659 35.287 150.659C35.0948 150.659 34.9224 150.7 34.77 150.781C34.6192 150.862 34.4999 150.981 34.412 151.136C34.3258 151.292 34.2828 151.481 34.2828 151.703ZM40.2381 152.439V150.182H40.8248V154H40.2381V153.354H40.1983C40.1088 153.548 39.9696 153.712 39.7807 153.848C39.5918 153.983 39.3532 154.05 39.0648 154.05C38.8262 154.05 38.6141 153.998 38.4284 153.893C38.2428 153.787 38.097 153.628 37.9909 153.416C37.8849 153.202 37.8319 152.933 37.8319 152.608V150.182H38.4185V152.568C38.4185 152.847 38.4964 153.069 38.6522 153.234C38.8096 153.4 39.0101 153.483 39.2537 153.483C39.3996 153.483 39.5479 153.446 39.6987 153.371C39.8511 153.297 39.9788 153.182 40.0815 153.028C40.1859 152.874 40.2381 152.678 40.2381 152.439ZM41.8992 154V150.182H42.466V150.778H42.5157C42.5953 150.575 42.7237 150.416 42.901 150.304C43.0783 150.189 43.2913 150.132 43.5399 150.132C43.7918 150.132 44.0014 150.189 44.1688 150.304C44.3378 150.416 44.4695 150.575 44.564 150.778H44.6038C44.7016 150.581 44.8482 150.425 45.0438 150.309C45.2393 150.191 45.4738 150.132 45.7472 150.132C46.0886 150.132 46.3679 150.239 46.585 150.453C46.8021 150.665 46.9106 150.996 46.9106 151.445V154H46.324V151.445C46.324 151.163 46.2469 150.962 46.0928 150.841C45.9387 150.72 45.7572 150.659 45.5484 150.659C45.2799 150.659 45.0719 150.74 44.9244 150.903C44.777 151.063 44.7032 151.267 44.7032 151.514V154H44.1066V151.385C44.1066 151.168 44.0362 150.993 43.8953 150.86C43.7545 150.726 43.573 150.659 43.3509 150.659C43.1985 150.659 43.056 150.7 42.9234 150.781C42.7925 150.862 42.6864 150.975 42.6052 151.119C42.5257 151.261 42.4859 151.426 42.4859 151.614V154H41.8992ZM49.1068 154.089C48.8648 154.089 48.6453 154.044 48.4481 153.953C48.2509 153.86 48.0943 153.727 47.9782 153.553C47.8622 153.377 47.8042 153.165 47.8042 152.916C47.8042 152.697 47.8473 152.52 47.9335 152.384C48.0197 152.247 48.1349 152.139 48.279 152.061C48.4232 151.983 48.5823 151.925 48.7563 151.887C48.932 151.847 49.1085 151.816 49.2858 151.793C49.5178 151.763 49.7059 151.74 49.8501 151.725C49.9959 151.709 50.1019 151.682 50.1682 151.643C50.2362 151.605 50.2702 151.539 50.2702 151.445V151.425C50.2702 151.179 50.203 150.989 50.0688 150.853C49.9362 150.717 49.7349 150.649 49.4648 150.649C49.1847 150.649 48.9651 150.71 48.806 150.833C48.6469 150.956 48.5351 151.087 48.4704 151.226L47.9136 151.027C48.0131 150.795 48.1456 150.614 48.3113 150.485C48.4787 150.354 48.661 150.263 48.8582 150.212C49.0571 150.159 49.2526 150.132 49.4449 150.132C49.5675 150.132 49.7084 150.147 49.8675 150.177C50.0282 150.205 50.1831 150.264 50.3323 150.353C50.4831 150.443 50.6082 150.578 50.7077 150.759C50.8071 150.939 50.8568 151.181 50.8568 151.484V154H50.2702V153.483H50.2403C50.2006 153.566 50.1343 153.654 50.0415 153.749C49.9487 153.843 49.8252 153.924 49.6711 153.99C49.517 154.056 49.3289 154.089 49.1068 154.089ZM49.1963 153.562C49.4283 153.562 49.6238 153.517 49.7829 153.426C49.9437 153.335 50.0647 153.217 50.1459 153.073C50.2287 152.929 50.2702 152.777 50.2702 152.618V152.081C50.2453 152.111 50.1906 152.138 50.1061 152.163C50.0232 152.186 49.9271 152.207 49.8177 152.225C49.71 152.242 49.6048 152.257 49.502 152.27C49.401 152.281 49.3189 152.291 49.2559 152.3C49.1035 152.32 48.961 152.352 48.8284 152.397C48.6975 152.44 48.5914 152.505 48.5102 152.593C48.4307 152.679 48.3909 152.797 48.3909 152.946C48.3909 153.15 48.4663 153.304 48.6171 153.408C48.7696 153.511 48.9626 153.562 49.1963 153.562ZM52.5142 151.703V154H51.9276V150.182H52.4943V150.778H52.544C52.6335 150.585 52.7694 150.429 52.9517 150.311C53.134 150.192 53.3693 150.132 53.6577 150.132C53.9162 150.132 54.1424 150.185 54.3363 150.291C54.5302 150.396 54.681 150.555 54.7887 150.768C54.8964 150.981 54.9503 151.249 54.9503 151.574V154H54.3636V151.614C54.3636 151.314 54.2857 151.08 54.13 150.913C53.9742 150.744 53.7604 150.659 53.4886 150.659C53.3014 150.659 53.134 150.7 52.9865 150.781C52.8407 150.862 52.7255 150.981 52.641 151.136C52.5565 151.292 52.5142 151.481 52.5142 151.703ZM58.7268 151.037L58.1998 151.186C58.1667 151.098 58.1178 151.013 58.0532 150.93C57.9902 150.846 57.904 150.776 57.7947 150.721C57.6853 150.667 57.5452 150.639 57.3746 150.639C57.1409 150.639 56.9462 150.693 56.7904 150.801C56.6363 150.907 56.5592 151.042 56.5592 151.206C56.5592 151.352 56.6122 151.467 56.7183 151.551C56.8244 151.636 56.9901 151.706 57.2155 151.763L57.7822 151.902C58.1236 151.985 58.378 152.112 58.5454 152.282C58.7127 152.451 58.7964 152.669 58.7964 152.936C58.7964 153.155 58.7335 153.35 58.6075 153.523C58.4832 153.695 58.3092 153.831 58.0855 153.93C57.8618 154.03 57.6016 154.08 57.305 154.08C56.9155 154.08 56.5932 153.995 56.338 153.826C56.0828 153.657 55.9212 153.41 55.8532 153.085L56.4101 152.946C56.4631 153.152 56.5634 153.306 56.7108 153.408C56.86 153.511 57.0547 153.562 57.295 153.562C57.5684 153.562 57.7855 153.504 57.9463 153.388C58.1087 153.271 58.1899 153.13 58.1899 152.966C58.1899 152.833 58.1435 152.722 58.0507 152.633C57.9579 152.542 57.8154 152.474 57.6231 152.429L56.9868 152.28C56.6371 152.197 56.3802 152.069 56.2162 151.895C56.0538 151.719 55.9726 151.499 55.9726 151.236C55.9726 151.02 56.0331 150.83 56.154 150.664C56.2767 150.498 56.4432 150.368 56.6537 150.274C56.8658 150.179 57.1061 150.132 57.3746 150.132C57.7524 150.132 58.049 150.215 58.2645 150.381C58.4816 150.546 58.6357 150.765 58.7268 151.037Z" fill="#22C55E" fill-opacity="0.501961"/> -->

                <!-- ── Animations injected over static Figma export ── -->

                <!-- step progress bar fill -->
                <line x1="30" y1="44" x2="30" y2="44" stroke="#22C55E" stroke-width="1.5" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.2s" begin="0.3s" fill="freeze"/>
                  <animate attributeName="x2" values="30;180" dur="1.2s" begin="0.5s" fill="freeze"/>
                </line>

                <!-- step circle glow — step 1 (already lit) -->
                <circle cx="30" cy="44" r="10" fill="none" stroke="#22C55E" stroke-width="1" opacity="0">
                  <animate attributeName="opacity" values="0;0.6;0" dur="1.8s" begin="0s" repeatCount="indefinite"/>
                  <animate attributeName="r" values="8;14;8" dur="1.8s" begin="0s" repeatCount="indefinite"/>
                </circle>

                <!-- step 2 lights up -->
                <circle cx="80" cy="44" r="8" fill="#0D1A0D" stroke="#22C55E" stroke-width="1.2" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>
                </circle>
                <!-- step 3 -->
                <circle cx="130" cy="44" r="8" fill="#0D1A0D" stroke="#22C55E" stroke-width="1.2" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.1s" fill="freeze"/>
                </circle>
                <!-- step 4 -->
                <circle cx="180" cy="44" r="8" fill="#0D1A0D" stroke="#22C55E" stroke-width="1.2" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.4s" fill="freeze"/>
                </circle>

                <!-- row 1 highlight sweep -->
                <rect x="16" y="92" width="0" height="8" rx="1" fill="#22C55E" opacity="0.12">
                  <animate attributeName="width" values="0;196" dur="0.5s" begin="1.6s" fill="freeze"/>
                  <animate attributeName="opacity" values="0;0.12" dur="0.3s" begin="1.6s" fill="freeze"/>
                </rect>
                <!-- row 2 -->
                <rect x="16" y="108" width="0" height="8" rx="1" fill="#22C55E" opacity="0.08">
                  <animate attributeName="width" values="0;196" dur="0.5s" begin="1.9s" fill="freeze"/>
                  <animate attributeName="opacity" values="0;0.08" dur="0.3s" begin="1.9s" fill="freeze"/>
                </rect>
                <!-- row 3 -->
                <rect x="16" y="124" width="0" height="8" rx="1" fill="#22C55E" opacity="0.08">
                  <animate attributeName="width" values="0;196" dur="0.5s" begin="2.2s" fill="freeze"/>
                  <animate attributeName="opacity" values="0;0.08" dur="0.3s" begin="2.2s" fill="freeze"/>
                </rect>

                <!-- vertical scan line -->
                <line x1="16" y1="80" x2="16" y2="160" stroke="#22C55E" stroke-width="0.8" opacity="0">
                  <animate attributeName="opacity" values="0;0.4;0" dur="2.5s" begin="1.5s" repeatCount="indefinite"/>
                  <animate attributeName="x1" values="16;224;224" dur="2.5s" begin="1.5s" repeatCount="indefinite"/>
                  <animate attributeName="x2" values="16;224;224" dur="2.5s" begin="1.5s" repeatCount="indefinite"/>
                </line>

                <!-- verdict badge pop in -->
                <rect x="60" y="148" width="120" height="22" rx="5" fill="#0D1A0D" stroke="#22C55E" stroke-width="0.8" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.5s" fill="freeze"/>
                </rect>
                <text x="120" y="163" fill="#22C55E" font-size="8" font-family="monospace" text-anchor="middle" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.6s" fill="freeze"/>✓ HUMAN · 87% confidence</text>

                </g>
                <defs>
                <clipPath id="clip0_158_83">
                <rect width="240" height="200" fill="white"/>
                </clipPath>
                </defs>
              </svg>
              <p class="benefit-label">AML and Whitelabel</p>
            </div>
          </div>
        </section>

        <section class="feat-screen feat-screen--alt">
          <div class="feat-right">
            <svg class="feat-svg" viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="10" width="400" height="300" rx="14" fill="#090909" stroke="#1a1a1a"/>
              <!-- Method card -->
              <rect x="28" y="28" width="364" height="160" rx="9" fill="#0d0d0d" stroke="#1e1e1e"/>
              <text x="44" y="52" fill="#666" font-size="9" font-family="monospace">METHOD #47</text>
              <text x="44" y="70" fill="#ddd" font-size="12" font-family="sans-serif">Artrade tokenised real-world art marketplace on Solana</text>
              <text x="44" y="88" fill="#808080" font-size="9" font-family="monospace">balanceOf(address) &gt; 0  ·  Ethereum</text>
              <!-- Score bar -->
              <text x="44" y="112" fill="#808080" font-size="8" font-family="monospace">community score</text>
              <rect x="44" y="118" width="220" height="5" rx="2" fill="#111"/>
              <rect x="44" y="118" width="148" height="5" rx="2" fill="#22c55e" id="score-bar"/>
              <text x="274" y="122" fill="#22c55e" font-size="8" font-family="monospace">+6.7</text>
              <!-- Vote buttons -->
              <rect x="44" y="148" width="82" height="30" rx="6" fill="#0a1f0a" stroke="#1a3a1a"/>
              <text x="66" y="168" fill="#22c55e" font-size="11" font-family="monospace">✓ Human</text>
              <rect x="134" y="148" width="74" height="30" rx="6" fill="#111" stroke="#222"/>
              <text x="149" y="168" fill="#ef4444" font-size="11" font-family="monospace">✗ Skip</text>
              <!-- Animated vote + score update -->
              <rect x="44" y="148" width="82" height="30" rx="6" fill="#22c55e" opacity="0">
                <animate attributeName="opacity" values="0;0.18;0" dur="0.6s" begin="1.8s" repeatCount="indefinite" repeatDur="6s"/>
              </rect>
              <rect x="44" y="118" width="0" height="5" rx="2" fill="#22c55e" opacity="0">
                <animate attributeName="opacity" values="0;1;1;0" dur="3s" begin="2.2s" repeatCount="indefinite" repeatDur="6s"/>
                <animate attributeName="width" values="148;164;164;148" dur="3s" begin="2.2s" repeatCount="indefinite" repeatDur="6s"/>
              </rect>
              <!-- Feedback textarea -->
              <rect x="28" y="202" width="364" height="50" rx="7" fill="#080808" stroke="#161616"/>
              <text x="44" y="224" fill="#808080" font-size="9" font-family="monospace">Interest in the real world art marketplace...</text>
              <!-- Submit row -->
              <text x="44" y="272" fill="#808080" font-size="9" font-family="monospace">342 votes cast  ·  stake weight: 1.4×</text>
              <rect x="330" y="256" width="62" height="26" rx="6" fill="#161616" stroke="#222"/>
              <text x="341" y="273" fill="#888" font-size="9" font-family="monospace">Next →</text>
            </svg>
          </div>
          <div class="feat-left">
            <div class="feat-tag">COMMUNITY</div>
            <h2 class="feat-title">You decide what<br>counts as human</h2>
            <p class="feat-body">Every detection method goes through community consensus.</p>
            <button class="feat-cta" @click="showSection('votes'); loadVoting()">Open Vote Queue →</button>
          </div>
        </section>

        <section class="feat-screen">
          <div class="feat-left">
            <div class="feat-tag">AI BRAIN</div>
            <h2 class="feat-title">On-device AI,<br>zero cloud calls</h2>
            <p class="feat-body">Structured verdict with confidence and reasoning. <br>Runs on Qvac by Tether.</p>
            <button class="feat-cta" @click="showSection('checker')">See a Verdict →</button>
          </div>
          <div class="feat-right">
            <svg class="feat-svg" viewBox="0 0 420 320" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="10" width="400" height="230" rx="14" fill="#090909" stroke="#1a1a1a"/>
              <!-- Signals in -->
              <text x="28" y="42" fill="#808080" font-size="9" font-family="monospace">SIGNALS</text>
              <rect x="28" y="52" width="140" height="22" rx="4" fill="#0d1a0d" stroke="#1a3a1a"/>
              <text x="36" y="67" fill="#22c55e" font-size="9" font-family="monospace">✓ ETH balance</text>
              <rect x="28" y="78" width="140" height="22" rx="4" fill="#0d1a0d" stroke="#1a3a1a"/>
              <text x="36" y="93" fill="#22c55e" font-size="9" font-family="monospace">✓ ENS registered</text>
              <rect x="28" y="104" width="140" height="22" rx="4" fill="#1a0d0d" stroke="#3a1a1a"/>
              <text x="36" y="119" fill="#ef4444" font-size="9" font-family="monospace">✗ Galxe profile</text>
              <rect x="28" y="130" width="140" height="22" rx="4" fill="#0d1a0d" stroke="#1a3a1a"/>
              <text x="36" y="145" fill="#22c55e" font-size="9" font-family="monospace">✓ PAXG holder</text>
              <rect x="28" y="156" width="140" height="22" rx="4" fill="#0d1a0d" stroke="#1a3a1a"/>
              <text x="36" y="171" fill="#22c55e" font-size="9" font-family="monospace">✓ Farcaster</text>
              <!-- Arrow to AI -->
              <path d="M168 130 Q210 130 210 130" stroke="#222" stroke-width="1.5" marker-end="url(#arr)"/>
              <defs>
                <marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#808080"/>
                </marker>
              </defs>
              <!-- AI node -->
              <circle cx="215" cy="130" r="0" fill="#111" stroke="#222">
                <animate attributeName="r" values="0;22" dur="0.4s" begin="0.5s" fill="freeze"/>
              </circle>
              <text x="210" y="126" fill="#fff" font-size="8" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>AI
              </text>
              <text x="199" y="138" fill="#808080" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>thinking</text>
              <!-- Thinking dots -->
              <!-- <circle cx="202" cy="148" r="2" fill="#808080" opacity="0">
                <animate attributeName="opacity" values="0;0;1;0" dur="1.2s" begin="0.9s" repeatCount="indefinite"/>
              </circle>
              <circle cx="210" cy="148" r="2" fill="#808080" opacity="0">
                <animate attributeName="opacity" values="0;0;0;1;0" dur="1.2s" begin="0.9s" repeatCount="indefinite"/>
              </circle>
              <circle cx="218" cy="148" r="2" fill="#808080" opacity="0">
                <animate attributeName="opacity" values="0;0;0;0;1;0" dur="1.2s" begin="0.9s" repeatCount="indefinite"/>
              </circle> -->
              <!-- Verdict card -->
              <rect x="250" y="72" width="148" height="120" rx="8" fill="#0f1f0f" stroke="#1a4a1a" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.2s" fill="freeze"/>
              </rect>
              <text x="264" y="96" fill="#22c55e" font-size="11" font-weight="600" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.4s" fill="freeze"/>HUMAN
              </text>
              <text x="264" y="114" fill="#808080" font-size="8" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.5s" fill="freeze"/>confidence</text>
              <!-- Confidence bar -->
              <rect x="264" y="120" width="112" height="6" rx="3" fill="#111" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.1s" begin="2.6s" fill="freeze"/>
              </rect>
              <rect x="264" y="120" width="0" height="6" rx="3" fill="#22c55e" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.1s" begin="2.6s" fill="freeze"/>
                <animate attributeName="width" values="0;87" dur="0.8s" begin="2.6s" fill="freeze"/>
              </rect>
              <text x="264" y="146" fill="#fff" font-size="7.5" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.7s" fill="freeze"/>87% · 4/5 signals pass</text>
              <text x="264" y="162" fill="#808080" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.8s" fill="freeze"/>PAXG holder is</text>
              <text x="264" y="174" fill="#808080" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="2.8s" fill="freeze"/>strongest signal.</text>
            </svg>
          </div>
        </section>

        <section class="feat-screen">
          <div class="feat-left">
            <div class="feat-tag">API</div>
            <h2 class="feat-title">One call.<br>Instant answer.</h2>
            <p class="feat-body">Drop-in HTTP API for any app. First 100 scans free.</p>
            <button class="feat-cta" @click="showSection('api')">API Reference →</button>
          </div>
          <div class="feat-right">

            <svg viewBox="0 0 240 200" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="240" height="200" rx="12" fill="#090909" stroke="#1a1a1a"/>
              <text x="20" y="22" fill="#666" font-size="8" font-family="monospace">SDK · TOOLING</text>

              <!-- request block -->
              <rect x="14" y="30" width="100" height="76" rx="5" fill="#0d0d0d" stroke="#1e1e1e"/>
              <text x="20" y="43" fill="#3b82f6" font-size="6.5" font-family="monospace">POST /checker</text>
              <text x="20" y="55" fill="#ffffff30" font-size="6" font-family="monospace">{</text>
              <text x="26" y="65" fill="#ffffff40" font-size="6" font-family="monospace">"input":</text>
              <text x="26" y="74" fill="#22c55e80" font-size="6" font-family="monospace">"0xd8dA6B…"</text>
              <text x="26" y="83" fill="#ffffff40" font-size="6" font-family="monospace">"apiKey": "…"</text>
              <text x="20" y="92" fill="#ffffff30" font-size="6" font-family="monospace">}</text>

              <!-- arrow -->
              <line x1="118" y1="68" x2="130" y2="68" stroke="#3b82f660" stroke-width="1.2" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>
              </line>
              <polygon points="130,64 136,68 130,72" fill="#3b82f660" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="0.8s" fill="freeze"/>
              </polygon>
              <!-- animated packet -->
              <circle cx="118" cy="68" r="2.5" fill="#3b82f6" opacity="0">
                <animate attributeName="opacity" values="0;1;1;0" dur="0.6s" begin="1.0s" repeatCount="indefinite"/>
                <animate attributeName="cx" values="118;134;134" dur="0.6s" begin="1.0s" repeatCount="indefinite"/>
              </circle>

              <!-- response block -->
              <rect x="136" y="30" width="90" height="76" rx="5" fill="#0d1a0d" stroke="#22c55e" stroke-width="0.8" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.2s" fill="freeze"/>
              </rect>
              <text x="142" y="43" fill="#22c55e80" font-size="6.5" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.2s" fill="freeze"/>200 OK</text>
              <text x="142" y="55" fill="#ffffff30" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.3s" fill="freeze"/>{</text>
              <text x="148" y="65" fill="#22c55e" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.4s" fill="freeze"/>"HUMAN"</text>
              <text x="148" y="74" fill="#ffffff50" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.5s" fill="freeze"/>0.87</text>
              <text x="148" y="83" fill="#ffffff30" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.6s" fill="freeze"/>9 signals</text>
              <text x="142" y="92" fill="#ffffff30" font-size="6" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.3s" begin="1.7s" fill="freeze"/>}</text>

              <!-- SDK rows -->
              <text x="14" y="124" fill="#444" font-size="6" font-family="monospace">AVAILABLE SDKs</text>

              <rect x="14" y="130" width="64" height="18" rx="3" fill="#111" stroke="#1e1e1e" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="1.8s" fill="freeze"/>
              </rect>
              <text x="24" y="142" fill="#f7df1e80" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="1.8s" fill="freeze"/>JS / TS</text>

              <rect x="84" y="130" width="64" height="18" rx="3" fill="#111" stroke="#1e1e1e" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2.0s" fill="freeze"/>
              </rect>
              <text x="97" y="142" fill="#3b82f680" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2.0s" fill="freeze"/>Python</text>

              <rect x="154" y="130" width="72" height="18" rx="3" fill="#111" stroke="#1e1e1e" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2.2s" fill="freeze"/>
              </rect>
              <text x="165" y="142" fill="#00ADD880" font-size="7" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.2s" begin="2.2s" fill="freeze"/>Go / Rust</text>

              <!-- bottom: REST note -->
              <text x="14" y="168" fill="#ffffff20" font-size="6.5" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.4s" fill="freeze"/>or raw REST — no SDK needed</text>
              <text x="14" y="180" fill="#22c55e40" font-size="6.5" font-family="monospace" opacity="0">
                <animate attributeName="opacity" values="0;1" dur="0.4s" begin="2.5s" fill="freeze"/>proofofhuman.ge</text>
            </svg>

          </div>
        </section>

        <!-- Roadmap -->
        <section class="roadmap-section">
          <div class="network-label">ROADMAP</div>
          <div class="roadmap-list">
            <div class="roadmap-item roadmap-active">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date" style="color: #fff">Apr-May 2026</div>
                <div class="roadmap-desc" style="color: #fff">Devnet public launch</div>
                <div class="roadmap-desc" style="color: #fff">Colosseum Hackathon submission</div>
                <div class="roadmap-desc" style="color: #fff">Data providers onboarding</div>
              </div>
            </div>
            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date">May-Jun 2026</div>
                <div class="roadmap-desc">Colosseum Accellerator</div>
                <div class="roadmap-desc">Human-verified proof with fully private evidence and quantum-resistant encryption</div>
                <div class="roadmap-desc">POH token launch (date TBA)</div>
              </div>
            </div>
            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date">Jun-Jul 2026</div>
                <div class="roadmap-desc">Multi-chain support across Bitcoin, Litecoin, and Tron</div>
              </div>
            </div>

            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date">Jul-Aug 2026</div>
                <div class="roadmap-desc">Trading pair analysis to identify fake liquidity and real market activity</div>
              </div>
            </div>
            
            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date">Aug-Sep 2026</div>
                <div class="roadmap-desc">Visual analytics powered by charts & behavioral data mapping</div>
              </div>
            </div>

            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date">Q4 2026</div>
                <div class="roadmap-desc">TBA</div>
              </div>
            </div>
          </div>
        </section>

      </div>

      <!-- Checker -->
      <div v-if="currentSection === 'checker'" class="scan-page">
        <div class="scan-hero">
          <div class="scan-tag">WALLET SCANNER</div>
          <h2 class="scan-title">Human or AI</h2>
          <p class="scan-sub">Run all registered detection methods simultaneously and get an AI verdict.</p>
        </div>

        <div class="scan-box">
          <div class="scan-input-row">
            <input
              type="text"
              v-model="scanInput"
              :disabled="!!batchFile"
              placeholder="0x... or wallet.sol or wallet.eth"
              class="scan-input"
              @keydown.enter="runCheck"
            />
            <label class="scan-upload" title="Upload CSV batch">
              <input type="file" @change="handleFileSelect" accept=".csv" class="hidden-input" />
              <FileUp :size="16" />
            </label>
          </div>
          <div v-if="detectedChain" class="chain-pill-row">
            <span :class="['chain-pill', `chain-pill--${detectedChain}`]">
              {{ detectedChain === 'evm' ? 'EVM — running EVM + REST methods' : 'Solana — running Solana + REST methods' }}
            </span>
          </div>
          <div v-if="resolvedInputDisplay" class="resolved-display">
            ↳ <span class="resolved-address">{{ resolvedInputDisplay }}</span>
          </div>
          <div v-if="batchFile" class="file-info">
            <span class="file-name">{{ batchFile.name }} — {{ batchRowCount }} addresses</span>
            <button @click="batchFile = null; batchRowCount = 0; batchRows = []" class="mini-btn"><Trash2 :size="12" /></button>
          </div>
          <button @click="connected ? runCheck() : showWalletModal = true" :disabled="checkerLoading || isResolving || brainPolling || batchPolling || (checkerResults && !batchFile && !brainVerdict?.reasoning)" class="submit-listing-btn">
            {{ isResolving ? 'Resolving...' : checkerLoading ? 'Scanning...' : batchPolling ? `Analyzing… (${batchProgress?.done ?? 0}/${batchProgress?.total ?? '?'})` : (brainPolling || (checkerResults && !brainVerdict?.reasoning)) ? 'AI analyzing...' : batchFile ? 'Scan Batch' : connected ? 'Scan Wallet' : 'Connect Wallet' }}
          </button>
          <div v-if="batchPolling && batchProgress" class="batch-progress-bar">
            <div class="batch-progress-fill" :style="{ width: (batchProgress.percent ?? 0) + '%' }"></div>
          </div>
        </div>

        <div v-if="checkerResults" class="results-accordion">
          <div class="evidence-header">
            <div class="accordion-dots">
              <span v-for="r in checkerResults.slice(0, 12)" :key="r.methodId"
                :class="['acc-dot', r.result ? 'pass' : 'fail']"></span>
            </div>
            <span class="evidence-title">Evidence</span>
            <span class="accordion-summary">{{ checkerResults.filter(r => r.result).length }}/{{ checkerResults.length }} passed</span>
          </div>

          <!-- Pass accordion -->
          <button class="results-accordion-header sub" @click="showEvidencePass = !showEvidencePass">
            <div class="accordion-left">
              <div class="result-dot pass"></div>
              <span class="accordion-summary">Pass ({{ checkerResults.filter(r => r.result).length }})</span>
            </div>
            <span class="accordion-chevron" :class="{ open: showEvidencePass }">›</span>
          </button>
          <div v-show="showEvidencePass" class="results-list">
            <div v-for="res in checkerResults.filter(r => r.result)" :key="res.methodId" class="result-row">
              <div class="result-dot pass"></div>
              <span class="result-desc">{{ res.description }}</span>
              <span class="status-badge human">PASS</span>
            </div>
            <div v-if="!checkerResults.filter(r => r.result).length" class="result-row result-empty">No signals passed</div>
          </div>

          <!-- Fail accordion -->
          <button class="results-accordion-header sub" @click="showEvidenceFail = !showEvidenceFail">
            <div class="accordion-left">
              <div class="result-dot fail"></div>
              <span class="accordion-summary">Fail ({{ checkerResults.filter(r => !r.result).length }})</span>
            </div>
            <span class="accordion-chevron" :class="{ open: showEvidenceFail }">›</span>
          </button>
          <div v-show="showEvidenceFail" class="results-list">
            <div v-for="res in checkerResults.filter(r => !r.result)" :key="res.methodId" class="result-row">
              <div class="result-dot fail"></div>
              <span class="result-desc">{{ res.description }}</span>
              <span class="status-badge ai">FAIL</span>
            </div>
            <div v-if="!checkerResults.filter(r => !r.result).length" class="result-row result-empty">No signals failed</div>
          </div>
        </div>

        <div v-if="brainPolling && !brainVerdict" class="brain-card brain-pending">
          <span class="brain-label">AI Analysis</span>
          <span class="brain-analyzing">processing evidence...</span>
        </div>

        <div v-if="brainVerdict && brainVerdict.status !== 'not_found'" class="brain-card" :class="brainVerdict.verdict === 'HUMAN' ? 'brain-human' : 'brain-bot'">
          <div class="brain-row">
            <span class="brain-label">AI Verdict</span>
            <span :class="['status-badge', brainVerdict.verdict === 'HUMAN' ? 'human' : 'ai']">
              {{ brainVerdict.verdict === 'HUMAN' ? 'VERIFIED HUMAN' : 'SUSPECTED BOT' }}
            </span>
          </div>
          <p class="brain-reasoning">{{ brainVerdict.reasoning }}</p>
          <div class="brain-conf">Confidence: {{ Math.round((brainVerdict.confidence || 0) * 100) }}%</div>

          <!-- Verdict feedback -->
          <div class="brain-feedback">
            <template v-if="feedbackSent">
              <span class="brain-feedback-thanks">Thanks — the AI will learn from this.</span>
            </template>
            <template v-else>
              <span class="brain-feedback-label">Was this correct?</span>
              <button
                class="brain-feedback-btn brain-feedback-yes"
                :disabled="feedbackSubmitting"
                @click="submitFeedback(brainVerdict.verdict)"
                title="Yes, verdict is correct"
              >👍 Yes</button>
              <button
                class="brain-feedback-btn brain-feedback-no"
                :disabled="feedbackSubmitting"
                @click="submitFeedback(brainVerdict.verdict === 'HUMAN' ? 'AI' : 'HUMAN')"
                :title="'No, this is actually ' + (brainVerdict.verdict === 'HUMAN' ? 'a bot' : 'a human')"
              >👎 No — it's {{ brainVerdict.verdict === 'HUMAN' ? 'a bot' : 'a human' }}</button>
            </template>
          </div>
        </div>
      </div>

      <!-- Listing -->
      <div v-if="currentSection === 'listing'" class="content-section">
        <div class="listing-header">
          <div class="scan-tag">METHOD LISTING</div>
          <h2 class="scan-title">Submit a detection method</h2>
          <p class="scan-sub">Define a signal and pay 1000 POH to register it. 500 POH goes to stakers immediately, 500 to the protocol. Earn rewards when your method is used in scans.</p>
        </div>
        <div class="form-section">
          <div class="form-label-row">
            <span class="form-section-label">Method Type</span>
          </div>
          <div class="type-tabs">
            <button :class="['type-tab', { active: listing.type === 'evm' }]" @click="listing.type = 'evm'; abiFns = []">EVM Contract</button>
            <button :class="['type-tab', { active: listing.type === 'solana' }]" @click="listing.type = 'solana'; abiFns = []">Solana Program</button>
            <button :class="['type-tab', { active: listing.type === 'rest' }]" @click="listing.type = 'rest'; abiFns = []">REST API</button>
          </div>
        </div>

        <!-- EVM fields -->
        <div v-if="listing.type === 'evm'" class="form-section">
          <div class="form-label-row"><span class="form-section-label">Contract</span></div>
          <div class="input-group">
            <div class="form-row">
              <div class="form-col-sm">
                <label class="field-label">Chain ID</label>
                <input type="number" v-model="listing.chainId" placeholder="1" class="premium-input" />
              </div>
              <div class="form-col-lg">
                <label class="field-label">Contract Address</label>
                <div class="flex-input">
                  <input type="text" v-model="listing.address" placeholder="0x..." class="premium-input flex-grow" @blur="fetchAbi" />
                  <button @click="fetchAbi" :disabled="abiLoading || !listing.address" class="mini-btn">{{ abiLoading ? '...' : 'Fetch ABI' }}</button>
                </div>
              </div>
            </div>
            <div v-if="abiError" class="field-hint field-hint--warn">{{ abiError }}</div>
            <div v-if="abiFns.length" class="abi-picker">
              <div class="abi-picker-header">
                <span class="abi-picker-label">ABI Methods</span>
                <span class="abi-picker-count">{{ abiFns.length }} found</span>
              </div>
              <div class="abi-picker-list">
                <button v-for="fn in abiFns" :key="fn.name" @click="pickMethod(fn)" :class="['abi-fn-btn', { selected: listing.method === fn.name }]">{{ fn.name }}</button>
              </div>
            </div>
            <div class="form-row">
              <div class="form-col">
                <label class="field-label">Method Name <span class="field-hint-inline">e.g. balanceOf</span></label>
                <input type="text" v-model="listing.method" placeholder="balanceOf" class="premium-input font-mono" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-col">
                <label class="field-label">Input Types <span class="field-hint-inline">JSON array e.g. ["address"]</span></label>
                <input type="text" v-model="listing.abiTypes" placeholder='["address"]' class="premium-input font-mono" />
              </div>
              <div class="form-col">
                <label class="field-label">Return Types <span class="field-hint-inline">JSON array e.g. ["uint256"]</span></label>
                <input type="text" v-model="listing.returnTypes" placeholder='["uint256"]' class="premium-input font-mono" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-col-sm">
                <label class="field-label">Decimals <span class="field-hint-inline">for token values</span></label>
                <input type="number" v-model="listing.decimals" placeholder="18" class="premium-input" />
              </div>
            </div>
          </div>
        </div>

        <!-- Solana fields -->
        <div v-if="listing.type === 'solana'" class="form-section">
          <div class="form-label-row"><span class="form-section-label">Program</span></div>
          <div class="input-group">
            <div>
              <label class="field-label">Program Address (Mint for token balance)</label>
              <div class="flex-input">
                <input type="text" v-model="listing.address" placeholder="Program or mint address" class="premium-input flex-grow" @blur="fetchAbi" />
                <button @click="fetchAbi" :disabled="abiLoading || !listing.address" class="mini-btn">{{ abiLoading ? '...' : 'Fetch IDL' }}</button>
              </div>
            </div>
            <div v-if="abiError" class="field-hint field-hint--warn">{{ abiError }}</div>
            <div v-if="abiFns.length" class="abi-picker">
              <div class="abi-picker-header">
                <span class="abi-picker-label">IDL Instructions</span>
                <span class="abi-picker-count">{{ abiFns.length }} found</span>
              </div>
              <div class="abi-picker-list">
                <button v-for="fn in abiFns" :key="fn.name" @click="pickMethod(fn)" :class="['abi-fn-btn', { selected: listing.method === fn.name }]">{{ fn.name }}</button>
              </div>
            </div>
            <div>
              <label class="field-label">Method</label>
              <select v-model="listing.method" class="premium-select">
                <option value="getBalance">getBalance — native SOL balance</option>
                <option value="getTransactionCount">getTransactionCount — tx history count</option>
                <option value="getTokenBalance">getTokenBalance — SPL token balance (requires mint address above)</option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-col-sm">
                <label class="field-label">Decimals</label>
                <input type="number" v-model="listing.decimals" placeholder="9" class="premium-input" />
              </div>
            </div>
          </div>
        </div>

        <!-- REST fields -->
        <div v-if="listing.type === 'rest'" class="form-section">
          <div class="form-label-row"><span class="form-section-label">Endpoint</span></div>
          <div class="input-group">
            <div>
              <label class="field-label">URL <span class="field-hint-inline">use {address} as placeholder</span></label>
              <input type="text" v-model="listing.address" placeholder="https://api.example.com/check?address={address}" class="premium-input font-mono" />
            </div>
            <div class="form-row">
              <div class="form-col-sm">
                <label class="field-label">HTTP Method</label>
                <select v-model="listing.httpMethod" class="premium-select">
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </div>
              <div class="form-col-sm">
                <label class="field-label">Decimals <span class="field-hint-inline">optional</span></label>
                <input type="number" v-model="listing.decimals" placeholder="18" class="premium-input" />
              </div>
            </div>
            <div v-if="listing.httpMethod === 'POST'">
              <label class="field-label">Request Body <span class="field-hint-inline">JSON template, use {address}</span></label>
              <textarea v-model="listing.body" placeholder='{"address": "{address}"}' class="premium-textarea font-mono" rows="3"></textarea>
            </div>
            <div>
              <div class="form-label-row">
                <span class="field-label">Headers</span>
                <button class="utility-link" @click="addHeader">+ Add</button>
              </div>
              <div class="input-group" style="gap:0.4rem">
                <div v-for="(h, i) in headers" :key="i" class="flex-input">
                  <input type="text" v-model="h.key" placeholder="Header name" class="premium-input flex-grow" />
                  <input type="text" v-model="h.value" placeholder="Value" class="premium-input flex-grow" />
                  <button @click="removeHeader(i)" class="mini-btn" :disabled="headers.length === 1">×</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Expression — shared -->
        <div class="form-section">
          <div class="form-label-row"><span class="form-section-label">Expression</span></div>
          <div class="input-group">
            <div class="form-row">
              <div class="form-col">
                <label class="field-label">
                  Logic
                  <span v-if="listing.type === 'rest'" class="field-hint-inline">variables: data, status, decimals</span>
                  <span v-else class="field-hint-inline">variables: result (array), decimals</span>
                </label>
                <textarea v-model="listing.expression" placeholder="result[0] > 0n" class="premium-textarea font-mono" rows="3"></textarea>
              </div>
              <div class="form-col-sm">
                <label class="field-label">Language</label>
                <select v-model="listing.lang" class="premium-select">
                  <option value="js">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="rust">Rust</option>
                  <option value="go">Go</option>
                  <option value="php">PHP</option>
                  <option value="java">Java</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- Description + submit — shared -->
        <div class="form-section">
          <div class="form-label-row"><span class="form-section-label">Description</span></div>
          <div class="input-group">
            <textarea v-model="listing.description" placeholder="What does this method detect? What constitutes human evidence?" class="premium-textarea" rows="2" @input="autoExpand"></textarea>
            <div class="listing-fee-row">
              <span class="listing-fee-label">Listing fee: <strong>1000 POH</strong></span>
              <span class="listing-fee-balance" :class="{ insufficient: pohBalance < 1000 }">
                Balance: {{ pohBalance.toFixed(2) }} POH
              </span>
            </div>
            <button @click="submitListing" :disabled="loading || !listing.description || pohBalance < 1000" class="submit-listing-btn">
              {{ loading ? 'Confirming on-chain...' : 'Submit Method — 1000 POH' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Votes -->
      <div v-if="currentSection === 'votes'" class="votes-page">
        <div class="votes-header">
          <div class="scan-tag">CONSENSUS QUEUE</div>
          <h2 class="scan-title">Review detection methods</h2>
          <p class="scan-sub">Vote on whether each method reliably distinguishes humans from bots. Your POH stake weight determines your influence.</p>
        </div>

        <div v-if="loading" class="empty-state"><p>Loading...</p></div>

        <div v-else-if="!currentVoteItem" class="empty-state">
          <Code :size="28" />
          <p>{{ votingList.length ? 'All methods reviewed.' : 'Queue is empty.' }}</p>
          <button v-if="votingList.length" class="utility-link" @click="voteIndex = 0">Start over</button>
        </div>

        <div v-else class="vote-single">
          <div class="vote-progress">
            <div class="vote-progress-bar">
              <div class="vote-progress-fill" :style="{ width: (voteIndex / votingList.length * 100) + '%' }"></div>
            </div>
            <span class="vote-progress-label">{{ voteIndex + 1 }} / {{ votingList.length }}</span>
          </div>

          <div class="vote-card-single">
            <div class="vcs-meta">
              <span class="vmc-type">{{ currentVoteItem.type?.toUpperCase() }}</span>
              <span v-if="currentVoteItem.chainId" class="vcs-chain">chain {{ currentVoteItem.chainId }}</span>
              <span class="vmc-score">score {{ currentVoteItem.score?.toFixed(1) ?? '0.0' }}</span>
            </div>

            <p class="vcs-desc">{{ currentVoteItem.description }}</p>

            <div class="vcs-detail" v-if="currentVoteItem.address">
              <span class="vcs-detail-label">{{ currentVoteItem.type === 'rest' ? 'Endpoint' : 'Address' }}</span>
              <span class="vcs-detail-val">{{ currentVoteItem.address }}</span>
            </div>
            <div class="vcs-detail" v-if="currentVoteItem.method">
              <span class="vcs-detail-label">Method</span>
              <span class="vcs-detail-val">{{ currentVoteItem.method }}</span>
            </div>
            <div class="vcs-detail" v-if="currentVoteItem.expression">
              <span class="vcs-detail-label">Expression</span>
              <code class="vcs-code">{{ currentVoteItem.expression }}</code>
            </div>

            <div class="vcs-score-bar">
              <div class="vcs-score-fill" :style="{ width: Math.min(100, Math.max(0, (currentVoteItem.score || 0) * 10)) + '%' }"></div>
            </div>

            <textarea
              v-model="voteFeedback"
              class="vcs-feedback"
              placeholder="Optional: explain your reasoning to help the AI learn…"
              rows="2"
              maxlength="200"
              @input="autoExpand"
            ></textarea>

            <div class="vcs-actions">
              <button class="vcs-btn vcs-btn-yes" :disabled="voteSubmitting || feedbackValidating" @click="castVote(true)">
                {{ feedbackValidating ? 'Checking…' : voteSubmitting ? '…' : '✓ Human' }}
              </button>
              <button class="vcs-btn vcs-btn-no" :disabled="voteSubmitting || feedbackValidating" @click="castVote(false)">
                {{ feedbackValidating ? 'Checking…' : '✗ Robot' }}
              </button>
              <button class="vcs-btn vcs-btn-skip" :disabled="feedbackValidating" @click="castVote('skip')">
                Skip →
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Profile -->
      <div v-if="currentSection === 'profile'" class="profile-page">
        <div class="scan-hero">
          <div class="scan-tag">PROFILE</div>
          <h2 class="scan-title">Your POH Account</h2>
          <p class="scan-sub">Sign in with your Solana wallet to access your API key, track rewards, and manage your submitted methods.</p>
        </div>

        <div v-if="!connected" class="profile-connect-prompt">
          <p class="prompt-text">Connect your Solana wallet to view your profile.</p>
          <button class="submit-listing-btn" @click="showWalletModal = true">Connect Wallet</button>
        </div>

        <template v-else>
          <div v-if="profileError" class="profile-error">{{ profileError }}</div>

          <div v-if="profileLoading" class="empty-state"><p>Loading profile...</p></div>

          <div v-else-if="!profileData" class="profile-signup-card">
            <p class="signup-desc">No profile found for this wallet. Create one to get your API key and start earning rewards from submitted methods.</p>
            <button class="submit-listing-btn" :disabled="signupLoading" @click="signupProfile()">
              {{ signupLoading ? 'Signing...' : 'Create Profile' }}
            </button>
          </div>

          <template v-else>
            <!-- Stats row -->
            <div class="profile-stats">
              <div class="pstat-card">
                <div class="pstat-val">{{ profileData.profile?.freeScansLeft ?? 100 }}</div>
                <div class="pstat-label">Free Scans Left</div>
              </div>
              <div class="pstat-card">
                <div class="pstat-val">{{ profileData.profile?.totalScans ?? 0 }}</div>
                <div class="pstat-label">Total Scans</div>
              </div>
              <div class="pstat-card deposit-stat" @click="showDepositModal = true" title="Click to deposit POH">
                <div class="pstat-val">{{ ((profileData.profile?.balance ?? 0) / 1e6).toFixed(2) }}</div>
                <div class="pstat-label">Account Balance (POH) <br><span class="pstat-deposit-hint">Tap to Deposit</span></div>
              </div>
              <div class="pstat-card">
                <div class="pstat-val">{{ profileData.earned ? (profileData.earned / 1e6).toFixed(2) : '0.00' }}</div>
                <div class="pstat-label">Total Earned</div>
              </div>
            </div>

            <!-- Claimable scan earnings -->
            <div v-if="(profileData.pending ?? 0) > 0" class="profile-card profile-claim-card">
              <div class="profile-card-header">
                <span class="profile-card-title">Scan Earnings</span>
                <span class="claim-amount">{{ (profileData.pending / 1e6).toFixed(4) }} POH</span>
              </div>
              <p class="profile-hint">Your methods earned this from paid scans. Claim to receive tokens on-chain.</p>
              <button class="submit-listing-btn claim-btn" :disabled="offchainClaimLoading" @click="claimOffchainBalance()">
                {{ offchainClaimLoading ? 'Claiming...' : 'Claim Earnings' }}
              </button>
            </div>

            <!-- API Key -->
            <div class="profile-card">
              <div class="profile-card-header">
                <span class="profile-card-title">API Key</span>
                <button class="mini-btn" @click="rotateApiKey()">Rotate</button>
              </div>
              <div class="apikey-row">
                <code class="apikey-display">{{ profileData.profile?.apiKey }}</code>
                <button class="mini-btn" @click="copyText(profileData.profile?.apiKey)">Copy</button>
              </div>
              <p class="profile-hint">Pass as <code>apiKey</code> in POST /checker body. Identify scans without wallet interaction.</p>
            </div>

            <!-- Submitted methods -->
            <div class="profile-card">
              <div class="profile-card-header">
                <span class="profile-card-title">Submitted Methods</span>
                <span class="profile-card-count">{{ profileData.methods?.length ?? 0 }}</span>
              </div>
              <div v-if="!profileData.methods?.length" class="profile-empty">
                No methods submitted yet.
                <button class="utility-link no-margin" @click="showSection('listing')">Submit one →</button>
              </div>
              <div v-else class="method-list-profile">
                <div v-for="m in profileData.methods" :key="m.id" class="mlist-row">
                  <div class="mlist-main">
                    <span class="mlist-type">{{ m.type?.toUpperCase() }}</span>
                    <span class="mlist-desc">{{ m.description }}</span>
                  </div>
                  <div class="mlist-meta">
                    <span class="mlist-score">score {{ m.score?.toFixed(1) ?? '0.0' }}</span>
                    <span class="mlist-earned">{{ ((profileData.pending || 0) / 1e6).toFixed(4) }} POH pending</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- My Votes -->
            <div class="profile-card">
              <div class="profile-card-header">
                <span class="profile-card-title">My Feedback</span>
                <span class="profile-card-count">{{ myVotesData.length }}</span>
              </div>
              <div v-if="!myVotesData.length" class="profile-empty">
                No feedback provided yet.
                <button class="utility-link no-margin" @click="showSection('votes'); loadVoting()">Provide feedback →</button>
              </div>
              <div v-else class="method-list-profile">
                <div v-for="v in myVotesData" :key="v.methodId" class="mlist-row">
                  <div class="mlist-main">
                    <span class="mlist-type">{{ v.type?.toUpperCase() }}</span>
                    <span class="mlist-desc">{{ v.description }}</span>
                  </div>
                  <div v-if="v.feedback" class="mlist-feedback">"{{ v.feedback }}"</div>
                  <div class="mlist-meta">
                    <span :class="['vote-badge', v.vote ? 'vote-human' : 'vote-bot']">
                      {{ v.vote ? '✓ Human' : '✗ Bot' }}
                    </span>
                    <span class="mlist-score">{{ new Date(v.at).toLocaleDateString() }}</span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- API -->
      <div v-if="currentSection === 'api'" class="api-page">
        <div class="scan-hero">
          <div class="scan-tag">API REFERENCE</div>
          <h2 class="scan-title">Integrate POH</h2>
          <p class="scan-sub">Simple HTTP API. First 100 scans free per wallet. Authenticate with an API key from your profile.</p>
        </div>

        <!-- Pricing table -->
        <div class="api-section">
          <div class="api-section-title">Pricing</div>
          <div class="pricing-table">
            <div class="pt-row pt-head">
              <span>Batch size</span><span>Rate</span><span>Example</span>
            </div>
            <div class="pt-row">
              <span>1 – 9 addresses</span><span>1.00 POH / addr</span><span>5 addrs = 5 POH</span>
            </div>
            <div class="pt-row">
              <span>10 – 49 addresses</span><span>0.85 POH / addr</span><span>20 addrs = 17 POH</span>
            </div>
            <div class="pt-row">
              <span>50 – 99 addresses</span><span>0.70 POH / addr</span><span>70 addrs = 49 POH</span>
            </div>
            <div class="pt-row">
              <span>100 – 499 addresses</span><span>0.55 POH / addr</span><span>200 addrs = 110 POH</span>
            </div>
            <div class="pt-row">
              <span>500+ addresses</span><span>0.40 POH / addr</span><span>1000 addrs = 400 POH</span>
            </div>
            <div class="pt-row pt-free">
              <span>Free tier</span><span>0 POH</span><span>First 100 scans per wallet</span>
            </div>
          </div>
        </div>

        <!-- Endpoint docs -->
        <div class="api-section">
          <div class="api-section-title">POST /checker</div>
          <div class="api-card">
            <div class="api-desc">Scan one or more wallet addresses against all registered detection methods. Single address → synchronous result with <code>brainKey</code>. Multiple addresses or CSV upload → async job with <code>jobId</code> to poll.</div>
            <div class="api-params">
              <div class="param-row"><code>input</code><span>string or array — wallet address(es) to scan</span></div>
              <div class="param-row"><code>walletAddress</code><span>your Solana wallet (for free tier tracking)</span></div>
              <div class="param-row"><code>apiKey</code><span>API key from your profile (alternative to walletAddress)</span></div>
              <div class="param-row"><code>txHash</code><span>POH burn transaction hash (required for paid scans)</span></div>
              <div class="param-row"><code>chainIds</code><span>comma-separated chain IDs to filter EVM methods (optional)</span></div>
              <div class="param-row"><code>csv</code><span>multipart file upload — CSV with address column (bulk mode)</span></div>
            </div>
            <div class="code-block">
              <div class="code-lang">curl — single</div>
              <pre class="code-pre">curl -X POST https://proofofhuman.ge/checker \
  -H "Content-Type: application/json" \
  -d '{
    "input": "6bvB3PTz48wozyPJeuTB77axexWu9MfUSjBYbQzEgK88",
    "apiKey": "your-api-key-here"
  }'
# → { result: [...], brainKey, freeScansLeft }</pre>
            </div>
            <div class="code-block">
              <div class="code-lang">curl — bulk (CSV)</div>
              <pre class="code-pre">curl -X POST https://proofofhuman.ge/checker \
  -F "csv=@wallets.csv" \
  -F "apiKey=your-api-key-here" \
  -F "txHash=your-payment-tx"
# → { jobId, status: "queued", total, pollUrl }</pre>
            </div>
            <div class="code-block">
              <div class="code-lang">JavaScript</div>
              <pre class="code-pre">const res = await fetch('/checker', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input: '6bvB3PTz48wozyPJeuTB77axexWu9MfUSjBYbQzEgK88',
    apiKey: 'your-api-key-here'
  })
})
const { result, brainKey, freeScansLeft } = await res.json()</pre>
            </div>
          </div>
        </div>

        <div class="api-section">
          <div class="api-section-title">GET /checker/job/:jobId</div>
          <div class="api-card">
            <div class="api-desc">Poll the status of a bulk scan job. <code>jobId</code> is returned by POST /checker when more than one address is submitted. Jobs are retained for 2 hours after completion.</div>
            <div class="api-params">
              <div class="param-row"><code>status</code><span>queued | running | done</span></div>
              <div class="param-row"><code>total</code><span>total addresses in the job</span></div>
              <div class="param-row"><code>done</code><span>addresses processed so far</span></div>
              <div class="param-row"><code>percent</code><span>completion percentage (0–100)</span></div>
              <div class="param-row"><code>results</code><span>array of per-method scan results (grows incrementally)</span></div>
              <div class="param-row"><code>errors</code><span>array of error messages for failed addresses</span></div>
            </div>
            <div class="code-block">
              <div class="code-lang">JavaScript — poll until done</div>
              <pre class="code-pre">const { jobId } = await fetch('/checker', { method: 'POST', ... }).then(r => r.json())

async function pollJob(jobId) {
  while (true) {
    const job = await fetch(`/checker/job/${jobId}`).then(r => r.json())
    console.log(`${job.percent}% — ${job.done}/${job.total}`)
    if (job.status === 'done') return job.results
    await new Promise(r => setTimeout(r, 3000))
  }
}

const results = await pollJob(jobId)</pre>
            </div>
          </div>
        </div>

        <div class="api-section">
          <div class="api-section-title">GET /checker/brain/:key</div>
          <div class="api-card">
            <div class="api-desc">Poll for the async AI verdict after a scan. <code>brainKey</code> is returned by POST /checker. Returns <code>status: "pending" | "done" | "error"</code>.</div>
            <div class="code-block">
              <div class="code-lang">curl</div>
              <pre class="code-pre">curl https://proofofhuman.ge/checker/brain/0xabc123...</pre>
            </div>
            <div class="api-params">
              <div class="param-row"><code>verdict</code><span>HUMAN | AI | UNCERTAIN | UNKNOWN</span></div>
              <div class="param-row"><code>confidence</code><span>0.0 – 1.0</span></div>
              <div class="param-row"><code>reasoning</code><span>short technical explanation</span></div>
            </div>
          </div>
        </div>

        <div class="api-section">
          <div class="api-section-title">GET /checker/pricing?count=N</div>
          <div class="api-card">
            <div class="api-desc">Returns cost breakdown for a given batch size before committing.</div>
            <div class="code-block">
              <div class="code-lang">curl</div>
              <pre class="code-pre">curl "https://proofofhuman.ge/checker/pricing?count=100"
# → { count: 100, perAddress: 0.55, total: 55000000, tiers: [...] }</pre>
            </div>
          </div>
        </div>

        <div class="api-section">
          <div class="api-section-title">GET /profile/:address</div>
          <div class="api-card">
            <div class="api-desc">Returns profile stats, submitted methods, and reward totals for a wallet address.</div>
            <div class="code-block">
              <div class="code-lang">curl</div>
              <pre class="code-pre">curl https://proofofhuman.ge/profile/YourSolanaWalletAddressHere</pre>
            </div>
          </div>
        </div>

        <div class="api-cta">
          <p>Get your API key from your <button class="utility-link" @click="showSection('profile'); loadProfile(); loadMyVotes()">profile →</button></p>
        </div>
      </div>

      <!-- Staking -->
      <div v-if="currentSection === 'staking'" class="staking-page">
        <div class="scan-hero">
          <div class="scan-tag">STAKING</div>
          <h2 class="scan-title">Stake POH</h2>
          <p class="scan-sub">Your staked POH balance determines your vote weight when scoring detection methods. Higher stake = more signal in the consensus.</p>
        </div>

        <div class="staking-grid">
          <div class="staking-info-card">
            <div class="si-title">How staking works</div>
            <ul class="si-list">
              <li>Stake POH → get more voting power on which detection methods are best</li>
              <li>The more you stake, the more your votes count</li>
              <li>Unstake any time — no lockup</li>
            </ul>
          </div>

          <div class="staking-info-card">
            <div class="si-title">How rewards work</div>
            <ul class="si-list">
              <li>Every scan fee is split — 50% goes to method owners</li>
              <li>Your votes boost a method's score → that method earns more</li>
              <li>Back good methods, earn more rewards</li>
            </ul>
          </div>
        </div>

        <div class="stake-form-card">
          <div class="stake-form-title">Manage Stake</div>
          <div v-if="!connected" class="prompt-text">
            <button class="utility-link" @click="showWalletModal = true">Connect wallet →</button>
          </div>
          <template v-else>
            <!-- Balances -->
            <div class="stake-balance-row">
              <div class="sbal-item">
                <div class="sbal-val">{{ pohBalance.toFixed(2) }}</div>
                <div class="sbal-label">Wallet POH</div>
              </div>
              <div class="sbal-item">
                <div class="sbal-val">{{ stakedBalance.toFixed(2) }}</div>
                <div class="sbal-label">Staked</div>
              </div>
              <div class="sbal-item">
                <div class="sbal-val">{{ totalStaked.toFixed(0) }}</div>
                <div class="sbal-label">Total Staked</div>
              </div>
              <div class="sbal-item sbal-claimable">
                <div class="sbal-val">{{ claimable.toFixed(4) }}</div>
                <div class="sbal-label">Claimable</div>
              </div>
            </div>

            <!-- Stake -->
            <div class="stake-action-row">
              <div class="flex-input">
                <input type="number" v-model="stakeAmount" placeholder="POH to stake" class="premium-input flex-grow" min="0" step="1" />
                <button class="outline-btn" :disabled="stakeLoading || !stakeAmount" @click="submitStake()">
                  {{ stakeLoading ? '...' : 'Stake' }}
                </button>
              </div>
              <button class="max-btn" @click="stakeAmount = pohBalance.toFixed(2)">MAX</button>
            </div>

            <!-- Unstake -->
            <div class="stake-action-row">
              <div class="flex-input">
                <input type="number" v-model="unstakeAmount" placeholder="POH to unstake" class="premium-input flex-grow" min="0" step="1" />
                <button class="outline-btn" :disabled="unstakeLoading || !unstakeAmount" @click="submitUnstake()">
                  {{ unstakeLoading ? '...' : 'Unstake' }}
                </button>
              </div>
              <button class="max-btn" @click="unstakeAmount = stakedBalance.toFixed(2)">MAX</button>
            </div>

            <!-- Claim on-chain staking rewards -->
            <div v-if="claimable > 0" class="stake-claim-row">
              <span class="claim-desc">{{ claimable.toFixed(4) }} POH from on-chain staking</span>
              <button class="outline-btn" :disabled="claimLoading" @click="claimRewards()">
                {{ claimLoading ? 'Claiming...' : 'Claim Rewards' }}
              </button>
            </div>

            <!-- Claim off-chain rewards (listing fees + scan revenue distributed by backend) -->
            <div v-if="(profileData?.profile?.balance ?? 0) > 0" class="stake-claim-row">
              <span class="claim-desc">{{ ((profileData.profile.balance) / 1e6).toFixed(4) }} POH off-chain rewards</span>
              <button class="outline-btn" :disabled="offchainClaimLoading" @click="claimOffchainBalance()">
                {{ offchainClaimLoading ? 'Claiming...' : 'Claim POH' }}
              </button>
            </div>

            <div v-if="stakeMessage" class="stake-message">{{ stakeMessage }}</div>
            <p class="profile-hint" style="margin-top:0.75rem">
              Contract: <code>{{ STAKING_CONTRACT }}</code>
            </p>
          </template>
        </div>
      </div>

    </main>

    <footer class="footer">
      <div class="network-label">CONNECT</div>
    </footer>
  </div>
</template>

<style scoped>

.neon-btn {
  background: #000;
  color: #fff;
  border: none;
  padding: 0.7rem 1.4rem;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
  font-size: 1rem;
}


/* ── Landing ─────────────────────────────────────────────────────────────── */
.network-label {
  font-size: 3rem;
  margin: auto;
  color: #888;
  display: block;
  text-align: center;
  margin: 3.5rem 0;
}

.landing {
  max-width: 1280px;
  margin: 0 auto 0;
  padding: 0 0 2rem;
}

/* ── Problem screen ───────────────────────────────────────────────────────── */
.problem-screen {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6rem 2rem;
  /* border-bottom: 1px solid #111; */
}
.problem-inner { max-width: 680px; text-align: center; }
.problem-tag {
  font-size: 0.7rem; letter-spacing: 0.18em; color: #808080;
  font-family: 'JetBrains Mono', monospace; margin-bottom: 2rem;
}
.problem-title {
  text-align: center;
  font-size: clamp(1.8rem, 4vw, 3rem);
  font-weight: 700; color: #ccc; line-height: 1.25; margin-bottom: 2.5rem;
}
.problem-accent { color: #fff; }
.problem-quote {
  border-left: 2px solid #333; margin: 0 0 2rem; padding: 1.25rem 1.5rem;
  text-align: left; background: #ffffff08; border-radius: 0 8px 8px 0;
}
.problem-quote-inner { display: flex; align-items: flex-start; gap: 1rem; }
.problem-quote-avatar {
  width: 52px; height: 52px; border-radius: 50%; object-fit: cover; object-position: top center;
  flex-shrink: 0; border: 1px solid #ffffff20;
}
.problem-quote-name { display: block; font-style: normal; font-weight: 600; color: #ffffffcc; font-size: 0.88rem; margin-bottom: 0.4rem; }
.problem-quote-text { margin: 0; color: #808080; font-style: italic; font-size: 1.1rem; line-height: 1.6; }
.problem-desc { color: #808080; font-size: 1.25rem; line-height: 1.7; margin-bottom: 2.5rem; }


/* ── Benefit ──────────────────────────────────────────────────────────────── */
.benefit-section {
  padding: 10rem 2rem;
  /* border-top: 1px solid #111; */
  text-align: center;
}
.benefit-header {
  display: flex;
  align-items: baseline;
  gap: 1.5rem;
  margin-bottom: 3.5rem;
  justify-content: flex-start;
  max-width: 900px;
  margin-left: auto;
  margin-right: auto;
}
.benefit-title {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.02em;
  margin: 0;
}
.benefit-subtitle {
  color: #ffffff60;
  font-size: 1rem;
  white-space: nowrap;
}
.benefit-cards {
  display: flex;
  justify-content: center;
  gap: 4rem;
  flex-wrap: wrap;
  max-width: 1400px;
  margin: 0 auto;
}
.benefit-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  flex: 1;
  min-width: 220px;
  /* max-width: 280px; */
}
.benefit-svg {
  width: 100%;
  /* max-width: 240px; */
  height: auto;
  border-radius: 12px;
}
.benefit-label {
  color: #ffffffcc;
  font-size: 1.5rem;
  line-height: 1.5;
  text-align: center;
  margin: 0;
}

/* ── Roadmap ──────────────────────────────────────────────────────────────── */
.roadmap-section { padding: 5rem 0 6rem; border-top: 1px solid #111; }
.roadmap-list { max-width: 520px; margin: 2.5rem auto 0; display: flex; flex-direction: column; gap: 0; }
.roadmap-item {
  display: flex; gap: 1.25rem; align-items: flex-start;
  padding: 1.1rem 0; position: relative;
}
.roadmap-item:not(:last-child)::after {
  content: ''; position: absolute; left: 5px; top: 2.2rem; bottom: -1rem;
  width: 1px; background: #1a1a1a;
}
.roadmap-dot {
  width: 11px; height: 11px; border-radius: 50%; border: 1px solid #808080;
  background: #0d0d0d; flex-shrink: 0; margin-top: 3px;
}
.roadmap-active .roadmap-dot { border-color: #808080; background: #1a1a1a; box-shadow: 0 0 6px #808080; }
.roadmap-date { font-size: 2rem; color: #808080; font-family: 'JetBrains Mono', monospace; margin-bottom: 0.2rem; }
.roadmap-active .roadmap-date { color: #888; }
.roadmap-desc { font-size: 1.25rem; color: #808080; padding: 5px 0px; }
.roadmap-active .roadmap-desc { color: #666; }

.landing-hero {
  padding: 10rem 0 10rem;
  text-align: center;
}

.landing-tag {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #808080;
  text-transform: uppercase;
  margin-bottom: 1.5rem;
}

.landing-title {
  font-size: clamp(2.75rem, 7.5vw, 4.38rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 1.05;
  color: #fff;
  margin: 3rem 0;
}

.landing-sub {
  font-size: 1.25rem;
  color: #808080;
  line-height: 1.7;
  margin-bottom: 2rem;
}

.landing-cta {
  font-size: 1.56rem;
  padding: 1rem 1.75rem;
  display: flex;
  align-items: center;   /* vertical center */
  justify-content: center; /* horizontal center (optional) */
  gap: 8px; /* space between icon and text */
}

.landing-divider {
  height: 1px;
  background: #111;
  margin: 0.5rem 0 3rem;
}

/* Utilities grid */
/* ── Feature screens ─────────────────────────────────────────────────────── */
.feat-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  gap: 4rem;
  padding: 6rem 0;
  border-bottom: 1px solid #0f0f0f;
}
.feat-screen--alt { flex-direction: row-reverse; }

.feat-left {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 460px;
}
.feat-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.display-block { display: block; }

.feat-tag {
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  color: #808080;
  font-weight: 600;
}
.feat-title {
  font-size: clamp(2rem, 4vw, 3rem);
  font-weight: 700;
  color: #fff;
  line-height: 1.1;
  letter-spacing: -0.03em;
  margin: 0;
}
.feat-body {
  font-size: 1.25rem;
  color: #808080;
  line-height: 1.7;
  margin: 0;
}
.feat-cta {
  align-self: flex-start;
  background: none;
  border: none;
  color: #666;
  font-size: 0.95rem;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}
.feat-cta:hover { color: #fff; }

.feat-svg {
  width: 100%;
  max-width: 768px;
  height: auto;
  overflow: visible;
}

@media (max-width: 768px) {
  .feat-screen {
    flex-direction: column !important;
    min-height: auto;
    padding: 4rem 0;
    gap: 2.5rem;
  }
  .feat-left {
    max-width: 100%;
  }
  .feat-svg {
    max-width: 100%;
  }
}

.utility-link {
  background: none;
  border: none;
  color: #888;
  font-size: 1rem;
  cursor: pointer;
  padding: 0;
  text-align: left;
  transition: color 0.15s;
}
.utility-link:hover { color: #fff; }

/* Token section */
.landing-token {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 2rem;
}

.token-header {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 1rem;
}

.token-ticker {
  font-size: 1.62rem;
  font-weight: 700;
  color: #fff;
  letter-spacing: -0.02em;
}

.token-label {
  font-size: 1.25rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #808080;
}

.token-desc {
  font-size: 1.44rem;
  color: #808080;
  line-height: 1.6;
  margin-bottom: 3.75rem;
}

.token-split { margin-bottom: 3.75rem; }

.split-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.4rem;
}

.split-label { font-size: 1.25rem; color: #888; }
.split-pct { font-size: 1.12rem; font-weight: 600; color: #fff; font-variant-numeric: tabular-nums; }

.split-bar {
  height: 2px;
  background: #1a1a1a;
  border-radius: 1px;
  margin-bottom: 0.4rem;
}

.split-fill {
  height: 100%;
  background: #fff;
  border-radius: 1px;
}

.split-note {
  font-size: 1.25rem;
  color: #3a3a3a;
}

.token-features {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 3.75rem;
}

.token-feat {
  font-size: 1.25rem;
  color: #808080;
  border: 1px solid #1a1a1a;
  border-radius: 4px;
  padding: 0.3rem 1rem;
}

/* ── How it works ────────────────────────────────────────────────────────── */
.how-section { margin: 0 0 10rem; }

.how-label {
  font-size: 0.81rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #808080;
  text-transform: uppercase;
  margin-bottom: 2rem;
  text-align: center;
}

.how-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background: #111;
  border: 1px solid #111;
  border-radius: 8px;
  overflow: hidden;
}

.how-col {
  background: #000;
  padding: 1.75rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.how-step-title {
  font-size: 0.94rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #fff;
}

.how-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.how-list li {
  font-size: 1rem;
  color: #808080;
  line-height: 1.55;
  padding-left: 0.9rem;
  position: relative;
}

.how-list li::before {
  content: '—';
  position: absolute;
  left: 0;
  color: #808080;
}

.how-tag {
  display: inline-block;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #808080;
  border: 1px solid #1a1a1a;
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
  margin-right: 0.35rem;
  vertical-align: middle;
}

/* ── Network visualization ───────────────────────────────────────────────── */
.net-section {
  width: 100vw;
  position: relative;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 3rem;
  background: #000;
  padding: 0 0 2rem;
}

.net-subtitle {
  text-align: center;
  font-size: 1.1rem;
  color: #808080;
  margin: -2rem 0 2.5rem;
  letter-spacing: 0.03em;
}

.net-wrap {
  /* border: 1px solid #111; */
  border-radius: 10px;
  overflow: hidden;
  background: #000;
  width: 100%;
}

.net-svg {
  display: block;
  width: 100%;
  height: auto;
}

/* ── Edges ── */
.net-edge {
  stroke: #1c1c1c;
  stroke-width: 1.2;
  stroke-dasharray: 3 11;
  animation: net-flow 2s linear infinite;
}
.net-edge--evm    { stroke: #808080; }
.net-edge--rest   { stroke: #222; }
.net-edge--solana { stroke: #2a1a44; }

.net-edge--active {
  stroke-width: 1.8;
  animation-duration: 0.45s !important;
}
.net-edge--active.net-edge--evm    { stroke: #808080; }
.net-edge--active.net-edge--rest   { stroke: #808080; }
.net-edge--active.net-edge--solana { stroke: #9945ff88; }

@keyframes net-flow {
  to { stroke-dashoffset: -28; }
}

/* ── Brain → verdict edges ── */
.net-verdict-edge {
  stroke-width: 1;
  stroke-dasharray: 3 9;
  animation: net-flow 3s linear infinite;
}
.net-verdict-edge--human { stroke: #1a3a1a; }
.net-verdict-edge--bot   { stroke: #3a1a1a; }

/* ── Method nodes ── */
.net-ngroup circle {
  fill: #080808;
  stroke-width: 1.5;
  transition: fill 0.25s, filter 0.25s;
}
.net-ngroup--evm    circle { stroke: #808080; }
.net-ngroup--rest   circle { stroke: #1e1e1e; }
.net-ngroup--solana circle { stroke: #4a2a7a; }

.net-ngroup--active circle { fill: #111; }
.net-ngroup--active.net-ngroup--evm    circle { stroke: #666;      filter: drop-shadow(0 0 5px #808080); }
.net-ngroup--active.net-ngroup--rest   circle { stroke: #808080;      filter: drop-shadow(0 0 5px #808080); }
.net-ngroup--active.net-ngroup--solana circle { stroke: #9945ff;   filter: drop-shadow(0 0 6px #9945ff88); }

.net-nlabel {
  font-size: 9.5px;
  fill: #3a3a3a;
  font-family: -apple-system, 'SF Mono', monospace;
  pointer-events: none;
  transition: fill 0.25s;
}
.net-ngroup--active .net-nlabel { fill: #666; }

/* ── AI Brain ── */
.net-brain-ring {
  fill: none;
  stroke: #1a1a1a;
  stroke-width: 1;
  stroke-dasharray: 4 6;
  animation: net-flow 8s linear infinite reverse;
}
.net-brain-core {
  fill: #0d0d0d;
  stroke: #fff;
  stroke-width: 1.5;
  transition: filter 0.3s;
}
.net-brain-g--pulse .net-brain-core {
  filter: drop-shadow(0 0 18px rgba(255,255,255,0.35)) drop-shadow(0 0 6px rgba(255,255,255,0.2));
}
.net-brain-g {
  transition: transform 0.2s ease;
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.net-brain-g--pulse {
  transform: scale(1.04);
}
.net-brain-title {
  font-size: 8.5px;
  font-weight: 600;
  fill: #888;
  font-family: -apple-system, sans-serif;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  pointer-events: none;
}

/* ── Role badges (E / L / C) ── */
.net-role { stroke-width: 1; }
.net-role--eval  { fill: #0a1a0a; stroke: #1a4a1a; }
.net-role--learn { fill: #0a100a; stroke: #1a3a2a; }
.net-role--comp  { fill: #0a0a1a; stroke: #1a1a4a; }

.net-brain-g--pulse .net-role--eval  { stroke: #2aaa2a; filter: drop-shadow(0 0 4px #2aaa2a88); }
.net-brain-g--pulse .net-role--learn { stroke: #2a8a5a; filter: drop-shadow(0 0 4px #2a8a5a88); }
.net-brain-g--pulse .net-role--comp  { stroke: #2a4aaa; filter: drop-shadow(0 0 4px #2a4aaa88); }

.net-role-lbl {
  font-size: 7px;
  font-weight: 700;
  fill: #808080;
  font-family: -apple-system, monospace;
  pointer-events: none;
}
.net-brain-g--pulse .net-role-lbl { fill: #aaa; }

/* ── Verdict output nodes ── */
.net-verdict {
  stroke-width: 1;
  fill: #060606;
  transition: stroke 0.3s, filter 0.3s;
}
.net-verdict--human { stroke: #1a3a1a; }
.net-verdict--bot   { stroke: #3a1a1a; }

.net-verdict-lbl {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.1em;
  font-family: -apple-system, monospace;
  pointer-events: none;
}
.net-verdict--human + .net-verdict-lbl,
.net-verdict-lbl { fill: #808080; }

/* ── Legend ── */
.net-legend {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 0.5rem 1.5rem;
  margin-top: 1rem;
  flex-wrap: wrap;
}
.net-legend-group {
  display: flex;
  gap: 1.25rem;
  flex-wrap: wrap;
  align-items: center;
}
.nl-sep {
  width: 1px;
  height: 14px;
  background: #222;
  flex-shrink: 0;
}
.nl-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1.1rem;
  color: #3a3a3a;
  white-space: nowrap;
}
.nl-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid transparent;
}
.nl-dot--evm    { background: #1a1a1a; border-color: #808080; }
.nl-dot--solana { background: #0d0019; border-color: #4a2a7a; }
.nl-dot--rest   { background: #0d0d0d; border-color: #222; }
.nl-dot--eval   { background: #0a1a0a; border-color: #1a4a1a; }
.nl-dot--learn  { background: #0a100a; border-color: #1a3a2a; }
.nl-dot--comp   { background: #0a0a1a; border-color: #1a1a4a; }

/* ── Form sections (Listing) ─────────────────────────────────────────────── */
.form-section {
  border: 1px solid #161616;
  border-radius: 10px;
  padding: 1.25rem 1.5rem 1.5rem;
  margin-bottom: 0.75rem;
  background: #050505;
}

.form-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid #111;
}

.form-section-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: #3a3a3a;
}

.field-label {
  display: block;
  font-size: 0.72rem;
  font-weight: 500;
  color: #808080;
  margin-bottom: 0.4rem;
  letter-spacing: 0.02em;
}

.field-hint-inline {
  color: #2e2e2e;
  font-weight: 400;
  margin-left: 0.3rem;
  font-size: 0.68rem;
}

.field-hint { font-size: 0.72rem; color: #808080; margin-top: 0.3rem; }
.field-hint--warn { color: #666; }

.type-tabs {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.type-tab {
  background: none;
  border: 1px solid #1a1a1a;
  color: #808080;
  padding: 0.4rem 1rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.type-tab:hover { border-color: #808080; color: #aaa; }
.type-tab.active { background: #fff; color: #000; border-color: #fff; font-weight: 600; }

.form-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  min-width: 0;
}

.form-col { flex: 1; min-width: 0; }
.form-col-sm { flex: 0 0 100px; min-width: 0; }
.form-col-lg { flex: 2; min-width: 0; }

.listing-header {
  text-align: center;
  margin-bottom: 2rem;
}

.submit-listing-btn {
  width: 100%;
  background: #fff;
  color: #000;
  border: none;
  padding: 0.9rem 1.5rem;
  border-radius: 8px;
  font-weight: 700;
  font-size: 1.2rem;
  cursor: pointer;
  transition: opacity 0.15s;
  letter-spacing: 0.02em;
  margin-top: 0.25rem;
}

.submit-listing-btn:hover:not(:disabled) { opacity: 0.88; }
.submit-listing-btn:disabled { opacity: 0.2; cursor: not-allowed; }

/* ── Scan page ───────────────────────────────────────────────────────────── */
.scan-page {
  max-width: 600px;
  margin: 0 auto 4rem;
  padding-top: 3rem;
}

.scan-hero {
  text-align: center;
  margin-bottom: 2.5rem;
}

.scan-tag {
  font-size: 0.81rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: #808080;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
}

.scan-title {
  font-size: 2.19rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: #fff;
  margin-bottom: 0.5rem;
}

.scan-sub {
  font-size: 1.56rem;
  color: #808080;
  line-height: 1.6;
}

.scan-box {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-bottom: 2rem;
}

.scan-input-row {
  display: flex;
  gap: 0;
  border: 1px solid #222;
  border-radius: 8px;
  overflow: hidden;
  background: #080808;
  transition: border-color 0.15s;
}

.scan-input-row:focus-within { border-color: #808080; }

.scan-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 0.9rem 1rem;
  color: #fff;
  font-size: 1.12rem;
}

.scan-input::placeholder { color: #808080; }

.scan-upload {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  border-left: 1px solid #1a1a1a;
  cursor: pointer;
  color: #808080;
  transition: color 0.15s;
  flex-shrink: 0;
}

.scan-upload:hover { color: #aaa; }

.scan-btn {
  width: 100%;
  background: #fff;
  color: #000;
  border: none;
  padding: 1.25rem;
  border-radius: 7px;
  font-weight: 600;
  font-size: 1.56rem;
  cursor: pointer;
  transition: opacity 0.15s;
}

.scan-btn:hover:not(:disabled) { opacity: 0.85; }
.scan-btn:disabled { opacity: 0.25; cursor: not-allowed; }

.brain-card {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  border-left: 3px solid #222;
}

.brain-pending { border-left-color: #808080; }
.brain-human   { border-left-color: var(--green); }
.brain-bot     { border-left-color: var(--red); }

.brain-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.brain-conf { font-size: 1.25rem; color: #808080; margin-top: 0.5rem; }

.brain-feedback {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid #1a1a1a;
  flex-wrap: wrap;
}
.brain-feedback-label { color: #666; font-size: 0.8rem; margin-right: 0.25rem; }
.brain-feedback-btn {
  padding: 0.3rem 0.75rem;
  border-radius: 5px;
  border: 1px solid #333;
  background: #111;
  color: #ccc;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.brain-feedback-yes:hover  { background: #0d1a0d; border-color: #22c55e60; color: #22c55e; }
.brain-feedback-no:hover   { background: #1a0808; border-color: #ef444460; color: #ef4444; }
.brain-feedback-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.brain-feedback-thanks { color: #22c55e; font-size: 0.82rem; }

.results-accordion {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
}

.evidence-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1rem 0.75rem;
  background: #0a0a0a;
  border-bottom: 1px solid #111;
}

.evidence-title {
  font-size: 1rem;
  color: #888;
  font-weight: 500;
  flex: 1;
}

.results-accordion-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1rem;
  background: #0a0a0a;
  border: none;
  cursor: pointer;
  gap: 1rem;
  transition: background 0.15s;
}
.results-accordion-header:hover { background: #0f0f0f; }
.results-accordion-header.sub {
  padding: 0.65rem 1rem 0.65rem 1.25rem;
  border-top: 1px solid #111;
}

.result-empty {
  color: #333;
  font-size: 0.85rem;
  padding: 0.5rem 0;
}

.accordion-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.accordion-dots {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}
.acc-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}
.acc-dot.pass { background: #2a6a2a; }
.acc-dot.fail { background: #3a1a1a; }

.accordion-summary {
  font-size: 1rem;
  color: #808080;
  white-space: nowrap;
}

.accordion-chevron {
  font-size: 1.1rem;
  color: #808080;
  transform: rotate(0deg);
  transition: transform 0.2s;
  flex-shrink: 0;
}
.accordion-chevron.open { transform: rotate(90deg); }

.results-list {
  border-top: 1px solid #111;
  padding: 0 1rem;
}

.result-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid #0e0e0e;
}

.result-row:last-child { border-bottom: none; }

.result-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.result-dot.pass { background: var(--green); }
.result-dot.fail { background: #808080; }

.result-desc {
  flex: 1;
  font-size: 1.02rem;
  color: #777;
  line-height: 1.4;
}

/* ── Votes page ──────────────────────────────────────────────────────────── */
.votes-page {
  max-width: 560px;
  margin: 0 auto 4rem;
  padding-top: 3rem;
}

.votes-header {
  text-align: center;
  margin-bottom: 2.5rem;
}

.vote-single { display: flex; flex-direction: column; gap: 1rem; }

.vote-progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.vote-progress-bar {
  flex: 1;
  height: 2px;
  background: #111;
  border-radius: 1px;
  overflow: hidden;
}

.vote-progress-fill {
  height: 100%;
  background: #fff;
  border-radius: 1px;
  transition: width 0.3s ease;
}

.vote-progress-label {
  font-size: 1.25rem;
  color: #808080;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.vote-card-single {
  border: 1px solid #1a1a1a;
  border-radius: 10px;
  padding: 1.75rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  animation: fadeUp 0.2s ease-out;
}

.vcs-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.vcs-chain {
  font-size: 1.25rem;
  color: #808080;
  letter-spacing: 0.05em;
}

.vmc-type {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #808080;
  border: 1px solid #1a1a1a;
  padding: 0.15rem 0.45rem;
  border-radius: 3px;
}

.vmc-score {
  font-size: 1.25rem;
  color: #808080;
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.vcs-desc {
  font-size: 1.25rem;
  color: #ccc;
  line-height: 1.6;
  font-weight: 400;
}

.vcs-detail {
  display: flex;
  gap: 1.5rem;
  align-items: baseline;
}

.vcs-detail-label {
  font-size: 1.25rem;
  color: #808080;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
  flex-shrink: 0;
  width: 130px;
}

.vcs-detail-val {
  font-size: 0.94rem;
  color: #808080;
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}

.vcs-code {
  font-size: 0.94rem;
  color: #666;
  font-family: 'JetBrains Mono', monospace;
  background: #080808;
  border: 1px solid #1a1a1a;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.vcs-score-bar {
  height: 2px;
  background: #111;
  border-radius: 1px;
  overflow: hidden;
}

.vcs-score-fill {
  height: 100%;
  background: #808080;
  border-radius: 1px;
}

.vcs-feedback {
  width: 100%;
  margin-top: 0.75rem;
  background: #080808;
  border: 1px solid #1e1e1e;
  border-radius: 6px;
  color: #888;
  font-size: 1rem;
  font-family: inherit;
  padding: 0.5rem 0.65rem;
  resize: none;
  overflow: hidden;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
}
.vcs-feedback::placeholder { color: #808080; }
.vcs-feedback:focus { border-color: #808080; color: #aaa; }

.vcs-actions {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.vcs-btn {
  border: 1px solid #1a1a1a;
  border-radius: 6px;
  padding: 0.65rem 1rem;
  font-size: 1.03rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  background: none;
}

.vcs-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.vcs-btn-yes {
  flex: 1;
  color: var(--green);
  border-color: rgba(34,197,94,0.25);
}
.vcs-btn-yes:hover:not(:disabled) {
  background: rgba(34,197,94,0.07);
  border-color: rgba(34,197,94,0.5);
}

.vcs-btn-no {
  flex: 1;
  color: var(--red);
  border-color: rgba(239,68,68,0.25);
}
.vcs-btn-no:hover:not(:disabled) {
  background: rgba(239,68,68,0.07);
  border-color: rgba(239,68,68,0.5);
}

.vcs-btn-skip {
  color: #808080;
  padding: 0.65rem 1.1rem;
}
.vcs-btn-skip:hover { color: #888; border-color: #808080; }

/* ── Layout ──────────────────────────────────────────────────────────────── */
.app-container {
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Network suggestion banner ───────────────────────────────────────────── */
.net-suggest-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 1.25rem;
  background: #1c1400;
  border-bottom: 1px solid #f59e0b40;
  font-size: 0.82rem;
  color: #fcd34d;
  flex-wrap: wrap;
}
.net-suggest-icon { font-size: 0.9rem; flex-shrink: 0; }
.net-suggest-text { flex: 1; min-width: 0; }
.net-suggest-text strong { color: #fbbf24; font-weight: 600; }
.net-suggest-retry {
  background: #f59e0b22; border: 1px solid #f59e0b60; color: #fbbf24;
  padding: 0.2rem 0.65rem; border-radius: 4px; font-size: 0.78rem; cursor: pointer;
  white-space: nowrap; transition: background 0.15s;
}
.net-suggest-retry:hover { background: #f59e0b44; }
.net-suggest-dismiss {
  background: none; border: none; color: #f59e0b80; font-size: 1rem;
  cursor: pointer; padding: 0 0.25rem; line-height: 1; flex-shrink: 0;
}
.net-suggest-dismiss:hover { color: #fbbf24; }
.net-suggest-feedback { color: #f87171; font-style: italic; }
@keyframes net-spin { to { transform: rotate(360deg); } }
.net-suggest-spinning { display: inline-block; animation: net-spin 0.8s linear infinite; }
.net-suggest-enter-active, .net-suggest-leave-active { transition: max-height 0.25s ease, opacity 0.2s; overflow: hidden; }
.net-suggest-enter-from, .net-suggest-leave-to { max-height: 0; opacity: 0; }
.net-suggest-enter-to, .net-suggest-leave-from { max-height: 60px; opacity: 1; }

/* ── Devnet banner ───────────────────────────────────────────────────────── */
.devnet-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 0rem;
  /* background: #0d0d0d; */
  border-bottom: 1px solid #1a1a1a;
  font-size: 1.25rem;
  flex-wrap: wrap;
}
.devnet-label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #f59e0b;
  background: rgba(245,158,11,0.12);
  border: 1px solid rgba(245,158,11,0.25);
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
  flex-shrink: 0;
}
.devnet-sep { color: #333; flex-shrink: 0; }
.devnet-hint { color: #444; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.devnet-bar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
  flex-shrink: 0;
}
.devnet-faucet-btn {
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.3);
  color: #f59e0b;
  font-size: 0.68rem;
  padding: 0.2rem 0.65rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.devnet-faucet-btn:hover:not(:disabled) {
  background: rgba(245,158,11,0.2);
  border-color: rgba(245,158,11,0.5);
}
.devnet-faucet-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.devnet-faucet-msg { font-size: 0.65rem; }
.devnet-faucet-msg--ok  { color: #4ade80; }
.devnet-faucet-msg--err { color: #f87171; }

/* ── Header ──────────────────────────────────────────────────────────────── */
.header {
  padding: 1rem 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 100;
  background: #000;
  border-bottom: 1px solid #111;
  margin-bottom: 3rem;
}

.logo img {
  height: 64px;
  opacity: 0.9;
}

.nav {
  display: flex;
  gap: 0.25rem;
}

.nav-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1.25rem;
  font-weight: 500;
  padding: 0.5rem 0.9rem;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}

.nav-btn .icon { opacity: 0.7; }

.nav-btn:hover {
  color: #fff;
  background: #111;
}

.nav-btn.active {
  color: #fff;
  background: #fff;
  color: #000;
}

.nav-btn.active .icon { opacity: 1; }

/* ── Wallet ───────────────────────────────────────────────────────────────── */
.wallet-wrapper { display: flex; align-items: center; }

.select-wallet-btn {
  background: #000;
  color: #fff;
  border: none;
  padding: 0.5rem 1.3rem;
  border-radius: 6px;
  font-weight: 600;
  font-size: 1.25rem;
  cursor: pointer;
  transition: opacity 0.15s;
}

.select-wallet-btn:hover { opacity: 0.85; }

.connected-status {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid #1e1e1e;
  padding: 0.45rem 0.9rem;
  border-radius: 6px;
}

.status-indicator {
  width: 5px;
  height: 5px;
  background: var(--green);
  border-radius: 50%;
}

.address-text {
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 1.25rem;
  color: #aaa;
}

.disconnect-link {
  background: none;
  border: none;
  color: #808080;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s;
}

.disconnect-link:hover { color: #aaa; }

/* ── Modal ───────────────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  width: 90%;
  max-width: 512px;
  padding: 1.75rem;
  background: #0c0c0c;
  border: 1px solid #1e1e1e;
  border-radius: 10px;
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  margin-bottom: 1.25rem;
  color: #aaa;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 1.25rem;
}

.wallet-select-modal { max-width: 380px; }
.wallet-list { display: flex; flex-direction: column; gap: 0.5rem; margin: 0.5rem 0 1rem; }

.wallet-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.75rem 1rem;
  background: #0e0e0e;
  border: 1px solid #1e1e1e;
  border-radius: 10px;
  color: #ccc;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  text-align: left;
}
.wallet-option--detected {
  border-color: #1e3a1e;
  color: #fff;
}
.wallet-option:hover {
  background: #161616;
  border-color: #444;
  color: #fff;
}
.wallet-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
}
.wallet-name { flex: 1; }
.wallet-badge {
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  text-transform: uppercase;
}
.wallet-badge--detected { background: #0f2a0f; color: #22c55e; }
.wallet-badge--install  { background: #1a1a1a; color: #808080; }

.modal-close {
  width: 100%;
  padding: 1rem;
  background: none;
  border: 1px solid #1e1e1e;
  color: #808080;
  border-radius: 6px;
  margin-top: 0.25rem;
  cursor: pointer;
  font-size: 1.25rem;
  transition: color 0.15s, border-color 0.15s;
}

.modal-close:hover { color: #aaa; border-color: #808080; }

.modal-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1.5rem;
}
.modal-actions > * { flex: 1; text-align: center; }
.vote-confirm-modal .modal-desc { margin: 0.4rem 0; }
.vote-confirm-warn { color: rgba(239, 68, 68, 0.75) !important; font-size: 0.82rem !important; }
.vote-confirm-human { color: #22c55e; }
.vote-confirm-bot   { color: #ef4444; }
.vote-confirm-comment {
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background: #0d0d0d;
  border: 1px solid #1e1e1e;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.vote-confirm-comment-label {
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  color: #808080;
  text-transform: uppercase;
}
.vote-confirm-comment-text {
  font-size: 1.2rem;
  color: #808080;
  font-style: italic;
  line-height: 1.5;
}
.mlist-feedback {
  font-size: 0.8rem;
  color: #808080;
  font-style: italic;
  padding: 0.2rem 0 0.1rem;
  line-height: 1.4;
}

/* ── Hero ────────────────────────────────────────────────────────────────── */
.hero {
  text-align: center;
  padding: 3.5rem 0 4.5rem;
  max-width: 720px;
  margin: 0 auto;
}

.hero .title {
  font-size: clamp(2.5rem, 7.5vw, 4.06rem);
  line-height: 1.1;
  margin-bottom: 1.25rem;
  color: #fff;
  letter-spacing: -0.04em;
}

.hero .subtitle {
  font-size: 1.25rem;
  color: #808080;
  max-width: 520px;
  margin: 0 auto;
  line-height: 1.7;
}

/* ── Error ───────────────────────────────────────────────────────────────── */
.error-msg {
  background: rgba(239,68,68,0.07);
  border: 1px solid rgba(239,68,68,0.2);
  color: #ef4444;
  padding: 1rem 1rem;
  border-radius: 6px;
  font-size: 1.44rem;
  margin-bottom: 1.25rem;
  cursor: pointer;
  max-width: 700px;
  margin-left: auto;
  margin-right: auto;
}

/* ── Content ─────────────────────────────────────────────────────────────── */
.content-section {
  max-width: 720px;
  margin: 0 auto 5rem;
  animation: fadeUp 0.3s ease-out;
  width: 100%;
  overflow-x: hidden;
  min-width: 0;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ── Input Group ─────────────────────────────────────────────────────────── */
.input-group {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.premium-input,
.premium-select,
.premium-textarea {
  width: 100%;
  background: #080808;
  border: 1px solid #1e1e1e;
  border-radius: 7px;
  padding: 0.6rem 0.85rem;
  color: #e0e0e0;
  font-size: 1rem;
  line-height: 1.4;
  transition: border-color 0.15s, background 0.15s;
  font-family: inherit;
  box-sizing: border-box;
}

.premium-textarea {
  min-height: 80px;
  resize: none;
  overflow: hidden;
  line-height: 1.55;
}

.premium-input::placeholder,
.premium-textarea::placeholder { color: #808080; }

.premium-input:focus,
.premium-select:focus,
.premium-textarea:focus {
  outline: none;
  border-color: #808080;
  background: #0c0c0c;
}

.premium-select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23444'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  padding-right: 2rem;
}

.premium-select option { background: #111; }

.flex-input { display: flex; gap: 0.5rem; align-items: stretch; }

.file-label {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  flex-shrink: 0;
  background: #080808;
  border: 1px solid #1e1e1e;
  border-radius: 7px;
  cursor: pointer;
  color: #808080;
  transition: color 0.15s, border-color 0.15s;
}

.file-label:hover { color: #aaa; border-color: #808080; }
.hidden-input { display: none; }

.file-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  background: #080808;
  border: 1px solid #1e1e1e;
  border-radius: 6px;
}

.file-name { font-size: 1.25rem; color: #666; }

.batch-progress-bar {
  height: 3px;
  background: #1e1e1e;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 0.5rem;
}
.batch-progress-fill {
  height: 100%;
  background: #4ade80;
  transition: width 0.4s ease;
}

.chain-pill-row {
  padding-left: 0.1rem;
}

.chain-pill {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  border: 1px solid;
}

.chain-pill--evm {
  color: #808080;
  border-color: #222;
  background: #0a0a0a;
}

.chain-pill--solana {
  color: #7c4dbb;
  border-color: #2a1a44;
  background: #0c0810;
}

.resolved-display {
  font-size: 1.25rem;
  color: #808080;
  padding-left: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.resolved-address {
  font-family: 'JetBrains Mono', monospace;
  color: #888;
}

/* ── Mini button ─────────────────────────────────────────────────────────── */
.mini-btn {
  background: #080808;
  border: 1px solid #1e1e1e;
  color: #808080;
  padding: 0.6rem 0.85rem;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  font-size: 0.8rem;
  white-space: nowrap;
  flex-shrink: 0;
  align-self: flex-end;
}

.mini-btn:hover { color: #aaa; border-color: #808080; }
.mini-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── ABI picker ──────────────────────────────────────────────────────────── */
.abi-picker {
  border: 1px solid #1e1e1e;
  border-radius: 7px;
  overflow: hidden;
  background: #080808;
}

.abi-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.9rem;
  border-bottom: 1px solid #1a1a1a;
}

.abi-picker-label {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #808080;
}

.abi-picker-count { font-size: 0.72rem; color: #808080; }

.abi-picker-list { max-height: 10rem; overflow-y: auto; }

.abi-fn-btn {
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.9rem;
  background: none;
  border: none;
  border-bottom: 1px solid #111;
  color: #777;
  font-size: 0.8rem;
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.abi-fn-btn:last-child { border-bottom: none; }
.abi-fn-btn:hover { background: #111; color: #fff; }
.abi-fn-btn.selected { background: #111; color: #fff; }

/* ── Cards ───────────────────────────────────────────────────────────────── */
.card {
  padding: 1.25rem 1.5rem;
  margin-bottom: 0.5rem;
}

.section-title {
  font-size: 1.25rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #3a3a3a;
  margin-bottom: 1rem;
  font-weight: 600;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.method-desc {
  font-size: 1.56rem;
  color: #888;
  line-height: 1.4;
}

.card-footer {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.25rem;
  color: #3a3a3a;
}

.icon-success { color: var(--green); flex-shrink: 0; }
.icon-warning { color: var(--red); flex-shrink: 0; }

/* ── Badges ──────────────────────────────────────────────────────────────── */
.status-badge {
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  white-space: nowrap;
  flex-shrink: 0;
}

.status-badge.human {
  background: rgba(34,197,94,0.08);
  color: var(--green);
  border: 1px solid rgba(34,197,94,0.15);
}

.status-badge.ai {
  background: rgba(239,68,68,0.08);
  color: var(--red);
  border: 1px solid rgba(239,68,68,0.15);
}

/* ── Brain card ──────────────────────────────────────────────────────────── */
.brain-card {
  padding: 1.25rem 1.5rem;
  margin-bottom: 1rem;
  border-left: 2px solid #1e1e1e;
}

.brain-card.human { border-left-color: var(--green); }
.brain-card.ai    { border-left-color: var(--red); }

.brain-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.brain-label {
  font-size: 1.25rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 700;
  color: #808080;
  margin-right: 10px;
}

.brain-reasoning {
  font-size: 1.44rem;
  color: #777;
  line-height: 1.5;
  overflow-wrap: break-word;
  word-break: break-word;
}

.brain-analyzing {
  font-size: 1.25rem;
  color: #808080;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 1; }
}

/* ── Votes ───────────────────────────────────────────────────────────────── */
.queue-container { max-width: 520px; margin: 0 auto; }

.method-preview p { color: #666; font-size: 1.19rem; line-height: 1.6; }

.vote-btn-yes {
  background: var(--green) !important;
  color: #000 !important;
}

.vote-btn-no {
  background: var(--red) !important;
  color: #fff !important;
}

/* ── Footer bar ──────────────────────────────────────────────────────────── */
.footer {
  margin-top: auto;
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: #808080;
  font-size: 1.25rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.site-footer {
  padding: 3.25rem 1.5rem;
}


/* ── Vote card ───────────────────────────────────────────────────────────── */
.vote-card {
  padding: 2rem;
}

.vote-queue-label {
  font-size: 1.25rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: #808080;
  font-weight: 700;
  margin-bottom: 1.5rem;
}

.method-preview {
  margin-bottom: 1.75rem;
}

.method-preview p {
  font-size: 1.19rem;
  color: #888;
  line-height: 1.6;
  margin-bottom: 1.25rem;
}

.vote-score-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.vote-score-label { font-size: 1.25rem; color: #808080; }
.vote-score-value { font-size: 1.25rem; color: #666; font-variant-numeric: tabular-nums; }

.vote-actions {
  display: flex;
  gap: 1rem;
}

/* ── Empty state ─────────────────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 5rem 0;
  color: #808080;
  font-size: 1.56rem;
}

/* ── Header right group ──────────────────────────────────────────────────── */
.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* ── Hamburger ───────────────────────────────────────────────────────────── */
.hamburger {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 36px;
  height: 36px;
  background: none;
  border: 1px solid #1e1e1e;
  border-radius: 6px;
  cursor: pointer;
  padding: 0 8px;
}

.hamburger span {
  display: block;
  height: 1.5px;
  background: #888;
  border-radius: 1px;
  transition: all 0.2s ease;
  transform-origin: center;
}

.hamburger.open span:nth-child(1) { transform: translateY(6.5px) rotate(45deg); }
.hamburger.open span:nth-child(2) { opacity: 0; transform: scaleX(0); }
.hamburger.open span:nth-child(3) { transform: translateY(-6.5px) rotate(-45deg); }

/* ── Mobile menu ─────────────────────────────────────────────────────────── */
.mobile-menu {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

.mobile-menu.open {
  opacity: 1;
  pointer-events: all;
}

.mobile-menu-inner {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(280px, 80vw);
  background: #000;
  border-left: 1px solid #1a1a1a;
  padding: 5rem 1.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  transform: translateX(100%);
  transition: transform 0.25s ease;
}

.mobile-menu.open .mobile-menu-inner {
  transform: translateX(0);
}

.mobile-nav-btn {
  background: none;
  border: none;
  color: #666;
  text-align: left;
  font-size: 1.38rem;
  font-weight: 500;
  padding: 0.75rem 0.5rem;
  cursor: pointer;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}

.mobile-nav-btn:hover { color: #fff; background: #0a0a0a; }
.mobile-nav-btn.active { color: #fff; font-weight: 600; }
.mobile-connect { color: #fff; margin-top: 0.25rem; }

.mobile-menu-divider {
  height: 1px;
  background: #111;
  margin: 0.5rem 0;
}

.mobile-wallet-status {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 0.5rem;
}

/* ── Responsive ──────────────────────────────────────────────────────────── */
@media (max-width: 680px) {
  .desktop-nav    { display: none; }
  .desktop-wallet { display: none; }
  .hamburger      { display: flex; }
  .mobile-menu    { display: block; }

  .landing-utilities { grid-template-columns: 1fr; }
  .how-grid { grid-template-columns: 1fr; }
  .form-row { flex-direction: column; }
  .form-col-sm { flex: unset; width: 100%; }
  .form-col-lg { flex: unset; width: 100%; }
  .profile-stats { grid-template-columns: 1fr 1fr; }
  .pricing-table .pt-row { grid-template-columns: 1fr; gap: 0.15rem; }
  .staking-grid { grid-template-columns: 1fr; }
}

/* ── Landing CTA row ─────────────────────────────────────────────────────── */
.landing-cta-row {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 2rem;
}

.outline-btn {
  background: transparent;
  border: 1px solid #808080;
  color: #888;
  padding: 1rem 2rem;
  border-radius: 6px;
  font-size: 1.0625rem;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.outline-btn:hover { border-color: #808080; color: #ccc; }

/* ── Token economics ─────────────────────────────────────────────────────── */
.token-economics {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
  margin: 1.5rem 0 3.75rem 0;
}
.econ-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #111;
  gap: 1rem;
}
.econ-row:last-child { border-bottom: none; }
.econ-label { color: #808080; font-size: 1rem; white-space: nowrap; }
.econ-val { color: #999; font-size: 1rem; text-align: right; }

/* ── Profile page ────────────────────────────────────────────────────────── */
.profile-page { max-width: 800px; margin: 0 auto; padding: 2rem 1rem 4rem; }

.profile-connect-prompt {
  text-align: center;
  padding: 3rem 1rem;
  border: 1px solid #1a1a1a;
  border-radius: 10px;
  margin-top: 2rem;
}
.prompt-text { color: #808080; margin-bottom: 1.25rem; font-size: 1.0625rem; }

.profile-signup-card {
  border: 1px solid #1a1a1a;
  border-radius: 10px;
  padding: 2rem;
  margin-top: 1.5rem;
  text-align: center;
}
.signup-desc { color: #808080; margin-bottom: 1.5rem; line-height: 1.6; }

.profile-error {
  background: #1a0000;
  border: 1px solid #330000;
  color: #ff4444;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 1.3rem;
}

.profile-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin: 1.5rem 0;
}
.pstat-card {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 1.25rem;
  text-align: center;
}
.pstat-card.deposit-stat { cursor: pointer; transition: border-color 0.2s; }
.pstat-card.deposit-stat:hover { border-color: #808080; }
.pstat-deposit-hint { font-size: 0.7rem; color: #808080; margin-left: 0.35rem; }
.pstat-val { font-size: 1.75rem; font-weight: 700; color: #fff; }
.pstat-label { font-size: 0.8125rem; color: #808080; margin-top: 0.25rem; }

.vote-badge { font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 4px; }
.vote-human { color: #2aaa2a; background: #0a1a0a; }
.vote-bot   { color: #aa2a2a; background: #1a0a0a; }

.modal-desc { font-size: 1.2rem; color: #808080; margin: 0.5rem 0 0; line-height: 1.5; }
.deposit-msg { font-size: 1rem; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.75rem; }
.deposit-ok  { color: #2aaa2a; background: #0a1a0a; }
.deposit-err { color: #aa4444; background: #1a0a0a; }

.profile-card {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}
.profile-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
.profile-card-title { font-size: 1.3rem; font-weight: 600; color: #ccc; }

.profile-claim-card { border-color: #1a3a1a; }
.claim-amount { font-size: 1rem; font-weight: 700; color: #5a8a5a; font-family: 'JetBrains Mono', monospace; }
.claim-btn { margin-top: 0.75rem; width: 100%; }
.profile-card-count {
  background: #111;
  border: 1px solid #222;
  color: #666;
  font-size: 0.8125rem;
  padding: 0.15rem 0.5rem;
  border-radius: 20px;
}
.faucet-bar {
  margin: 25px 0px;
}
.apikey-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #050505;
  border: 1px solid #1a1a1a;
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
}
.apikey-display {
  flex: 1;
  font-family: monospace;
  font-size: 1rem;
  color: #888;
  word-break: break-all;
}
.profile-hint { font-size: 0.8125rem; color: #808080; margin-top: 0.5rem; }
.profile-hint code { background: #111; padding: 0.1rem 0.3rem; border-radius: 3px; color: #888; }

.profile-empty { color: #808080; font-size: 1.3rem; display: flex; gap: 0.5rem; align-items: center; }

.method-list-profile { display: flex; flex-direction: column; gap: 0.5rem; }
.mlist-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.75rem;
  background: #050505;
  border: 1px solid #111;
  border-radius: 6px;
  gap: 1rem;
}
.mlist-main { display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0; }
.mlist-type {
  font-size: 0.6875rem;
  font-weight: 700;
  color: #808080;
  background: #0c0c0c;
  border: 1px solid #1e1e1e;
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  white-space: nowrap;
}
.mlist-desc { font-size: 1.3rem; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mlist-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 0.2rem; white-space: nowrap; }
.mlist-score { font-size: 0.8125rem; color: #808080; }
.mlist-earned { font-size: 0.8125rem; color: #888; }

/* ── API page ────────────────────────────────────────────────────────────── */
.api-page { max-width: 900px; margin: 0 auto; padding: 2rem 1rem 4rem; }

.api-section { margin-bottom: 2.5rem; }
.api-section-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #ccc;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #1a1a1a;
  font-family: monospace;
}
.api-card {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
}
.api-desc {
  padding: 1rem 1.25rem;
  color: #666;
  font-size: 1.3rem;
  line-height: 1.6;
  border-bottom: 1px solid #111;
}
.api-desc code { background: #111; padding: 0.1rem 0.3rem; border-radius: 3px; color: #888; font-size: 1rem; }
.api-params { padding: 0.75rem 1.25rem; border-bottom: 1px solid #111; display: flex; flex-direction: column; gap: 0.4rem; }
.param-row { display: flex; align-items: baseline; gap: 0.75rem; font-size: 1.2rem; }
.param-row code { color: #fff; font-size: 1rem; background: #0c0c0c; border: 1px solid #1e1e1e; padding: 0.1rem 0.35rem; border-radius: 3px; white-space: nowrap; }
.param-row span { color: #808080; }

.code-block { border-top: 1px solid #111; }
.code-lang {
  padding: 0.35rem 1.25rem;
  font-size: 0.75rem;
  color: #808080;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: #050505;
  border-bottom: 1px solid #0d0d0d;
}
.code-pre {
  margin: 0;
  padding: 1rem 1.25rem;
  background: #030303;
  color: #888;
  font-size: 1rem;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
}

.pricing-table {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
}
.pt-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid #111;
  font-size: 1.3rem;
  gap: 1rem;
}
.pt-row:last-child { border-bottom: none; }
.pt-head { font-size: 0.8125rem; font-weight: 600; color: #808080; text-transform: uppercase; letter-spacing: 0.05em; background: #050505; }
.pt-free { background: #0a0f0a; color: #5a8a5a; }
.pt-row span:nth-child(2) { color: #aaa; }
.pt-row span:nth-child(3) { color: #808080; }

.api-cta {
  text-align: center;
  padding: 2rem;
  color: #808080;
  font-size: 1.0625rem;
}

/* ── Staking page ────────────────────────────────────────────────────────── */
.staking-page { max-width: 900px; margin: 0 auto; padding: 2rem 1rem 4rem; }

.staking-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  margin-bottom: 2rem;
}
.staking-info-card {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 1.5rem;
}
.si-title { font-size: 1rem; font-weight: 600; color: #ccc; margin-bottom: 1rem; }
.si-list { padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }
.si-list li { color: #666; font-size: 1.3rem; line-height: 1.5; }

.stake-form-card {
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 1.5rem;
}
.stake-form-title { font-size: 1.0625rem; font-weight: 600; color: #ccc; margin-bottom: 1.25rem; }
.stake-message { margin-top: 0.75rem; font-size: 1.3rem; color: #888; }

/* ── Stake balance row ───────────────────────────────────────────────────── */
.stake-balance-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.sbal-item {
  background: #050505;
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 1rem 0.75rem;
  text-align: center;
}
.sbal-val { font-size: 1.25rem; font-weight: 700; color: #fff; }
.sbal-label { font-size: 0.75rem; color: #808080; margin-top: 0.2rem; }
.sbal-claimable .sbal-val { color: #5a8a5a; }

.stake-action-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.max-btn {
  background: none;
  border: 1px solid #222;
  color: #808080;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.4rem 0.6rem;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s;
}
.max-btn:hover { border-color: #808080; color: #aaa; }

.stake-claim-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: #0a0f0a;
  border: 1px solid #1a2a1a;
  border-radius: 8px;
  padding: 1rem 1rem;
  margin-top: 0.5rem;
  margin-bottom: 0.75rem;
}
.claim-desc { font-size: 1.3rem; color: #5a8a5a; }

/* ── Listing fee row ─────────────────────────────────────────────────────── */
.listing-fee-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  font-size: 1.3rem;
}
.listing-fee-label { color: #888; }
.listing-fee-balance { color: #666; }
.listing-fee-balance.insufficient { color: #aa4444; }

@media (max-width: 680px) {
  .stake-balance-row { grid-template-columns: 1fr 1fr; }
  .stake-action-row { flex-wrap: wrap; }
  .stake-claim-row { flex-direction: column; align-items: flex-start; }
}
</style>
