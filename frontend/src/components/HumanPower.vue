<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const emit = defineEmits(['navigate'])
import axios from 'axios'
import BrainGraph from './BrainGraph.vue'
import WalletProfile from './WalletProfile.vue'
import ScannerSection          from './ScannerSection.vue'
import BackgroundParticles      from './BackgroundParticles.vue'
import ListingSection from './ListingSection.vue'
import VoteQueueSection from './VoteQueueSection.vue'
import ProfileSection from './ProfileSection.vue'
import ApiDocsSection from './ApiDocsSection.vue'
import AboutSection from './AboutSection.vue'
import {
  Search, PlusSquare, Vote,
  Activity, SquareArrowDown, PersonStanding, FolderCode, CreditCard, Bitcoin, Waypoints, FingerprintPattern, CandlestickChart,
  FingerprintIcon, FileUp, Trash2, Coins, Info
} from 'lucide-vue-next'
import {
  Transaction,
} from '@solana/web3.js'
import { useWalletConnect } from '../composables/useWalletConnect.js'
import { useConfig } from '../composables/useConfig.js'
import SvgScanner from '../svgs/SvgScanner.vue'
import SvgTradingVolume from '../svgs/SvgTradingVolume.vue'
import SvgIdentityScan from '../svgs/SvgIdentityScan.vue'
import SvgWalletPortrait from '../svgs/SvgWalletPortrait.vue'
import SvgCommunity from '../svgs/SvgCommunity.vue'
import SvgAiBrain from '../svgs/SvgAiBrain.vue'
import SvgApiTooling from '../svgs/SvgApiTooling.vue'
import { useChecker } from '../composables/useChecker.js'
import { useMinerNetwork } from '../composables/useMinerNetwork.js'
import { useVoting } from '../composables/useVoting.js'
import { useListing } from '../composables/useListing.js'
import { useProfile } from '../composables/useProfile.js'
import {
  getPohBalance, getStakeInfo, getGlobalState,
  stakeTokens, unstakeTokens,
  castVote as castVoteOnChain, claimStakerRewards,
} from '../pohProgram.js'

// ── Devnet network suggestion — set to false to disable ───────────────────────
const SUGGEST_DEVNET_NETWORK = false

// ── UI State ──────────────────────────────────────────────────────────────────
const currentSection    = ref('landing')
const mobileMenuOpen    = ref(false)
const walletDropOpen    = ref(false)
const desktopDropOpen   = ref(false)
const desktopDropRef    = ref(null)
const loading = ref(false)
const error = ref(null)

// ── Miner Network setup (declared early so showSection and other early code can reference) ─
const minerNet = useMinerNetwork()
const {
  peers: minerPeers,
  selectedPeer: selectedMinerPeer,
  isDiscovering: minerDiscovering,
  isSubmitting: minerSubmitting,
  lastError: minerLastError,
  discoverPeers: discoverMinerPeers,
  searchOnNetwork: searchOnMinerNetwork,
  postFeedback: minerPostFeedback,
  fetchProfile: minerFetchProfile,
} = minerNet

const minerNodeBase = computed(() => minerNet.getNodeBase())

const useDecentralizedSearch = ref(true)  // when true, "Search" publishes to a miner peer and pulls result

// Auto-discover on load (non-blocking)
onMounted(() => {
  // fire and forget
  discoverMinerPeers().catch(() => {})
})

const showSection = (id) => {
  currentSection.value = id
  mobileMenuOpen.value = false
  if (id === 'checker' && useDecentralizedSearch.value && minerPeers.value.length === 0) {
    discoverMinerPeers()
  }
}

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
    loadPohBalance()
    if (currentSection.value === 'votes') loadVotingFiltered()
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
      params:  { chainId: DEVNET_GENESIS },
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
      params:  { chainId: DEVNET_GENESIS },
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
  scanInput, resolvedInputDisplay, checkerResults, ofacResult, euResult, ukResult, showEvidence,
  brainVerdict, brainPolling, brainKey, batchFile, batchRowCount, batchRows,
  isResolving, detectedChain, faucetLoading, faucetMsg,
  runCheck, handleFileSelect, claimFaucet,
  batchPolling, batchProgress, isBatchScan, inlineScanProfile, vibeData,
  resolveResults, resolveQuery, pickResolveResult,
  resolveToAddress,
  selectedPlatform,
  loading: checkerLoading,
} = checker

// Wrapper: decides between decentralized miner-network path (publish job to peer + pull result)
// and the original central /checker path (with payments, batch support, etc.)
async function doSearch() {
  if (!connected.value) {
    showWalletModal.value = true
    return
  }
  if (!useDecentralizedSearch.value || minerPeers.value.length === 0 || isBatchScan.value) {
    // fall back to full central flow (resolve + optional pay + /checker + brain polling)
    return runCheck()
  }

  // ── Decentralized path ────────────────────────────────────────────────
  checkerLoading.value = true
  isResolving.value = true
  error.value = null
  brainPolling.value = false
  try {
    const resolved = await resolveToAddress(scanInput.value, selectedPlatform.value)
    if (resolved !== scanInput.value.trim()) {
      resolvedInputDisplay.value = resolved
    }
    isResolving.value = false

    const netRes = await searchOnMinerNetwork(resolved)

    // Populate the same refs the rest of the UI (ScannerSection, evidence, brain card, profile) expects
    brainVerdict.value = {
      status: 'done',
      verdict: netRes.verdict,
      confidence: netRes.confidence,
      reasoning: netRes.reasoning,
    }
    brainPolling.value = false

    if (netRes.profile?.address) {
      inlineScanProfile.value = netRes.profile
      walletProfile.value = netRes.profile
    }

    if (netRes.vibeData) {
      vibeData.value = {
        ...netRes.vibeData,
        farcasterData: netRes.farcasterData || null,
        paragraphData: netRes.paragraphData || null,
      }
    }

    const sigs = netRes.evidence?.signalsUsed || netRes.signalsUsed || []
    checkerResults.value = sigs.map(s => ({
      methodId: s.methodId || s.id || 'sig',
      description: s.description || s.methodId || s.id || 'signal',
      result: s.result !== false && s.result != null,
      weight: s.weight || 1,
      details: s.details || null,
      input: resolved,
    }))

    // Fetch brain weights to size evidence map tiles — best-effort, non-blocking
    const nodeBase = minerNetwork.getNodeBase()
    if (nodeBase) {
      fetch(`${nodeBase}/api/brain/weights`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.ok ? r.json() : null)
        .then(weights => {
          if (!weights) return
          checkerResults.value = checkerResults.value.map(s => ({
            ...s,
            weight: weights[s.methodId] ?? s.weight ?? 1,
          }))
        })
        .catch(() => {})
    }

    ofacResult.value = null
    euResult.value = null
    ukResult.value = null

    if (resolved && !netRes.profile?.address) {
      loadWalletProfile(resolved)
    }
    showEvidence.value = true
  } catch (err) {
    if (err.message === 'MULTI_RESULT') {
      isResolving.value = false
      checkerLoading.value = false
      return
    }
    console.warn('[doSearch] miner network failed, falling back to central:', err?.message || err)
    error.value = err?.message || 'Decentralized search failed — falling back to central...'
    try {
      await runCheck()
    } catch (e2) {
      error.value = (error.value || '') + ' | fallback: ' + (e2?.message || '')
    }
  } finally {
    checkerLoading.value = false
    isResolving.value = false
  }
}

watch(useDecentralizedSearch, (on) => {
  if (on && minerPeers.value.length === 0 && !minerDiscovering.value) {
    discoverMinerPeers()
  }
})

// Platform chips — shown below the input when a non-address, non-domain value is typed
const PLATFORM_CHIPS = [
  { id: 'twitter',   icon: '𝕏',  name: 'Twitter'   },
  { id: 'farcaster', icon: '🟣', name: 'Farcaster' },
  { id: 'lens',      icon: '🌿', name: 'Lens'       },
  { id: 'ens',       icon: '◈',  name: 'ENS'        },
  { id: 'github',    icon: '⌥',  name: 'GitHub'     },
]

// Show platform chips when input is a non-empty, non-address, non-domain string
const showPlatformChips = computed(() => {
  const v = scanInput.value?.trim()
  if (!v || !!batchFile.value) return false
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return false
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false
  return true
})

const showEvidencePass = ref(false)
const showEvidenceFail = ref(false)

// ── Wallet profile (loaded after verdict arrives) ─────────────────────────────
const walletProfile        = ref(null)
const walletProfileLoading = ref(false)

async function loadWalletProfile(address) {
  walletProfile.value        = null
  walletProfileLoading.value = true
  try {
    let data
    if (minerNodeBase.value) {
      data = await minerFetchProfile(address)
    } else {
      const res = await axios.get(`/checker/profile/${address}`)
      data = res.data
    }
    // Reject error-shaped responses (e.g. miner returns {error: '...'} with 200)
    if (data && !data.error && (data.address || data.displayName || data.links)) {
      walletProfile.value = data
    } else if (!minerNodeBase.value) {
      // Central backend: fall back to the raw data even if minimal
      walletProfile.value = data?.error ? null : data
    } else {
      // Miner returned error or empty — fall back to central backend
      const res = await axios.get(`/checker/profile/${address}`)
      walletProfile.value = res.data?.error ? null : res.data
    }
  } catch (err) {
    console.warn('[profile] failed to load:', err.message)
    if (minerNodeBase.value) {
      // Miner unreachable — try central backend as fallback
      try {
        const res = await axios.get(`/checker/profile/${address}`)
        walletProfile.value = res.data?.error ? null : res.data
      } catch { /* ignore */ }
    }
  } finally {
    walletProfileLoading.value = false
  }
}

// Load profile in parallel with brain analysis — single scans only, skip batch.
// On cache hits the profile comes inline; on fresh scans fetch it separately.
watch(checkerResults, (results) => {
  walletProfile.value = null
  if (!results?.length || isBatchScan.value) return
  if (inlineScanProfile.value?.address) {
    // Cache hit — profile was returned with the scan response, no extra request needed
    walletProfile.value = inlineScanProfile.value
    return
  }
  const addr = resolvedInputDisplay.value || scanInput.value?.trim()
  if (addr) loadWalletProfile(addr)
})

// ── Batch results summary (group signals by address) ──────────────────────────
const batchSummary = computed(() => {
  if (!isBatchScan.value || !checkerResults.value?.length) return []
  const map = {}
  for (const r of checkerResults.value) {
    const addr = r.input
    if (!addr) continue
    if (!map[addr]) map[addr] = { address: addr, pass: 0, fail: 0, ofac: false, cex: false }
    if (r.methodId === 'ofac_check') { map[addr].ofac = true; continue }
    if (r.methodId === 'cex_check')  { map[addr].cex  = true; continue }
    if (r.result) map[addr].pass++
    else map[addr].fail++
  }
  return Object.values(map)
})

function downloadBatchCsv() {
  if (!batchSummary.value.length) return
  const rows = [['address', 'pass', 'fail', 'total', 'ofac_sanctioned', 'cex_wallet']]
  for (const a of batchSummary.value) {
    rows.push([a.address, a.pass, a.fail, a.pass + a.fail, a.ofac, a.cex])
  }
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const el   = document.createElement('a')
  el.href = url; el.download = 'poh_batch_results.csv'; el.click()
  URL.revokeObjectURL(url)
}

function handleProfileScan(addr) {
  // Clear batch state so a single-wallet scan runs
  batchFile.value = null
  batchRowCount.value = 0
  batchRows.value = []
  scanInput.value = addr
  runCheck()
}

function fmtAddr(addr) {
  if (!addr || addr.length < 10) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

// ── Verdict feedback ──────────────────────────────────────────────────────────
const feedbackSent      = ref(false)
const feedbackSubmitting = ref(false)

async function submitFeedback(correction, comment = '') {
  if (feedbackSubmitting.value || feedbackSent.value || !brainVerdict.value) return
  feedbackSubmitting.value = true
  const address   = resolvedInputDisplay.value || scanInput.value
  const aiVerdict = brainVerdict.value.verdict
  const signals   = (checkerResults.value || []).map(s => ({
    methodId: s.methodId, result: s.result, description: s.description,
  }))
  try {
    if (minerNodeBase.value) {
      await minerPostFeedback(address, aiVerdict, correction, comment || '', signals)
    } else {
      await axios.post('/checker/feedback', {
        brainKey: brainKey.value, address, aiVerdict, correction,
        comment: comment || undefined,
      })
    }
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
const voting = useVoting({ walletAddress, connected, adapterSignMessage, nodeBase: minerNodeBase })
const {
  votingList, voteIndex, voteSubmitting, voteFeedback,
  voteConfirmPending, feedbackValidating, currentVoteItem, myVotesData,
  loadVoting, castVote, confirmVote, loadMyVotes, fetchMethodsForGraph,
} = voting

watch(voting.error, val => { if (val) error.value = val })

async function loadVotingFiltered() {
  await loadVoting()
}

const exprExpanded = ref(false)
watch(currentVoteItem, () => { exprExpanded.value = false })

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

const miningCanvas  = ref(null)
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
  if (!walletAddress.value || !POH_MINT.value || !SOLANA_RPC.value) return
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
  showDepositModal, depositAmount, depositToken, depositLoading, depositMsg,
  upgradeToken,
  loadProfile, signupProfile, rotateApiKey, submitDeposit,
  upgradeToStartup,
} = profile

async function upgradeToStartupPlan() {
  if (!connected.value) {
    error.value = 'Please connect your wallet first'
    return
  }
  signupLoading.value = true
  try {
    const success = await upgradeToStartup()
    if (success) {
      await loadProfile()
      // Optional: show success message
    }
  } finally {
    signupLoading.value = false
  }
}

// ── Referral / deep-link URL params ──────────────────────────────────────────
const referralWallet = ref(null)

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

// Helper to safely append common TON argument examples
function appendTonArg(type) {
  let example = '';
  if (type === 'int') {
    example = '{"type":"int","value":"0"}';
  } else if (type === 'slice') {
    example = '{"type":"slice","value":"EQ..."}';
  } else if (type === 'cell') {
    example = '{"type":"cell","value":""}';
  }

  try {
    let current = listing.value.tonArgs ? JSON.parse(listing.value.tonArgs) : [];
    if (!Array.isArray(current)) current = [];
    current.push(JSON.parse(example));
    listing.value.tonArgs = JSON.stringify(current, null, 2);
  } catch {
    // If parse fails, just set the example
    listing.value.tonArgs = '[' + example + ']';
  }
}

// ── Watchers ──────────────────────────────────────────────────────────────────
watch(walletAddress, (addr) => {
  if (addr) loadPohBalance()
  if (addr) loadProfile()
})

function onDocClick(e) {
  if (desktopDropOpen.value && desktopDropRef.value && !desktopDropRef.value.contains(e.target)) {
    desktopDropOpen.value = false
  }
}

// ── Mining canvas animation (matches miner landing mesh) ─────────────────────
let _miningRaf = null
function startMiningCanvas() {
  const canvas = miningCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d', { alpha: true })
  let width, height, nodes = []

  function resize() {
    width  = canvas.offsetWidth
    height = canvas.offsetHeight
    canvas.width  = width  * 2
    canvas.height = height * 2
    ctx.scale(2, 2)
  }
  resize()

  const COUNTRIES = ['GE','SG','US','DE','JP','BR','AU','IN']
  nodes = Array.from({ length: 42 }, (_, i) => ({
    x:       Math.random() * width,
    y:       Math.random() * height,
    vx:      (Math.random() - 0.5) * 0.6,
    vy:      (Math.random() - 0.5) * 0.6,
    radius:  2.5 + Math.random() * 2,
    country: COUNTRIES[i % 8],
  }))

  function frame() {
    ctx.clearRect(0, 0, width, height)
    nodes.forEach(n => {
      n.x += n.vx; n.y += n.vy
      if (n.x < 0 || n.x > width)  n.vx *= -1
      if (n.y < 0 || n.y > height) n.vy *= -1
    })
    ctx.strokeStyle = 'rgba(34,197,94,0.15)'
    ctx.lineWidth = 1
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        if (dx*dx + dy*dy < 180*180) {
          ctx.beginPath()
          ctx.moveTo(nodes[i].x, nodes[i].y)
          ctx.lineTo(nodes[j].x, nodes[j].y)
          ctx.stroke()
        }
      }
    }
    nodes.forEach(n => {
      ctx.fillStyle = ['GE','DE','FR'].includes(n.country) ? '#22c55e' : 'rgba(255,255,255,0.85)'
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
      ctx.fill()
    })
    _miningRaf = requestAnimationFrame(frame)
  }
  frame()
}

onMounted(async () => {
  await fetchConfig()
  // Parse referral and deep-link signal from URL
  const params   = new URLSearchParams(window.location.search)
  const ref      = params.get('ref')
  const signalId = params.get('signal')
  if (ref) referralWallet.value = ref
  if (signalId) {
    showSection('votes')
    await loadVotingFiltered()
    await jumpToMethod(signalId)
  }
  if (currentSection.value === 'votes') loadVotingFiltered()
  if (connected.value || walletAddress.value) loadPohBalance()
  fetchMethodsForGraph()
  startNetAnim()
  startMiningCanvas()
  document.addEventListener('click', onDocClick)
})

onUnmounted(() => {
  if (_netTimer) clearInterval(_netTimer)
  if (_miningRaf) cancelAnimationFrame(_miningRaf)
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div class="hp-root">
    <!-- Devnet banner (hidden on mainnet) -->
    <div v-if="false" class="devnet-bar">
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
      <div @click="emit('navigate', 'landing')" class="logo">
        <img src="/poh-icon.png" alt="POH Logo">
      </div>

      <!-- Desktop nav -->
      <nav class="nav desktop-nav">
        <button class="nav-btn nav-btn--back" @click="emit('navigate', 'landing')">← Back</button>
        <button :class="['nav-btn', { active: currentSection === 'checker' }]" @click="showSection('checker')">
          <Search class="icon" :size="14" /> Scan
        </button>
        <button :class="['nav-btn', { active: currentSection === 'votes' }]" @click="showSection('votes'); loadVotingFiltered()">
          <Vote class="icon" :size="14" /> Vote
        </button>
        <button :class="['nav-btn', { active: currentSection === 'listing' }]" @click="showSection('listing')">
          <PlusSquare class="icon" :size="14" /> Add signal
        </button>
        <button :class="['nav-btn', { active: currentSection === 'staking' }]" @click="showSection('staking')">
          <Coins class="icon" :size="14" /> Staking
        </button>
        <button :class="['nav-btn', { active: currentSection === 'about' }]" @click="showSection('about')">
          <Info class="icon" :size="14" /> About
        </button>
      </nav>

      <div class="header-right">
        <!-- Desktop wallet -->
        <div class="wallet-wrapper desktop-wallet">
          <button v-if="!connected" @click="showWalletModal = true" class="select-wallet-btn">
            Connect Wallet
          </button>
          <div v-else class="wallet-dropdown-wrapper" ref="desktopDropRef">
            <button class="connected-status" @click="desktopDropOpen = !desktopDropOpen">
              <div class="status-indicator"></div>
              <span class="address-text">{{ shortAddress }}</span>
            </button>
            <div class="wallet-dropdown" v-show="desktopDropOpen">
              <button class="wallet-drop-item" @click="showSection('profile'); loadProfile(); loadMyVotes(); desktopDropOpen = false">Profile</button>
              <button class="wallet-drop-item" @click="showSection('dev'); desktopDropOpen = false">Dev</button>
              <button class="wallet-drop-item wallet-drop-disconnect" @click="disconnectWallet(); desktopDropOpen = false">Disconnect</button>
            </div>
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
        <button class="mobile-nav-btn" @click="emit('navigate', 'landing'); mobileMenuOpen = false">← Back</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'checker' }]" @click="showSection('checker')">Scan</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'votes' }]" @click="showSection('votes'); loadVotingFiltered()">Vote</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'listing' }]" @click="showSection('listing')">Add signal</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'staking' }]" @click="showSection('staking')">Staking</button>
        <button :class="['mobile-nav-btn', { active: currentSection === 'about' }]" @click="showSection('about')">About</button>
        <div class="mobile-menu-divider"></div>
        <button v-if="!connected" @click="showWalletModal = true; mobileMenuOpen = false" class="mobile-nav-btn mobile-connect">
          Connect Wallet
        </button>
        <template v-else>
          <button class="mobile-wallet-status" @click="walletDropOpen = !walletDropOpen">
            <div class="status-indicator"></div>
            <span class="address-text">{{ shortAddress }}</span>
            <span class="wallet-drop-chevron" :class="{ open: walletDropOpen }">›</span>
          </button>
          <div v-if="walletDropOpen" class="mobile-wallet-drop">
            <button class="mobile-wallet-drop-item" @click="showSection('profile'); loadProfile(); loadMyVotes(); mobileMenuOpen = false; walletDropOpen = false">Profile</button>
            <button class="mobile-wallet-drop-item" @click="showSection('dev'); mobileMenuOpen = false; walletDropOpen = false">Dev</button>
            <button class="mobile-wallet-drop-item mobile-wallet-drop-disconnect" @click="disconnectWallet(); mobileMenuOpen = false; walletDropOpen = false">Disconnect</button>
          </div>
        </template>
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

    <!-- Deposit Modal -->
    <div v-if="showDepositModal" class="modal-overlay" @click.self="showDepositModal = false">
      <div class="glass-panel modal">
        <h3 class="modal-title">Deposit to API Balance</h3>
        <p class="modal-desc">Top up your off-chain scan credits. 1,000 scans = $1.</p>
        <div class="token-toggle" style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
          <button :class="['token-btn', depositToken === 'USDC' && 'token-btn--active']" @click="depositToken = 'USDC'">USDC</button>
          <button :class="['token-btn', depositToken === 'USDT' && 'token-btn--active']" @click="depositToken = 'USDT'">USDT</button>
        </div>
        <div class="flex-input" style="margin:0.5rem 0 1rem">
          <input type="number" v-model="depositAmount" :placeholder="`Amount in ${depositToken}`" class="premium-input flex-grow" min="0.001" step="0.001" />
        </div>
        <div v-if="depositMsg" :class="['deposit-msg', depositMsg.includes('✓') ? 'deposit-ok' : 'deposit-err']">{{ depositMsg }}</div>
        <button class="submit-listing-btn" :disabled="depositLoading || !depositAmount" @click="submitDeposit()">
          {{ depositLoading ? 'Sending...' : `Send ${depositToken}` }}
        </button>
        <button class="modal-close" @click="showDepositModal = false; depositMsg = null">Cancel</button>
      </div>
    </div>

    <div class="app-container">
    <main class="main">
      <div v-if="error" class="error-msg" @click="error = null">{{ error }}</div>

      <!-- Landing -->
      <div v-if="currentSection === 'landing'" class="landing">

        <!-- Problem screen (hero with live wallet particle background) -->
        <section class="problem-screen">
          <BackgroundParticles />
          <div class="problem-inner problem-inner--above">
            <h2 class="problem-title">AI-powered Digital Identities</h2>
            <button class="neon-btn" @click="showSection('checker')">Search →</button>
          </div>
        </section>

        <!-- Benefit section -->
        <section class="benefit-section">
          <div class="benefit-header">
          </div>
          <div class="benefit-cards">
            <!-- Trading volume: animated candlestick chart -->
            <div class="benefit-card">
              <SvgTradingVolume class="benefit-svg" />
              <p class="benefit-label">Detect Fake and real<br>Trading Volume</p>
            </div>

            <!-- Bot/Human classification: scanning fingerprint -->
            <div class="benefit-card">
              <SvgIdentityScan class="benefit-svg" />
              <p class="benefit-label">Proof of Personhood<br>and Access Control</p>
            </div>

            <!-- AI portrait: wallet → signals → profile -->
            <div class="benefit-card">
              <SvgWalletPortrait />
              <p class="benefit-label">AML, KYC, KYB</p>
            </div>
          </div>
        </section>

        <section class="feat-screen feat-screen--alt">
          <div class="feat-right display-block">
            
            <div>
              <h2 class="net-subtitle">
                {{ votingList.length || '—' }} signals are live.
              </h2>
            </div>

            <BrainGraph :methods="votingList" />

          </div>
          <div class="feat-left">
            <h2 class="feat-title">Search</h2>
            <p class="feat-body">Search for any identity and see the evidence from every imaginable layer.</p>
            <button class="feat-cta" @click="showSection('checker')">Search →</button>
          </div>
        </section>

        <section class="feat-screen feat-screen--alt">
          <div class="feat-right">
            <SvgIdentityScan class="benefit-svg" />
          </div>
          <div class="feat-left">
            <h2 class="feat-title">You decide what<br>counts as human</h2>
            <p class="feat-body">Every detection signal goes through community consensus.</p>
            <button class="feat-cta" @click="showSection('votes'); loadVotingFiltered()">Vote →</button>
          </div>
        </section>

        <section class="feat-screen">
          <div class="feat-left">
            <h2 class="feat-title">Dev Ready</h2>
            <p class="feat-body">SDK, API, Widget for your choice. First 100 scans free.</p>
            <button class="feat-cta" @click="showSection('dev')">API Reference →</button>
          </div>
          <div class="feat-right">

            <SvgApiTooling />

          </div>
        </section>

        <!-- Plans teaser (added per task 2.md) -->
        <section class="plans-teaser">
          <h2 class="feat-title" style="text-align:center; margin-bottom: 0.5rem;">Choose your plan</h2>
          <div class="plans-grid">
            <div class="plan-card">
              <div class="plan-name">Free</div>
              <div class="plan-price">$0</div>
              <ul class="plan-features">
                <li>100 scans per wallet (lifetime)</li>
                <li>Standard speed</li>
                <li>Community signals</li>
              </ul>
              <div class="plan-note">Great for testing &amp; individuals</div>
            </div>
            <div class="plan-card plan-popular">
              <div class="plan-name">Startup <span class="badge">Most popular</span></div>
              <div class="plan-price">$1,000 <span class="per">/mo</span></div>
              <ul class="plan-features">
                <li>100,000 scans included</li>
                <li>Priority queue</li>
                <li>$0.015 per extra scan</li>
                <li>API + SDK access</li>
              </ul>
              <button class="plan-cta" @click="showSection('profile'); loadProfile()">Upgrade →</button>
            </div>
            <div class="plan-card">
              <div class="plan-name">Enterprise</div>
              <div class="plan-price">Custom</div>
              <ul class="plan-features">
                <li>Multi-million scan quotas</li>
                <li>Dedicated support</li>
                <li>Custom signals &amp; SLAs</li>
                <li>Private deployments</li>
              </ul>
              <a href="https://calendly.com/poh_network" target="_blank" class="plan-cta secondary">Contact us</a>
            </div>
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
                <div class="roadmap-desc" style="color: #fff">Detection signals R&D</div>
              </div>
            </div>
            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date" style="color: #fff">May-Jun 2026</div>
                <div class="roadmap-desc" style="color: #fff">Digital Identity Search</div>
                <div class="roadmap-desc" style="color: #fff">SDK, Widget, Dev tools</div>
                <div class="roadmap-desc" style="color: #fff">Skills layer launch</div>
              </div>
            </div>
            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date" style="color: #fff">Jun-Jul 2026</div>
                <div class="roadmap-desc" style="color: #fff">Bitcoin, Tron, TON, XLM integration</div>
                <div class="roadmap-desc" style="color: #fff">POH Miner testnet launch</div>
              </div>
            </div>

            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date">Jul-Aug 2026</div>
                <div class="roadmap-desc">Trading analysis</div>
              </div>
            </div>
            
            <div class="roadmap-item">
              <div class="roadmap-dot"></div>
              <div class="roadmap-content">
                <div class="roadmap-date">Aug-Sep 2026</div>
                <div class="roadmap-desc">Getting smarter...</div>
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
          <h2 class="scan-title">AI-powered Identities</h2>
          <p class="scan-sub">Search by cryptocurrency wallet address, Web3 domain names, X profiles or names</p>
        </div>

        <div class="scan-box">
          <div class="scan-input-row">
            <input
              type="text"
              v-model="scanInput"
              :disabled="!!batchFile"
              placeholder="Type to search"
              class="scan-input"
              @keydown.enter="runCheck"
            />
            <label class="scan-upload" title="Upload CSV batch">
              <input type="file" @change="handleFileSelect" accept=".csv" class="hidden-input" />
              <FileUp :size="16" />
            </label>
          </div>
          <!-- Platform chips — search by specific network -->
          <div v-if="showPlatformChips" class="platform-chips">
            <button
              v-for="p in PLATFORM_CHIPS"
              :key="p.id"
              :class="['platform-chip', { active: selectedPlatform === p.id }]"
              @click="selectedPlatform = selectedPlatform === p.id ? null : p.id"
              :title="'Search on ' + p.name"
            >
              <span class="platform-chip-icon">{{ p.icon }}</span>
              <span class="platform-chip-name">{{ p.name }}</span>
            </button>
          </div>

          <div v-if="resolvedInputDisplay" class="resolved-display">
            ↳ <span class="resolved-address">{{ resolvedInputDisplay }}</span>
          </div>

          <!-- Multi-result resolve picker -->
          <div v-if="resolveResults?.length" class="resolve-picker">
            <div class="resolve-picker-title">
              Multiple matches for <strong>{{ resolveQuery }}</strong> — pick one:
            </div>
            <button
              v-for="hit in resolveResults"
              :key="hit.address"
              class="resolve-hit"
              @click="pickResolveResult(hit)"
            >
              <img v-if="hit.avatar" :src="hit.avatar" class="resolve-hit-avatar"
                   @error="e => e.target.style.display='none'" />
              <span class="resolve-hit-icon" v-else>👤</span>
              <div class="resolve-hit-info">
                <span class="resolve-hit-name">{{ hit.displayName || hit.handle || hit.address }}</span>
                <span class="resolve-hit-sub">
                  {{ hit.platform ? hit.platform + ' · ' : '' }}{{ hit.address.slice(0,10) }}…{{ hit.address.slice(-6) }}
                </span>
              </div>
            </button>
          </div>
          <div v-if="batchFile" class="file-info">
            <span class="file-name">{{ batchFile.name }} — {{ batchRowCount }} addresses</span>
            <button @click="batchFile = null; batchRowCount = 0; batchRows = []" class="mini-btn"><Trash2 :size="12" /></button>
          </div>

          <!-- Miner Network discovery + toggle (when enabled, Search publishes job to a peer and pulls verdict/result) -->
          <!-- <div class="miner-net-row">            
            <button class="mini-btn" @click="discoverMinerPeers" :disabled="minerDiscovering" title="Refresh peer list from bootnode">
              {{ minerDiscovering ? '…' : '↻' }}
            </button>
            <span v-if="minerPeers.length" class="miner-net-count">{{ minerPeers.length }} peers</span>
            <span v-else class="miner-net-count muted">no peers yet</span>

            <select v-if="minerPeers.length" v-model="selectedMinerPeer" class="miner-peer-select" title="Choose which verified miner node to publish the job to">
              <option v-for="p in minerPeers" :key="p.wallet" :value="p">
                {{ (p.wallet || '').slice(0, 8) }}@{{ p.host }}:{{ p.walletApiPort || 3456 }} {{ p.verified ? '✓' : '' }}
              </option>
            </select>

            <span v-if="minerLastError" class="miner-net-err">{{ minerLastError }}</span>
          </div> -->

          <button class="submit-listing-btn" @click="connected ? doSearch() : showWalletModal = true"
                  :disabled="checkerLoading || isResolving || brainPolling || batchPolling || minerSubmitting || minerDiscovering || (checkerResults && !batchFile && !brainVerdict?.reasoning)">
            {{ isResolving ? 'Resolving...' : checkerLoading ? 'Scanning...' : batchPolling ? `Analyzing… (${batchProgress?.done ?? 0}/${batchProgress?.total ?? '?'})` : (brainPolling || (checkerResults && !brainVerdict?.reasoning)) ? 'AI analyzing...' : minerSubmitting ? 'Publishing to network…' : minerDiscovering ? 'Discovering peers…' : batchFile ? 'Scan Batch' : connected ? 'Search' : 'Connect Wallet' }}
          </button>
          <div v-if="batchPolling && batchProgress" class="batch-progress-bar">
            <div class="batch-progress-fill" :style="{ width: (batchProgress.percent ?? 0) + '%' }"></div>
          </div>
        </div>

        <div v-if="!isBatchScan && brainPolling && !brainVerdict" class="brain-card brain-pending">
          <span class="brain-label">AI Analysis</span>
          <span class="brain-analyzing">processing evidence...</span>
        </div>

        <div v-if="checkerLoading || batchPolling" class="evidence-loading">
          <div class="evidence-loading-bar"></div>
          <span class="evidence-loading-label">Running signals…</span>
        </div>

        <!-- ── Batch results table ─────────────────────────────────────────── -->
        <div v-if="isBatchScan && batchSummary.length" class="batch-results">
          <div class="batch-results-header">
            <span class="batch-results-title">Results — {{ batchSummary.length }} addresses</span>
            <button class="batch-download-btn" @click="downloadBatchCsv">↓ CSV</button>
          </div>
          <div class="batch-table">
            <div class="batch-table-head">
              <span class="bt-col bt-addr">Address</span>
              <span class="bt-col bt-num">✓ Pass</span>
              <span class="bt-col bt-num">✗ Fail</span>
              <span class="bt-col bt-flags">Flags</span>
              <span class="bt-col bt-action"></span>
            </div>
            <div v-for="row in batchSummary" :key="row.address"
                 :class="['batch-table-row', row.ofac ? 'batch-row-danger' : row.cex ? 'batch-row-warn' : '']">
              <span class="bt-col bt-addr">
                <span class="bt-addr-text" :title="row.address">{{ fmtAddr(row.address) }}</span>
              </span>
              <span class="bt-col bt-num bt-pass-val">{{ row.pass }}</span>
              <span class="bt-col bt-num bt-fail-val">{{ row.fail }}</span>
              <span class="bt-col bt-flags">
                <span v-if="row.ofac" class="batch-flag batch-flag-ofac">⛔ OFAC</span>
                <span v-if="row.cex"  class="batch-flag batch-flag-cex">🏦 CEX</span>
                <span v-if="!row.ofac && !row.cex" class="batch-flag batch-flag-none">—</span>
              </span>
              <span class="bt-col bt-action">
                <button class="batch-scan-btn" @click="handleProfileScan(row.address)">Scan</button>
              </span>
            </div>
          </div>
        </div>

        <!-- OFAC sanctions warning — shown whenever ofacResult.sanctioned is true -->
        <div v-if="!isBatchScan && ofacResult?.sanctioned" class="ofac-card">
          <div class="ofac-row">
            <span class="ofac-icon">⛔</span>
            <span class="ofac-title">OFAC SANCTIONED</span>
          </div>
          <p class="ofac-body">
            <template v-if="ofacResult.type === 'counterparty'">
              Counterparty <code class="ofac-addr">{{ ofacResult.matchedAddress }}</code> appears on the U.S. Treasury SDN list.
            </template>
            <template v-else>
              This address appears on the U.S. Treasury SDN list.
            </template>
          </p>
          <div class="ofac-meta">
            Entity: <strong>{{ ofacResult.name }}</strong> &nbsp;·&nbsp; Program: <strong>{{ ofacResult.program }}</strong>
          </div>
        </div>

        <!-- AI Verdict -->
        <div v-if="!isBatchScan && brainVerdict && brainVerdict.status !== 'not_found'" class="brain-card" :class="brainVerdict.verdict === 'HUMAN' ? 'brain-human' : 'brain-bot'">
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

        <!-- Social Vibe — single scans only -->
        <div v-if="!isBatchScan && vibeData && brainVerdict" class="vibe-card">
          <div class="vibe-header">
            <span class="vibe-label">SOCIAL VIBE</span>
            <div class="vibe-sources">
              <span v-for="src in vibeData.sources" :key="src" class="vibe-source-pill">{{ src }}</span>
            </div>
          </div>
          <p class="vibe-text">{{ vibeData.vibe }}</p>
          <div v-if="vibeData.topics?.length" class="vibe-topics">
            <span v-for="t in vibeData.topics" :key="t" class="vibe-topic">{{ t }}</span>
          </div>
          <ul v-if="vibeData.humanSignals?.length" class="vibe-signals">
            <li v-for="s in vibeData.humanSignals" :key="s">{{ s }}</li>
          </ul>
          <!-- Farcaster casts preview -->
          <div v-if="vibeData.farcasterData?.casts?.length" class="vibe-casts">
            <div class="vibe-casts-label">Recent Farcaster casts</div>
            <div v-for="(c, i) in vibeData.farcasterData.casts.slice(0,3)" :key="i" class="vibe-cast">
              <span class="vibe-cast-text">{{ c.text }}</span>
              <span v-if="c.likes || c.replies" class="vibe-cast-meta">{{ c.likes ? `♥${c.likes}` : '' }}{{ c.replies ? ` · ${c.replies} replies` : '' }}</span>
            </div>
          </div>
          <!-- Paragraph posts preview -->
          <div v-if="vibeData.paragraphData?.posts?.length" class="vibe-articles">
            <div class="vibe-casts-label">Paragraph articles</div>
            <div v-for="(p, i) in vibeData.paragraphData.posts.slice(0,3)" :key="i" class="vibe-article">
              <span class="vibe-article-title">{{ p.title }}</span>
              <span v-if="p.subtitle" class="vibe-article-sub"> — {{ p.subtitle }}</span>
            </div>
          </div>
        </div>

        <!-- Wallet Profile — single scans only -->
        <div v-if="!isBatchScan && walletProfileLoading && brainVerdict" class="profile-loading">
          <span class="profile-loading-dot" /><span class="profile-loading-dot" /><span class="profile-loading-dot" />
          <span style="color:#6b7280;font-size:13px;margin-left:8px;">Loading profile…</span>
        </div>
        <div v-if="!isBatchScan && walletProfile && brainVerdict" class="profile-card-wrap">
          <WalletProfile
            :profile="walletProfile"
            :verdict="brainVerdict"
            :ofac="ofacResult"
            :eu="euResult"
            :uk="ukResult"
            :signals="checkerResults"
            :vibe-data="vibeData"
            @scan="handleProfileScan"
          />
        </div>
      </div>

      <!-- Listing -->
      <div v-if="currentSection === 'listing'" class="content-section">
        <div class="listing-header">
          <h2 class="scan-title">Submit a detection signal</h2>
          <p class="scan-sub">Submit a human or bot detection signals.</p>
        </div>
        <div class="form-section">
          <div class="form-label-row">
            <span class="form-section-label">Method Type</span>
          </div>
          <div class="type-tabs">
            <button :class="['type-tab', { active: listing.type === 'evm' }]" @click="listing.type = 'evm'; abiFns = []">EVM Contract</button>
            <button :class="['type-tab', { active: listing.type === 'solana' }]" @click="listing.type = 'solana'; abiFns = []">Solana Program</button>
            <button :class="['type-tab', { active: listing.type === 'rest' }]" @click="listing.type = 'rest'; abiFns = []">REST API</button>
            <button :class="['type-tab', { active: listing.type === 'ton' }]" @click="listing.type = 'ton'; abiFns = []">TON Contract</button>
            <button :class="['type-tab', { active: listing.type === 'tron' }]" @click="listing.type = 'tron'; abiFns = []">TRON Contract</button>
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

        <!-- TON Contract fields (new) -->
        <div v-if="listing.type === 'ton'" class="form-section">
          <div class="form-label-row"><span class="form-section-label">TON Smart Contract</span></div>
          <div class="input-group">
            <div>
              <label class="field-label">Contract Address</label>
              <input type="text" v-model="listing.address" placeholder="EQ..." class="premium-input font-mono" />
            </div>
            <div class="form-row">
              <div class="form-col">
                <label class="field-label">Get Method <span class="field-hint-inline">e.g. get_nft_data</span></label>
                <input type="text" v-model="listing.method" placeholder="get_nft_data" class="premium-input font-mono" />
              </div>
            </div>
            <div>
              <label class="field-label">
                Arguments (JSON array of objects) 
                <span class="field-hint-inline">e.g. [{"type":"int","value":"12345"}, {"type":"slice","value":"..."}]</span>
              </label>
              <textarea v-model="listing.tonArgs" placeholder='[{"type":"int","value":"12345"}]' class="premium-textarea font-mono" rows="2"></textarea>

              <!-- Helper for common TON argument types -->
              <div style="margin-top: 4px; font-size: 0.75rem;">
                <span style="color:#888;">Quick add:</span>
                <button type="button" class="mini-btn" style="margin-left:4px; font-size:0.7rem; padding:1px 6px;" 
                        @click="appendTonArg('int')">
                  + int
                </button>
                <button type="button" class="mini-btn" style="font-size:0.7rem; padding:1px 6px;" 
                        @click="appendTonArg('slice')">
                  + slice/address
                </button>
                <button type="button" class="mini-btn" style="font-size:0.7rem; padding:1px 6px;" 
                        @click="appendTonArg('cell')">
                  + cell
                </button>
                <button type="button" class="mini-btn" style="font-size:0.7rem; padding:1px 6px;" 
                        @click="listing.tonArgs = '[]'">
                  Clear
                </button>
              </div>
              <div style="font-size: 0.65rem; color:#666; margin-top:2px;">
                Common types: <code>int</code>, <code>slice</code> (for addresses), <code>cell</code>. 
                See TonAPI docs for full list. Complex values may need hex/base64 encoding.
              </div>
            </div>
            <div class="form-row">
              <div class="form-col-sm">
                <label class="field-label">Decimals</label>
                <input type="number" v-model="listing.decimals" placeholder="9" class="premium-input" />
              </div>
            </div>
          </div>
        </div>

        <!-- TRON Contract fields (new) -->
        <div v-if="listing.type === 'tron'" class="form-section">
          <div class="form-label-row"><span class="form-section-label">TRON Smart Contract (TRC20 / Custom)</span></div>
          <div class="input-group">
            <div>
              <label class="field-label">Contract Address</label>
              <input type="text" v-model="listing.address" placeholder="T..." class="premium-input font-mono" />
            </div>
            <div class="form-row">
              <div class="form-col">
                <label class="field-label">Method <span class="field-hint-inline">e.g. balanceOf</span></label>
                <input type="text" v-model="listing.method" placeholder="balanceOf" class="premium-input font-mono" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-col">
                <label class="field-label">Input Types <span class="field-hint-inline">JSON e.g. ["address"]</span></label>
                <input type="text" v-model="listing.abiTypes" placeholder='["address"]' class="premium-input font-mono" />
              </div>
              <div class="form-col">
                <label class="field-label">Return Types <span class="field-hint-inline">JSON e.g. ["uint256"]</span></label>
                <input type="text" v-model="listing.returnTypes" placeholder='["uint256"]' class="premium-input font-mono" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-col-sm">
                <label class="field-label">Decimals</label>
                <input type="number" v-model="listing.decimals" placeholder="6" class="premium-input" />
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

            <!-- Supported Networks for REST (Task request) -->
            <div v-if="listing.type === 'rest'" style="margin-top: 0.75rem;">
              <div class="form-label-row">
                <span class="field-label">Supported Networks <span class="field-hint-inline">(check all that apply)</span></span>
              </div>
              <div style="display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.85rem;">
                <label v-for="net in ['evm', 'solana', 'bitcoin', 'tron', 'ton', 'xlm']" :key="net" style="display: flex; align-items: center; gap: 4px; background: #1a1a1a; padding: 4px 8px; border-radius: 4px; cursor: pointer;">
                  <input type="checkbox" :value="net" v-model="listing.supportedChains" style="accent-color: #6366f1;" />
                  <span>{{ net.toUpperCase() }}</span>
                </label>
              </div>
              <div style="font-size: 0.7rem; color: #666; margin-top: 4px;">
                If none selected, this REST method will be considered for all networks (legacy behavior).
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
      <VoteQueueSection
        v-if="currentSection === 'votes'"
        :loading="loading"
        :voting-list="votingList"
        :vote-index="voteIndex"
        :current-vote-item="currentVoteItem"
        :vote-submitting="voteSubmitting"
        :vote-feedback="voteFeedback"
        :feedback-validating="feedbackValidating"
        :wallet-address="walletAddress"
        @update:vote-index="voteIndex = $event"
        @update:vote-feedback="voteFeedback = $event"
        @cast-vote="castVote"
      />

      <!-- Profile -->
      <div v-if="currentSection === 'profile'" class="profile-page">
        <div class="scan-hero">
          <div class="scan-tag">PROFILE</div>
          <h2 class="scan-title">Your POH Account</h2>
          <p class="scan-sub">Sign in with your Solana wallet to access your API key, track rewards, and manage your Submitted Signals.</p>
        </div>

        <div v-if="!connected" class="profile-connect-prompt">
          <p class="prompt-text">Connect your Solana wallet to view your profile.</p>
          <button class="submit-listing-btn" @click="showWalletModal = true">Connect Wallet</button>
        </div>

        <template v-else>
          <div v-if="profileError" class="profile-error">{{ profileError }}</div>

          <div v-if="profileLoading" class="empty-state"><p>Loading profile...</p></div>

          <div v-else-if="!profileData" class="profile-signup-card">
            <p class="signup-desc">No profile found for this wallet. Create one to get your API key and start earning rewards from Submitted Signals.</p>
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
              <div
                v-if="profileData.profile?.plan && profileData.profile.plan !== 'free'"
                class="pstat-card deposit-stat"
                @click="showDepositModal = true"
                title="Click to deposit (extra quota)"
              >
                <div class="pstat-val">${{ ((profileData.profile?.balance ?? 0) / 1e6).toFixed(2) }}</div>
                <div class="pstat-label">Extra Quota Balance <br><span class="pstat-deposit-hint">Tap to Deposit</span></div>
              </div>
              <div v-else class="pstat-card" style="opacity:0.6; cursor:default;">
                <div class="pstat-val">—</div>
                <div class="pstat-label">Deposit available for<br>Startup &amp; Enterprise</div>
              </div>
            </div>

            <!-- Always-visible Upgrade to Startup section in profile (prominent as requested) -->
            <div class="profile-upgrade-section" style="margin: 1rem 0; padding: 1rem; border: 2px solid #6366f1; border-radius: 8px; background: #0f0f1a;">
              <div style="font-weight: 600; margin-bottom: 0.5rem; color: #a5b4fc;">
                Current Plan: <strong>{{ profileData.profile?.plan || 'free' }}</strong>
                <span v-if="profileData.profile?.plan === 'startup'" style="color:#22c55e; font-size:0.8rem;"> (100k scans/mo)</span>
              </div>

              <div v-if="profileData.profile?.plan !== 'startup' && profileData.profile?.plan !== 'enterprise'">
                <div style="font-size: 0.9rem; color: #ccc; margin-bottom: 0.75rem;">
                  Upgrade to Startup: <strong>100,000 scans per month</strong> + priority queue.<br>
                  One-time payment of <strong>1000 USDC or USDT</strong>.
                </div>

                <!-- Token Toggle -->
                <div style="margin-bottom: 0.75rem; display: flex; gap: 8px;">
                  <button
                    :class="['token-btn', upgradeToken === 'USDC' && 'token-btn--active']"
                    @click="upgradeToken = 'USDC'"
                  >
                    USDC
                  </button>
                  <button
                    :class="['token-btn', upgradeToken === 'USDT' && 'token-btn--active']"
                    @click="upgradeToken = 'USDT'"
                  >
                    USDT
                  </button>
                </div>

                <button
                  class="submit-listing-btn"
                  style="width:100%; padding: 12px; font-size: 1rem; background: #6366f1;"
                  @click="upgradeToStartupPlan"
                  :disabled="signupLoading"
                >
                  {{ signupLoading ? 'Sending 1000 ' + upgradeToken + '...' : 'Pay 1000 ' + upgradeToken + ' & Upgrade to Startup' }}
                </button>
              </div>

              <div v-else style="color: #22c55e; font-size: 0.9rem;">
                You are on a paid plan. Thank you! 
                <span v-if="profileData.profile?.plan === 'startup'">Contact us for Enterprise upgrades.</span>
              </div>
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

            <!-- Submitted Signals -->
            <div class="profile-card">
              <div class="profile-card-header">
                <span class="profile-card-title">Submitted Signals</span>
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
                <button class="utility-link no-margin" @click="showSection('votes'); loadVotingFiltered()">Provide feedback →</button>
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
          <p class="scan-sub">Simple HTTP API. First 100 scans free per wallet. $1 per 1,000 scans after that — paid in USDC or USDT.</p>
        </div>

        <!-- Pricing table -->
        <div class="api-section">
          <div class="api-section-title">Pricing</div>
          <div class="pricing-table">
            <div class="pt-row pt-head">
              <span>Volume</span><span>Rate</span><span>Example</span>
            </div>
            <div class="pt-row">
              <span>Any volume</span><span>$0.001 / scan</span><span>1,000 scans = $1 USDC/USDT</span>
            </div>
            <div class="pt-row pt-free">
              <span>Free tier</span><span>$0</span><span>First 100 scans per wallet</span>
            </div>
          </div>
        </div>

        <!-- Endpoint docs -->
        <div class="api-section">
          <div class="api-section-title">POST /checker</div>
          <div class="api-card">
            <div class="api-desc">Scan one or more wallet addresses against all registered detection signals. Single address → synchronous result with <code>brainKey</code>. Multiple addresses or CSV upload → async job with <code>jobId</code> to poll.</div>
            <div class="api-params">
              <div class="param-row"><code>input</code><span>string or array — wallet address(es) to scan</span></div>
              <div class="param-row"><code>walletAddress</code><span>your Solana wallet (for free tier tracking)</span></div>
              <div class="param-row"><code>apiKey</code><span>API key from your profile (alternative to walletAddress)</span></div>
              <div class="param-row"><code>txHash</code><span>USDC/USDT payment transaction hash (required for paid scans)</span></div>
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
              <pre class="code-pre">curl "https://proofofhuman.ge/checker/pricing?count=1000"
# → { count: 1000, perAddress: 0.001, total: 1000000, currency: "USDC/USDT" }</pre>
            </div>
          </div>
        </div>

        <div class="api-section">
          <div class="api-section-title">GET /profile/:address</div>
          <div class="api-card">
            <div class="api-desc">Returns profile stats, Submitted Signals, and reward totals for a wallet address.</div>
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
          <h2 class="scan-title">Stake POH</h2>
          <p class="scan-sub">Your staked POH determines your vote weight when scoring detection signals.</p>
        </div>

        <div class="staking-grid">
          <div class="staking-info-card">
            <div class="si-title">How staking works</div>
            <ul class="si-list">
              <li>Stake POH → get more voting power on which detection signals are best</li>
              <li>The more you stake, the more your votes count</li>
              <li>Unstake any time — no lockup</li>
            </ul>
          </div>

          <div class="staking-info-card">
            <div class="si-title">How rewards work</div>
            <ul class="si-list">
              <li>50% or 500 POH signal deployment fee goes to stakers</li>
              <li>More you stake, the more rewards you earn</li>
            </ul>
          </div>
        </div>

        <div class="stake-form-card">
          <div class="stake-form-title">Manage Stake</div>

          <!-- Coming soon banner -->
          <div class="stake-coming-soon">
            <span class="stake-cs-icon">🔒</span>
            <div>
              <div class="stake-cs-title">Staking contract coming soon</div>
              <div class="stake-cs-sub">The on-chain staking program is being deployed. Staking and reward claims will be enabled once the contract address is live.</div>
            </div>
          </div>

          <!-- Disabled form (visual preview) -->
          <fieldset disabled class="stake-disabled-fieldset">
            <!-- Stake -->
            <div class="stake-action-row">
              <div class="flex-input">
                <input type="number" placeholder="POH to stake" class="premium-input flex-grow" />
                <button class="outline-btn">Stake</button>
              </div>
              <button class="max-btn">MAX</button>
            </div>

            <!-- Unstake -->
            <div class="stake-action-row">
              <div class="flex-input">
                <input type="number" placeholder="POH to unstake" class="premium-input flex-grow" />
                <button class="outline-btn">Unstake</button>
              </div>
              <button class="max-btn">MAX</button>
            </div>
          </fieldset>
        </div>
      </div>

      <!-- Dev / SDK hub -->
      <div v-if="currentSection === 'dev'" class="dev-page">
        <div class="scan-hero">
          <div class="scan-tag">DEVELOPER HUB</div>
          <h2 class="scan-title">Build with POH</h2>
          <p class="scan-sub">Drop-in SDKs for every platform. Verify humanness in minutes.</p>
        </div>

        <div class="dev-grid">
          <a class="dev-card" href="https://central.sonatype.com/artifact/ge.proofofhuman/proofofhuman" target="_blank" rel="noopener">
            <div class="dev-card-icon dev-icon-android">
              <img src="https://cdn.simpleicons.org/android/3ddc84" width="28" height="28" alt="Android" loading="lazy">
            </div>
            <div class="dev-card-body">
              <div class="dev-card-title">Android</div>
              <div class="dev-card-sub">Kotlin · Maven Central</div>
            </div>
            <div class="dev-card-arrow">→</div>
          </a>

          <a class="dev-card" href="https://swiftpackageindex.com/Proof-of-Human-Network/sdk-ios" target="_blank" rel="noopener">
            <div class="dev-card-icon dev-icon-ios">
              <img src="https://cdn.simpleicons.org/apple/a0aaff" width="28" height="28" alt="iOS" loading="lazy">
            </div>
            <div class="dev-card-body">
              <div class="dev-card-title">iOS</div>
              <div class="dev-card-sub">Swift · Swift Package Index</div>
            </div>
            <div class="dev-card-arrow">→</div>
          </a>

          <a class="dev-card" href="https://www.npmjs.com/package/@poh_network/sdk" target="_blank" rel="noopener">
            <div class="dev-card-icon dev-icon-js">
              <img src="https://cdn.simpleicons.org/javascript/f7df1e" width="28" height="28" alt="JavaScript" loading="lazy">
            </div>
            <div class="dev-card-body">
              <div class="dev-card-title">JavaScript</div>
              <div class="dev-card-sub">TypeScript · npm</div>
            </div>
            <div class="dev-card-arrow">→</div>
          </a>

          <a class="dev-card" href="https://pypi.org/project/poh-sdk/" target="_blank" rel="noopener">
            <div class="dev-card-icon dev-icon-python">
              <img src="https://cdn.simpleicons.org/python/4b9cd3" width="28" height="28" alt="Python" loading="lazy">
            </div>
            <div class="dev-card-body">
              <div class="dev-card-title">Python</div>
              <div class="dev-card-sub">PyPI · pip install poh-sdk</div>
            </div>
            <div class="dev-card-arrow">→</div>
          </a>

          <a class="dev-card" href="https://crates.io/crates/poh-sdk" target="_blank" rel="noopener">
            <div class="dev-card-icon dev-icon-rust">
              <img src="https://cdn.simpleicons.org/rust/ce422b" width="28" height="28" alt="Rust" loading="lazy">
            </div>
            <div class="dev-card-body">
              <div class="dev-card-title">Rust</div>
              <div class="dev-card-sub">crates.io · cargo add poh-sdk</div>
            </div>
            <div class="dev-card-arrow">→</div>
          </a>

          <a class="dev-card" href="https://github.com/Proof-of-Human-Network/widget" target="_blank" rel="noopener">
            <div class="dev-card-icon dev-icon-web">
              <img src="https://cdn.simpleicons.org/github/22d3ee" width="28" height="28" alt="GitHub" loading="lazy">
            </div>
            <div class="dev-card-body">
              <div class="dev-card-title">Web Widget</div>
              <div class="dev-card-sub">Drop-in · GitHub</div>
            </div>
            <div class="dev-card-arrow">→</div>
          </a>

          <a class="dev-card" href="#" @click.prevent="showSection('api')">
            <div class="dev-card-icon dev-icon-api">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"/></svg>
            </div>
            <div class="dev-card-body">
              <div class="dev-card-title">REST API</div>
              <div class="dev-card-sub">HTTP · Full reference →</div>
            </div>
            <div class="dev-card-arrow">→</div>
          </a>

          <div class="dev-card dev-card--mystery">
            <div class="dev-card-icon dev-icon-mystery">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
            </div>
            <div class="dev-card-body">
              <div class="dev-card-title">Coming soon</div>
              <div class="dev-card-sub">Something is brewing...</div>
            </div>
            <div class="dev-card-arrow">?</div>
          </div>
        </div>
      </div>

      <!-- About / Yellow Paper -->
      <AboutSection v-if="currentSection === 'about'" />

    </main>

    <footer class="footer">
      <div class="network-label">CONNECT</div>
    </footer>
    </div>
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
  position: relative;   /* contains the particle layer */
  overflow: hidden;
  /* border-bottom: 1px solid #111; */
}
.problem-inner           { max-width: 680px; text-align: center; }
.problem-inner--above    { position: relative; z-index: 1; }
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
  max-width: 512px;
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
a.feat-cta { text-decoration: none; display: inline-block; }

/* ── Mining section ───────────────────────────────────────────────────────── */
.mining-stats {
  display: flex;
  gap: 1.5rem;
  margin: 1.25rem 0 1.5rem;
}
.mining-stat {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.mining-stat-val {
  font-size: 1.1rem;
  font-weight: 600;
  color: #4ade80;
}
.mining-stat-label {
  font-size: 0.7rem;
  color: #444;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.mining-visual {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 4px;
  overflow: hidden;
  background: #000;
}
.mining-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.mining-pulse-ring { display: none; }

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

/* Plans teaser styles (task 2.md) */
.plans-teaser {
  padding: 10rem 1rem 10rem;
}
.plans-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  max-width: 980px;
  margin: 1.5rem auto 0;
}
.plan-card {
  background: #111;
  border: 1px solid #222;
  border-radius: 10px;
  padding: 1rem 1.1rem;
  display: flex;
  flex-direction: column;
}
.plan-card.plan-popular {
  border-color: #6366f1;
  box-shadow: 0 0 0 1px rgba(99,102,241,0.2);
}
.plan-name {
  font-weight: 600;
  font-size: 1.05rem;
  margin-bottom: 0.25rem;
}
.plan-price {
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 0.6rem;
}
.plan-price .per {
  font-size: 0.85rem;
  font-weight: 400;
  color: #888;
}
.plan-features {
  list-style: none;
  padding: 0;
  margin: 0 0 0.8rem;
  font-size: 0.9rem;
  color: #ccc;
  flex: 1;
}
.plan-features li {
  padding: 2px 0;
}
.plan-note {
  font-size: 0.8rem;
  color: #666;
  margin-top: auto;
}
.plan-cta {
  margin-top: 0.6rem;
  background: #6366f1;
  color: white;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  font-size: 0.9rem;
}
.plan-cta.secondary {
  background: #222;
  color: #ddd;
}
.badge {
  font-size: 0.65rem;
  background: #6366f1;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
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

/* ── Miner Network controls (peer discovery + toggle for decentralized search) ─ */
.miner-net-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin: 0.25rem 0 0.5rem;
  font-size: 0.8rem;
  color: #888;
}
.miner-net-toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  user-select: none;
  color: #aaa;
}
.miner-net-toggle input { accent-color: #6366f1; }
.miner-net-count { font-family: monospace; color: #666; }
.miner-net-count.muted { opacity: 0.6; }
.miner-peer-select {
  font-size: 0.72rem;
  background: #111;
  color: #ccc;
  border: 1px solid #222;
  border-radius: 4px;
  padding: 0.1rem 0.35rem;
  max-width: 220px;
}
.miner-net-err { color: #f66; font-size: 0.7rem; }

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

.brain-pending   { border-left-color: #808080; }
.brain-human     { border-left-color: var(--green); }
.brain-bot       { border-left-color: var(--red); }
.brain-uncertain { border-left-color: #ca8a04; }

/* ── OFAC sanctions card ───────────────────────────────────────────────────── */
.ofac-card {
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.5);
  border-left: 4px solid #dc2626;
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin: 1rem 0;
}
.ofac-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.4rem;
}
.ofac-icon { font-size: 1.2rem; }
.ofac-title {
  font-weight: 700;
  font-size: 1rem;
  color: #ef4444;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.ofac-body {
  font-size: 0.9rem;
  color: #fca5a5;
  margin: 0.25rem 0 0.5rem;
  line-height: 1.5;
}
.ofac-addr {
  font-family: monospace;
  font-size: 0.8rem;
  background: rgba(220,38,38,0.15);
  padding: 1px 4px;
  border-radius: 3px;
  word-break: break-all;
}
.ofac-meta {
  font-size: 0.8rem;
  color: #f87171;
}

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
  padding: 1rem 1rem 0.5rem;
  background: #0a0a0a;
}

.evidence-map-wrap {
  padding: 0 1rem 0.75rem;
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
  min-width: 0;
  overflow: hidden;
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
  font-size: 0.82rem;
  color: #666;
  font-family: 'JetBrains Mono', monospace;
  background: #080808;
  border: 1px solid #1a1a1a;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  min-width: 0;
  flex: 1;
  display: block;
  transition: color 0.15s;
}
.vcs-code:hover { color: #888; }
.vcs-code--truncated {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vcs-code--expanded {
  white-space: pre-wrap;
  word-break: break-all;
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
.hp-root {
  min-height: 100vh;
  background: #000;
  color: #fff;
  display: flex;
  flex-direction: column;
}

.app-container {
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  flex: 1;
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
  padding: 1rem 2rem;
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

.nav-btn--back {
  color: #555;
  font-size: 1rem;
  letter-spacing: 0.02em;
}
.nav-btn--back:hover {
  color: #aaa;
  background: transparent;
}

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
  background: none;
  cursor: pointer;
  transition: border-color 0.15s;
}
.connected-status:hover { border-color: #333; }

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

/* ── Wallet dropdown (desktop hover) ────────────────────────────────────── */
.wallet-dropdown-wrapper {
  position: relative;
}
.wallet-dropdown {
  display: flex;
  flex-direction: column;
  gap: 0;
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  background: #0d0d0d;
  border: 1px solid #222;
  border-radius: 8px;
  padding: 0.3rem;
  min-width: 140px;
  z-index: 200;
}
.wallet-drop-item {
  background: none;
  border: none;
  color: #aaa;
  font-size: 0.82rem;
  text-align: left;
  padding: 0.55rem 0.8rem;
  border-radius: 5px;
  cursor: pointer;
  width: 100%;
  transition: background 0.12s, color 0.12s;
}
.wallet-drop-item:hover { background: #181818; color: #fff; }
.wallet-drop-disconnect { color: #e05 !important; }
.wallet-drop-disconnect:hover { background: #1a0808 !important; }

/* ── Mobile wallet drop ─────────────────────────────────────────────────── */
.mobile-wallet-status {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 0.5rem;
  width: 100%;
  background: none;
  border: none;
  cursor: pointer;
}
.wallet-drop-chevron {
  margin-left: auto;
  color: #555;
  font-size: 1.2rem;
  line-height: 1;
  transition: transform 0.2s;
  display: inline-block;
  transform: rotate(90deg);
}
.wallet-drop-chevron.open { transform: rotate(-90deg); }
.mobile-wallet-drop {
  display: flex;
  flex-direction: column;
  padding: 0 0.5rem 0.5rem 1.5rem;
  gap: 0;
}
.mobile-wallet-drop-item {
  background: none;
  border: none;
  color: #888;
  font-size: 0.9rem;
  text-align: left;
  padding: 0.6rem 0.5rem;
  cursor: pointer;
  border-radius: 5px;
  transition: color 0.12s;
}
.mobile-wallet-drop-item:hover { color: #fff; }
.mobile-wallet-drop-disconnect { color: #e05 !important; }

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

.token-btn {
  flex: 1;
  padding: 0.5rem 1rem;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  color: #808080;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.15s;
}
.token-btn--active {
  background: rgba(99,102,241,0.15);
  border-color: #6366f1;
  color: #a5b4fc;
}

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

/* ── Batch results table ── */
.batch-results { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.batch-results-header { display: flex; align-items: center; justify-content: space-between; }
.batch-results-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }
.batch-download-btn { background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); border-radius: 6px; padding: 4px 12px; font-size: 12px; cursor: pointer; transition: background 0.15s; }
.batch-download-btn:hover { background: rgba(99,102,241,0.25); }
.batch-table { display: flex; flex-direction: column; border: 1px solid #1f2937; border-radius: 10px; overflow: hidden; }
.batch-table-head { display: grid; grid-template-columns: 1fr 70px 70px 110px 60px; gap: 0; background: rgba(255,255,255,0.03); padding: 8px 14px; border-bottom: 1px solid #1f2937; }
.batch-table-row  { display: grid; grid-template-columns: 1fr 70px 70px 110px 60px; gap: 0; padding: 8px 14px; border-bottom: 1px solid #111827; transition: background 0.1s; }
.batch-table-row:last-child { border-bottom: none; }
.batch-table-row:hover { background: rgba(255,255,255,0.03); }
.batch-row-danger { background: rgba(239,68,68,0.05) !important; }
.batch-row-warn   { background: rgba(234,179,8,0.05) !important; }
.bt-col { display: flex; align-items: center; font-size: 12px; }
.batch-table-head .bt-col { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #4b5563; }
.bt-addr-text { font-family: monospace; color: #d1d5db; }
.bt-pass-val  { color: #22c55e; font-weight: 600; }
.bt-fail-val  { color: #6b7280; font-weight: 600; }
.batch-flag { font-size: 11px; padding: 2px 6px; border-radius: 4px; }
.batch-flag-ofac { background: rgba(239,68,68,0.12); color: #ef4444; }
.batch-flag-cex  { background: rgba(234,179,8,0.12);  color: #eab308; }
.batch-flag-none { color: #374151; }
.batch-scan-btn { background: #1f2937; color: #9ca3af; border: 1px solid #374151; border-radius: 5px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.batch-scan-btn:hover { background: #6366f1; color: #fff; border-color: #6366f1; }

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

.chain-pill--custom {
  color: #a78bfa;
  border-color: #3b2d6e;
  background: #0e0b1c;
}

.chain-pill--bitcoin {
  color: #F7931A;
  border-color: #3a2a1a;
  background: #1a140a;
}
.chain-pill--tron {
  color: #FF001F;
  border-color: #3a1014;
  background: #1a0a0a;
}
.chain-pill--ton {
  color: #0098EA;
  border-color: #0a2a3a;
  background: #0a141a;
}
.chain-pill--xlm {
  color: #08B5E5;
  border-color: #0a2a32;
  background: #0a161a;
}

/* ── Platform chips ── */
.platform-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 0 2px;
}
.platform-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 20px;
  border: 1px solid #2a2a38;
  background: transparent;
  color: #808080;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
  white-space: nowrap;
}
.platform-chip:hover {
  border-color: #4b4b68;
  color: #c4c4d4;
}
.platform-chip.active {
  border-color: #6366f1;
  background: rgba(99, 102, 241, 0.12);
  color: #a5b4fc;
}
.platform-chip-icon { font-size: 13px; line-height: 1; }
.platform-chip-name { font-size: 11px; font-weight: 500; }

/* ── Resolve picker ── */
.resolve-picker {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px; background: #0e0e12; border: 1px solid #2d2d3a;
  border-radius: 10px; margin-top: 2px;
}
.resolve-picker-title {
  font-size: 12px; color: #808080; padding-bottom: 4px;
}
.resolve-picker-title strong { color: #d1d5db; }
.resolve-hit {
  display: flex; align-items: center; gap: 10px;
  background: rgba(99,102,241,0.05); border: 1px solid #2a2a38;
  border-radius: 8px; padding: 8px 10px;
  cursor: pointer; text-align: left; transition: border-color 0.15s;
}
.resolve-hit:hover { border-color: #6366f1; }
.resolve-hit-avatar {
  width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex-shrink: 0;
}
.resolve-hit-icon { font-size: 20px; flex-shrink: 0; }
.resolve-hit-info { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.resolve-hit-name {
  font-size: 13px; font-weight: 600; color: #e5e7eb;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.resolve-hit-sub { font-size: 11px; color: #6b7280; }

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

.status-badge.uncertain {
  background: rgba(202,138,4,0.08);
  color: #ca8a04;
  border: 1px solid rgba(202,138,4,0.2);
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
  .profile-stats { grid-template-columns: repeat(3, 1fr); }
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
  grid-template-columns: repeat(3, 1fr);
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
.stake-coming-soon {
  display: flex; align-items: flex-start; gap: 12px;
  background: rgba(99,102,241,0.07); border: 1px solid rgba(99,102,241,0.2);
  border-radius: 8px; padding: 14px 16px; margin-bottom: 1.5rem;
}
.stake-cs-icon { font-size: 1.4rem; flex-shrink: 0; margin-top: 1px; }
.stake-cs-title { font-size: 0.875rem; font-weight: 600; color: #a5b4fc; margin-bottom: 4px; }
.stake-cs-sub { font-size: 0.8rem; color: #6b7280; line-height: 1.5; }
.stake-disabled-fieldset { border: none; padding: 0; margin: 0; opacity: 0.35; pointer-events: none; }

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

/* ── Dev / SDK Hub ─────────────────────────────────────────────────────────── */
.dev-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}

.dev-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-top: 2rem;
}

.dev-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.2rem;
  background: #0c0c0c;
  border: 1px solid #1e1e1e;
  border-radius: 10px;
  text-decoration: none;
  color: #fff;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.dev-card:hover {
  border-color: #444;
  background: #111;
}

.dev-card--mystery {
  border-style: dashed;
  border-color: #2a2a2a;
  cursor: default;
  opacity: 0.6;
}

.dev-card-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dev-icon-android { background: #1a2e1a; color: #3ddc84; }
.dev-icon-ios     { background: #1a1a2e; color: #a0aaff; }
.dev-icon-js      { background: #2e2a00; color: #f7df1e; }
.dev-icon-python  { background: #00182e; color: #4b9cd3; }
.dev-icon-rust    { background: #2e1a0a; color: #ce422b; }
.dev-icon-web     { background: #0a2e2a; color: #22d3ee; }
.dev-icon-api     { background: #1a1a1a; color: #888; }
.dev-icon-mystery { background: #1a1a1a; color: #555; }

.dev-card-body { flex: 1; min-width: 0; }
.dev-card-title { font-size: 1rem; font-weight: 600; }
.dev-card-sub   { font-size: 0.8rem; color: #666; margin-top: 0.15rem; }
.dev-card-arrow { color: #444; font-size: 1.1rem; flex-shrink: 0; }

@media (max-width: 600px) {
  .dev-grid { grid-template-columns: 1fr; }
}

/* ── Wallet Profile ──────────────────────────────────────────────────────────── */
.profile-card-wrap {
  margin-top: 20px;
  background: rgba(255,255,255,0.03);
  border: 1px solid #1f2937;
  border-radius: 14px;
  padding: 22px;
}

/* ── Social Vibe card ─────────────────────────────────────────────────────── */
.vibe-card {
  margin-top: 14px;
  background: #080f08;
  border: 1px solid rgba(34,197,94,0.18);
  border-radius: 12px;
  padding: 16px 18px;
}
.vibe-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.vibe-label {
  font-family: monospace;
  font-size: 9px;
  letter-spacing: 1.5px;
  color: #22c55e;
  opacity: 0.8;
}
.vibe-sources { display: flex; gap: 6px; flex-wrap: wrap; }
.vibe-source-pill {
  font-family: monospace;
  font-size: 9px;
  color: #374151;
  background: #111;
  padding: 2px 8px;
  border-radius: 10px;
}
.vibe-text {
  font-size: 13px;
  color: #9ca3af;
  line-height: 1.65;
  margin: 0 0 12px;
}
.vibe-topics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.vibe-topic {
  font-family: monospace;
  font-size: 10px;
  color: #22c55e;
  background: rgba(34,197,94,0.08);
  border: 1px solid rgba(34,197,94,0.2);
  padding: 3px 9px;
  border-radius: 12px;
}
.vibe-signals {
  margin: 0 0 12px;
  padding-left: 16px;
  font-size: 11px;
  color: #4b5563;
  line-height: 1.7;
}
.vibe-casts-label {
  font-family: monospace;
  font-size: 9px;
  letter-spacing: 1.5px;
  color: #374151;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.vibe-casts, .vibe-articles { margin-top: 10px; }
.vibe-cast {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 5px 0;
  border-bottom: 1px solid #0f0f0f;
  font-size: 11px;
}
.vibe-cast:last-child { border-bottom: none; }
.vibe-cast-text { flex: 1; color: #6b7280; line-height: 1.5; }
.vibe-cast-meta { flex-shrink: 0; font-family: monospace; font-size: 10px; color: #374151; }
.vibe-article { padding: 4px 0; font-size: 11px; color: #6b7280; }
.vibe-article-title { color: #9ca3af; }
.vibe-article-sub { color: #4b5563; }

.evidence-loading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 0 0.5rem;
}

.evidence-loading-bar {
  flex: 1;
  height: 2px;
  background: #1a1a1a;
  border-radius: 2px;
  overflow: hidden;
  position: relative;
}

.evidence-loading-bar::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent 0%, #444 50%, transparent 100%);
  animation: evidence-sweep 1.4s ease-in-out infinite;
}

@keyframes evidence-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}

.evidence-loading-label {
  font-size: 0.75rem;
  color: #444;
  white-space: nowrap;
}

.profile-loading {
  display: flex;
  align-items: center;
  margin-top: 16px;
  padding: 14px;
}

.profile-loading-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #4b5563;
  margin: 0 3px;
  animation: profile-pulse 1.2s ease-in-out infinite;
}
.profile-loading-dot:nth-child(2) { animation-delay: 0.2s; }
.profile-loading-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes profile-pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40%           { opacity: 1;   transform: scale(1); }
}
</style>
