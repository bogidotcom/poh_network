<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { Code, TrendingUp, TrendingDown, Zap } from 'lucide-vue-next'
import { createChart, AreaSeries } from 'lightweight-charts'
import axios from 'axios'

const props = defineProps({
  loading:            { type: Boolean, default: false },
  votingList:         { type: Array,   default: () => [] },
  voteIndex:          { type: Number,  default: 0 },
  currentVoteItem:    { type: Object,  default: null },
  voteSubmitting:     { type: Boolean, default: false },
  voteFeedback:       { type: String,  default: '' },
  feedbackValidating: { type: Boolean, default: false },
  curveState:         { type: Object,  default: null },
  chartCandles:       { type: Array,   default: () => [] },
  solBalance:         { type: Number,  default: 0 },
  ownedTokens:        { type: Number,  default: 0 },
  quoteResult:        { type: Object,  default: null },
  curveLoading:       { type: Boolean, default: false },
  walletAddress:      { type: String,  default: '' },
})

const emit = defineEmits([
  'update:voteIndex',
  'update:voteFeedback',
  'cast-vote',
  'auto-expand',
  'curve-buy',
  'curve-sell',
  'curve-quote',
  'claim-fees',
])

// On-chain Meteora curve — no local math needed; quotes come from backend

// ── Creator fee claim ─────────────────────────────────────────────────────────
const claimableFees  = ref(null)   // { quoteSOL, baseTokens } or null
const claimLoading   = ref(false)
const claimMsg       = ref(null)

const isCreator = computed(() =>
  props.walletAddress &&
  props.curveState?.creatorWallet &&
  props.walletAddress.toLowerCase() === props.curveState.creatorWallet.toLowerCase()
)

watch(() => [props.currentVoteItem?.id, isCreator.value], async ([id, creator]) => {
  claimableFees.value = null
  claimMsg.value = null
  if (!id || !creator) return
  try {
    const { data } = await axios.get(`/curves/${id}/creator-fees`)
    claimableFees.value = data
  } catch { claimableFees.value = null }
}, { immediate: true })

async function handleClaimFees() {
  claimMsg.value = null
  emit('claim-fees', props.currentVoteItem?.id)
}

// ── Referral share ────────────────────────────────────────────────────────────
const referralCopied = ref(false)

function copyReferralLink() {
  if (!props.currentVoteItem) return
  const base = window.location.origin + window.location.pathname
  const ref  = props.walletAddress ? `&ref=${props.walletAddress}` : ''
  const url  = `${base}?signal=${props.currentVoteItem.id}${ref}`
  navigator.clipboard.writeText(url).then(() => {
    referralCopied.value = true
    setTimeout(() => { referralCopied.value = false }, 2000)
  })
}

// ── Search ────────────────────────────────────────────────────────────────────
const searchQuery   = ref('')
const searchOpen    = ref(false)
const searchResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q || q.length < 2) return []
  return props.votingList
    .map((m, i) => ({ ...m, _idx: i }))
    .filter(m =>
      m.description?.toLowerCase().includes(q) ||
      m.address?.toLowerCase().includes(q) ||
      m.method?.toLowerCase().includes(q) ||
      m.type?.toLowerCase().includes(q)
    )
    .slice(0, 8)
})

function jumpTo(idx) {
  emit('update:voteIndex', idx)
  searchQuery.value = ''
  searchOpen.value  = false
}

function onSearchFocus()  { searchOpen.value = true }
function onSearchBlur()   { setTimeout(() => { searchOpen.value = false }, 150) }

// ── SOL input ─────────────────────────────────────────────────────────────────
const betSol    = ref('')

// Estimated tokens from quote result (backend derives this from on-chain pool)
const tokenCalc = computed(() => {
  if (!props.quoteResult || props.quoteResult.swapBaseForQuote !== false) return 0
  return parseInt(props.quoteResult.amountOut || 0)
})

watch(betSol, () => {
  const lamports = Math.floor((parseFloat(betSol.value) || 0) * 1e9)
  if (lamports > 0 && props.currentVoteItem) {
    emit('curve-quote', props.currentVoteItem.id, 'buy', lamports)
  }
})

function setMaxBuy() {
  const avail = Math.max(0, props.solBalance - 0.002)
  betSol.value = avail.toFixed(4)
}

function setMaxSell() {
  if (!props.ownedTokens) return
  // Request sell quote for all owned tokens
  if (props.currentVoteItem) emit('curve-quote', props.currentVoteItem.id, 'sell', props.ownedTokens)
}

function handleBuy() {
  const lamports = Math.floor((parseFloat(betSol.value) || 0) * 1e9)
  if (lamports <= 0) return
  emit('curve-buy', props.currentVoteItem.id, lamports)
  betSol.value = ''
}

function handleSell() {
  if (!props.ownedTokens) return
  emit('curve-sell', props.currentVoteItem.id, props.ownedTokens)
  betSol.value = ''
}

// ── Chart ─────────────────────────────────────────────────────────────────────
const chartContainer = ref(null)
let chart      = null
let areaSeries = null

function buildChart() {
  if (!chartContainer.value) return
  if (chart) { chart.remove(); chart = null; areaSeries = null }

  chart = createChart(chartContainer.value, {
    width:  chartContainer.value.clientWidth,
    height: chartContainer.value.clientHeight || 512,
    layout: {
      background: { color: '#060606' },
      textColor:  '#444',
    },
    grid: {
      vertLines: { color: '#0f0f0f' },
      horzLines: { color: '#0f0f0f' },
    },
    crosshair:       { mode: 1 },
    rightPriceScale: { borderColor: '#161616', scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale:       { borderColor: '#161616', timeVisible: true, secondsVisible: false },
    handleScroll:    false,
    handleScale:     false,
  })

  areaSeries = chart.addSeries(AreaSeries, {
    lineColor:   '#4ade80',
    topColor:    'rgba(74,222,128,0.14)',
    bottomColor: 'rgba(74,222,128,0)',
    lineWidth:   2,
    priceFormat: { type: 'price', precision: 9, minMove: 0.000000001 },
  })

  applyChartData()
}

function applyChartData() {
  if (!areaSeries) return
  if (!props.chartCandles.length) {
    const spot = props.curveState?.currentPriceSol ?? 0
    areaSeries.setData([{ time: Math.floor(Date.now() / 1000), value: spot }])
    chart.timeScale().fitContent()
    return
  }
  // candle.close is already in SOL (from meteora.js getChartData)
  const data = props.chartCandles.map(c => ({ time: c.time, value: c.close }))
  areaSeries.setData(data)
  chart.timeScale().fitContent()
}

watch(() => props.chartCandles, applyChartData, { deep: true })
watch(() => props.currentVoteItem, async (newItem) => {
  if (!newItem) return
  await nextTick()
  buildChart()
})

const resizeObs = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(() => {
      if (chart && chartContainer.value) {
        chart.applyOptions({
          width:  chartContainer.value.clientWidth,
          height: chartContainer.value.clientHeight || 512,
        })
      }
    })
  : null

watch(chartContainer, (el) => { if (el && resizeObs) resizeObs.observe(el) })
onMounted(() => { if (props.currentVoteItem) nextTick(buildChart) })
onUnmounted(() => { resizeObs?.disconnect(); chart?.remove() })

// ── Formatting ────────────────────────────────────────────────────────────────
function fmtPrice(lamports) {
  if (lamports == null) return '—'
  const sol = lamports / 1e9
  if (sol < 0.000001) return sol.toFixed(9) + ' SOL'
  if (sol < 0.001)    return sol.toFixed(7) + ' SOL'
  return sol.toFixed(5) + ' SOL'
}

function fmtSol(n, decimals = 4) {
  return (n || 0).toFixed(decimals)
}

function signalStrength(item) {
  const base = item.score || 0
  if (!props.curveState) return base.toFixed(1)
  const boost = 1 + Math.log1p(Math.max(0, (props.curveState.supply || 0) / 100)) * 0.3
  const graduationMult = props.curveState?.migrated ? 1.5 : 1.0
  return (base * boost * graduationMult).toFixed(1)
}
</script>

<template>
  <div class="vqs-root">
    <!-- Disclaimer -->
    <div class="vqs-disclaimer">
      <span class="vqs-disclaimer-icon">⚠</span>
      <p>
        <strong>Not financial advice.</strong>
        Signal tokens are utility instruments for expressing confidence in human-identity verification methods — they are not investments, securities, or financial products of any kind.
        Buying or selling signal tokens carries risk of total loss.
        Past price action does not indicate future results.
        Do not trade with funds you cannot afford to lose.
        POH is a decentralised protocol; no party is liable for your trading decisions.
        By interacting with signal curves you confirm you are not subject to restrictions that prohibit participation in experimental on-chain markets.
      </p>
    </div>

    <div class="vqs-header">
      <div class="scan-tag">CONSENSUS QUEUE</div>
      <h2 class="scan-title">Signal feedback</h2>
      <h3>Buy to signal human confidence — sell to withdraw trust. <a style="color: white;" href="" target="_blank">Learn More</a></h3>
      <br>
      <p class="scan-sub">
        Your POH stake weight and signal market price determine influence on AI decisions. 
      </p>
      <span class="fee-note">4% to signal creator · 1% protocol fee on every trade</span>
      <span class="dex-note">1.5× influence on AI decisions if bonding curve migrated to DEX</span>
    </div>

    <!-- Search -->
    <div v-if="votingList.length" class="vqs-search-wrap">
      <div class="vqs-search-box">
        <svg class="vqs-search-icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M10 10l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search signals…"
          class="vqs-search-input"
          @focus="onSearchFocus"
          @blur="onSearchBlur"
          autocomplete="off"
        />
        <button v-if="searchQuery" class="vqs-search-clear" @click="searchQuery = ''">×</button>
      </div>
      <div v-if="searchOpen && searchResults.length" class="vqs-search-results">
        <button
          v-for="m in searchResults"
          :key="m.id"
          class="vqs-search-result"
          @mousedown.prevent
          @click="jumpTo(m._idx)"
        >
          <span class="vqs-sr-type">{{ m.type?.toUpperCase() }}</span>
          <span class="vqs-sr-desc">{{ m.description }}</span>
          <span v-if="m.address" class="vqs-sr-addr">{{ m.address.slice(0, 24) }}…</span>
        </button>
      </div>
      <div v-else-if="searchOpen && searchQuery.length >= 2 && !searchResults.length" class="vqs-search-empty">
        No signals match "{{ searchQuery }}"
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="vqs-empty">
      <div class="vqs-spinner"></div>
      <span>Loading signals…</span>
    </div>

    <!-- Empty -->
    <div v-else-if="!currentVoteItem" class="vqs-empty">
      <Code :size="26" class="vqs-empty-icon" />
      <p>{{ votingList.length ? 'All signals reviewed.' : 'Queue is empty.' }}</p>
      <button v-if="votingList.length" class="utility-link" @click="emit('update:voteIndex', 0)">
        Start over
      </button>
    </div>

    <!-- Main card -->
    <div v-else class="vqs-card">

      <!-- Progress bar -->
      <div class="vqs-progress">
        <div class="vqs-progress-track">
          <div class="vqs-progress-fill" :style="{ width: (voteIndex / votingList.length * 100) + '%' }"></div>
        </div>
        <span class="vqs-progress-label">{{ voteIndex + 1 }} / {{ votingList.length }}</span>
      </div>

      <!-- Badge row -->
      <div class="vqs-badges">
        <span class="badge badge-type">{{ currentVoteItem.type?.toUpperCase() }}</span>
        <span v-if="currentVoteItem.chainId" class="badge badge-chain">chain {{ currentVoteItem.chainId }}</span>
        <span class="badge badge-strength">
          <Zap :size="10" />
          {{ signalStrength(currentVoteItem) }}
        </span>
        <span v-if="curveState?.currentPriceSol" class="badge badge-price">{{ curveState.currentPriceSol.toExponential(3) }} SOL</span>
        <span v-if="curveState?.mintAddress" class="badge badge-supply" :title="curveState.mintAddress">COIN</span>
        <span v-if="curveState?.migrated" class="badge badge-dex" title="Graduated to DEX — 1.5× decision weight">DEX ×1.5</span>
      </div>

      <!-- Description -->
      <p class="vqs-desc">{{ currentVoteItem.description }}</p>

      <!-- Details grid -->
      <div class="vqs-details">
        <div v-if="currentVoteItem.address" class="vqs-detail-row">
          <span class="vqs-detail-label">{{ currentVoteItem.type === 'rest' ? 'Endpoint' : 'Address' }}</span>
          <span class="vqs-detail-val">{{ currentVoteItem.address }}</span>
        </div>
        <div v-if="currentVoteItem.method" class="vqs-detail-row">
          <span class="vqs-detail-label">Method</span>
          <span class="vqs-detail-val">{{ currentVoteItem.method }}</span>
        </div>
        <div v-if="currentVoteItem.expression" class="vqs-detail-row">
          <span class="vqs-detail-label">Expression</span>
          <code class="vqs-detail-code">{{ currentVoteItem.expression }}</code>
        </div>

      </div>

      <!-- Chart -->
      <div class="vqs-chart-wrap">
        <div class="vqs-chart-head">
          <span class="vqs-chart-label">Price history</span>
          <span v-if="curveState?.quoteReserve" class="vqs-chart-stats">
            {{ (parseInt(curveState.quoteReserve) / 1e9).toFixed(3) }} SOL raised
          </span>
        </div>
        <div ref="chartContainer" class="vqs-chart"></div>
      </div>

      <!-- Trade panel -->
      <div class="vqs-trade">
        <div class="vqs-trade-balances">
          <div class="vqs-balance-item">
            <span class="vqs-balance-label">Your SOL</span>
            <span class="vqs-balance-val">{{ fmtSol(solBalance) }}</span>
          </div>
          <div v-if="ownedTokens > 0" class="vqs-balance-item vqs-balance-owned">
            <span class="vqs-balance-label">Owned tokens</span>
            <span class="vqs-balance-val vqs-owned-val">{{ (ownedTokens / 1e6).toFixed(2) }}</span>
          </div>
        </div>

        <!-- Creator fee claim (only visible to signal creator) -->
        <div v-if="isCreator && curveState?.poolAddress" class="vqs-creator-claim">
          <div class="vqs-creator-label">Creator fees</div>
          <div v-if="claimableFees" class="vqs-creator-fees">
            <span>{{ (claimableFees.quoteSOL || 0).toFixed(6) }} SOL</span>
            <span v-if="claimableFees.baseTokens > 0"> + {{ (claimableFees.baseTokens / 1e6).toFixed(4) }} tokens</span>
          </div>
          <div v-else class="vqs-creator-fees vqs-creator-fees--empty">—</div>
          <button
            class="vqs-claim-btn"
            :disabled="claimLoading || !claimableFees || (claimableFees.quoteSOL <= 0 && claimableFees.baseTokens <= 0)"
            @click="handleClaimFees"
          >{{ claimLoading ? 'Claiming…' : 'Claim' }}</button>
          <div v-if="claimMsg" :class="['vqs-claim-msg', claimMsg.ok ? 'vqs-claim-msg--ok' : 'vqs-claim-msg--err']">
            {{ claimMsg.text }}
          </div>
        </div>

        <!-- SOL input row -->
        <div class="vqs-input-row">
          <div class="vqs-input-wrap">
            <input
              v-model="betSol"
              type="number"
              step="0.001"
              min="0"
              placeholder="SOL amount"
              class="premium-input vqs-sol-input"
            />
            <span class="vqs-input-unit">SOL</span>
          </div>
          <button class="vqs-max-btn" @click="setMaxBuy" title="Max buyable with your balance">Max buy</button>
          <button class="vqs-max-btn vqs-max-sell" @click="setMaxSell" :disabled="!ownedTokens" title="Sell all your tokens">Max sell</button>
        </div>

        <!-- Token estimate (buy) -->
        <div v-if="betSol && parseFloat(betSol) > 0 && tokenCalc > 0" class="vqs-token-est">
          ≈ <strong>{{ (tokenCalc / 1e6).toFixed(2) }}</strong> tokens
        </div>

        <!-- Quote preview -->
        <div v-if="quoteResult" class="vqs-quote">
          <template v-if="quoteResult.action === 'buy'">
            <div class="vqs-quote-row">
              <span class="vqs-quote-label">You spend</span>
              <span class="vqs-quote-val">{{ (parseInt(quoteResult.amountIn) / 1e9).toFixed(6) }} SOL</span>
            </div>
            <div class="vqs-quote-row">
              <span class="vqs-quote-label">You receive ≥</span>
              <span class="vqs-quote-val vqs-quote-green">{{ (parseInt(quoteResult.minimumAmountOut) / 1e6).toFixed(2) }} tokens</span>
            </div>
            <div class="vqs-quote-row">
              <span class="vqs-quote-label">Fee</span>
              <span class="vqs-quote-val vqs-quote-fee">{{ (parseInt(quoteResult.fee) / 1e9).toFixed(6) }} SOL</span>
            </div>
          </template>
          <template v-if="quoteResult.action === 'sell'">
            <div class="vqs-quote-row">
              <span class="vqs-quote-label">You sell</span>
              <span class="vqs-quote-val">{{ (parseInt(quoteResult.amountIn) / 1e6).toFixed(2) }} tokens</span>
            </div>
            <div class="vqs-quote-row">
              <span class="vqs-quote-label">You receive ≥</span>
              <span class="vqs-quote-val vqs-quote-green">{{ (parseInt(quoteResult.minimumAmountOut) / 1e9).toFixed(6) }} SOL</span>
            </div>
            <div class="vqs-quote-row">
              <span class="vqs-quote-label">Fee</span>
              <span class="vqs-quote-val vqs-quote-fee">{{ (parseInt(quoteResult.fee) / 1e9).toFixed(6) }} SOL</span>
            </div>
          </template>
        </div>
      </div>

      <!-- Referral share -->
      <div class="vqs-share-row">
        <button class="vqs-share-btn" @click="copyReferralLink" :disabled="!currentVoteItem">
          <span v-if="referralCopied">✓ Link copied!</span>
          <span v-else>{{ walletAddress ? 'Share referral link' : 'Share signal link' }}</span>
        </button>
        <span v-if="walletAddress" class="vqs-share-hint">Earn fees when others trade via your link</span>
      </div>

      <!-- Feedback textarea -->
      <textarea
        :value="voteFeedback"
        @input="emit('update:voteFeedback', $event.target.value)"
        class="vqs-feedback"
        placeholder="Optional: explain your reasoning…"
        rows="2"
        maxlength="200"
      ></textarea>

      <!-- Action buttons -->
      <div class="vqs-actions">
        <button
          class="vqs-btn vqs-btn-back"
          :disabled="voteIndex <= 0 || curveLoading"
          @click="emit('update:voteIndex', voteIndex - 1)"
          title="Go back"
        >
          ← Back
        </button>
        <button
          class="vqs-btn vqs-btn-buy"
          :disabled="curveLoading || feedbackValidating || !betSol || tokenCalc <= 0"
          @click="handleBuy"
        >
          <TrendingUp :size="14" />
          <span>{{ curveLoading ? 'Processing…' : 'Human · Buy' }}</span>
        </button>
        <button
          class="vqs-btn vqs-btn-sell"
          :disabled="curveLoading || feedbackValidating || !ownedTokens"
          @click="handleSell"
        >
          <TrendingDown :size="14" />
          <span>{{ curveLoading ? 'Processing…' : 'Robot · Sell' }}</span>
        </button>
        <button
          class="vqs-btn vqs-btn-skip"
          :disabled="feedbackValidating || curveLoading"
          @click="emit('cast-vote', 'skip')"
        >
          Next →
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Root ─────────────────────────────────────────────────────────────────── */
.vqs-root {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* ── Disclaimer ───────────────────────────────────────────────────────────── */
.vqs-disclaimer {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  padding: 0.75rem 1rem;
  background: rgba(251, 191, 36, 0.04);
  border: 1px solid rgba(251, 191, 36, 0.12);
  border-radius: 8px;
}
.vqs-disclaimer-icon {
  font-size: 0.78rem;
  color: #92400e;
  flex-shrink: 0;
  margin-top: 0.05rem;
}
.vqs-disclaimer p {
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.55;
  color: #555;
}
.vqs-disclaimer strong {
  color: #78350f;
  font-weight: 600;
}

/* ── Header ───────────────────────────────────────────────────────────────── */
.vqs-header { display: flex; flex-direction: column; gap: 0.35rem; }
.fee-note   { color: #4ade80;  }
.dex-note   { color: #92400e;  }

/* ── Search ───────────────────────────────────────────────────────────────── */
.vqs-search-wrap {
  position: relative;
}
.vqs-search-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #060606;
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 0 0.75rem;
  transition: border-color 0.15s;
}
.vqs-search-box:focus-within {
  border-color: #2a2a2a;
}
.vqs-search-icon {
  width: 14px;
  height: 14px;
  color: #333;
  flex-shrink: 0;
}
.vqs-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #aaa;
  font-size: 0.82rem;
  padding: 0.6rem 0;
}
.vqs-search-input::placeholder { color: #2e2e2e; }
.vqs-search-clear {
  background: none;
  border: none;
  color: #333;
  font-size: 1rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.12s;
}
.vqs-search-clear:hover { color: #666; }
.vqs-search-results {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: #0a0a0a;
  border: 1px solid #1e1e1e;
  border-radius: 8px;
  overflow: hidden;
  z-index: 50;
  display: flex;
  flex-direction: column;
}
.vqs-search-result {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
  border-bottom: 1px solid #111;
}
.vqs-search-result:last-child { border-bottom: none; }
.vqs-search-result:hover { background: #111; }
.vqs-sr-type {
  font-size: 0.65rem;
  font-weight: 700;
  color: #444;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}
.vqs-sr-desc {
  font-size: 0.8rem;
  color: #888;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vqs-sr-addr {
  font-size: 0.68rem;
  color: #333;
  font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0;
}
.vqs-search-empty {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  padding: 0.75rem 0.85rem;
  background: #0a0a0a;
  border: 1px solid #1e1e1e;
  border-radius: 8px;
  font-size: 0.78rem;
  color: #333;
  z-index: 50;
}

/* ── Empty / loading ──────────────────────────────────────────────────────── */
.vqs-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  color: #444;
  font-size: 0.88rem;
}
.vqs-empty-icon { opacity: 0.3; }
.vqs-spinner {
  width: 20px; height: 20px;
  border: 2px solid #222;
  border-top-color: #4ade80;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Card ─────────────────────────────────────────────────────────────────── */
.vqs-card {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background: #090909;
  border: 1px solid #181818;
  border-radius: 12px;
  padding: 1.25rem;
}

/* ── Progress ─────────────────────────────────────────────────────────────── */
.vqs-progress {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.vqs-progress-track {
  flex: 1;
  height: 2px;
  background: #1a1a1a;
  border-radius: 2px;
  overflow: hidden;
}
.vqs-progress-fill {
  height: 100%;
  background: #4ade80;
  transition: width 0.3s ease;
}
.vqs-progress-label {
  font-size: 0.72rem;
  color: #444;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
}

/* ── Badges ───────────────────────────────────────────────────────────────── */
.vqs-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.badge-type    { background: #141414; color: #666; border: 1px solid #222; }
.badge-chain   { background: #0d1a0d; color: #4ade80; border: 1px solid #1a3a1a; }
.badge-strength { background: #1a1300; color: #fbbf24; border: 1px solid #2d2200; }
.badge-price   { background: #0a0a12; color: #818cf8; border: 1px solid #1e1e2e; font-family: 'JetBrains Mono', monospace; }
.badge-supply  { background: #141414; color: #888; border: 1px solid #1e1e1e; font-family: 'JetBrains Mono', monospace; }
.badge-dex     { background: #0d1f0d; color: #4ade80; border: 1px solid #1e4a1e; font-weight: 600; letter-spacing: 0.02em; }

/* ── Description ──────────────────────────────────────────────────────────── */
.vqs-desc {
  font-size: 0.88rem;
  color: #bbb;
  line-height: 1.5;
  margin: 0;
}

/* ── Details ──────────────────────────────────────────────────────────────── */
.vqs-details {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.75rem;
  background: #060606;
  border: 1px solid #141414;
  border-radius: 8px;
}
.vqs-detail-row {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 0.5rem;
  align-items: baseline;
}
.vqs-detail-label {
  font-size: 0.7rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.vqs-detail-val {
  font-size: 0.82rem;
  color: #888;
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}
.vqs-detail-code {
  font-size: 0.82rem;
  color: #818cf8;
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}

/* ── Chart ────────────────────────────────────────────────────────────────── */
.vqs-chart-wrap {
  border: 1px solid #141414;
  border-radius: 8px;
  overflow: hidden;
}
.vqs-chart-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.45rem 0.75rem;
  background: #060606;
  border-bottom: 1px solid #111;
}
.vqs-chart-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #888;
}
.vqs-chart-stats {
  font-size: 0.68rem;
  color: #444;
  font-family: 'JetBrains Mono', monospace;
}
.vqs-chart {
  width: 100%;
  height: 512px;
  background: #060606;
}

@media (max-width: 640px) {
  .vqs-chart {
    height: 100dvh;
  }
}

/* ── Trade panel ──────────────────────────────────────────────────────────── */
.vqs-trade {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.vqs-trade-balances {
  display: flex;
  gap: 1.5rem;
}
.vqs-balance-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.vqs-balance-label {
  font-size: 0.7rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.vqs-balance-val {
  font-size: 0.82rem;
  color: #888;
  font-family: 'JetBrains Mono', monospace;
}
.vqs-owned-val { color: #4ade80; }

.vqs-input-row {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.vqs-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.vqs-sol-input {
  width: 100%;
  padding-right: 2.8rem;
  box-sizing: border-box;
}
.vqs-input-unit {
  position: absolute;
  right: 0.65rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.72rem;
  color: #444;
  font-family: 'JetBrains Mono', monospace;
  pointer-events: none;
}

.vqs-max-btn {
  flex-shrink: 0;
  padding: 0 0.75rem;
  height: 36px;
  background: transparent;
  border: 1px solid #1e1e1e;
  border-radius: 6px;
  color: #4ade80;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
.vqs-max-btn:hover {
  background: rgba(74, 222, 128, 0.06);
  border-color: rgba(74, 222, 128, 0.3);
}
.vqs-max-sell {
  color: #f87171;
}
.vqs-max-sell:hover {
  background: rgba(248, 113, 113, 0.06);
  border-color: rgba(248, 113, 113, 0.3);
}
.vqs-max-btn:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.vqs-token-est {
  font-size: 0.75rem;
  color: #444;
  padding-left: 0.1rem;
}
.vqs-token-est strong { color: #888; }

.vqs-quote {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.6rem 0.75rem;
  background: #060606;
  border: 1px solid #141414;
  border-radius: 6px;
}
.vqs-quote-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.vqs-quote-label { font-size: 0.72rem; color: #888; }
.vqs-quote-val   { font-size: 0.78rem; color: #888; font-family: 'JetBrains Mono', monospace; }
.vqs-quote-fee   { color: #444; }
.vqs-quote-green { color: #4ade80; }

/* ── Feedback ─────────────────────────────────────────────────────────────── */
.vqs-feedback {
  width: 100%;
  box-sizing: border-box;
  background: #060606;
  border: 1px solid #1a1a1a;
  border-radius: 6px;
  color: #aaa;
  font-size: 0.82rem;
  padding: 0.55rem 0.75rem;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
}
.vqs-feedback:focus { border-color: #2a2a2a; }
.vqs-feedback::placeholder { color: #888; }

/* ── Action buttons ───────────────────────────────────────────────────────── */
.vqs-actions {
  display: flex;
  gap: 0.5rem;
}
.vqs-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.6rem 1rem;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  border: 1px solid transparent;
}
.vqs-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.vqs-btn-back {
  background: transparent;
  border-color: #1e1e1e;
  color: #444;
  padding: 0.6rem 0.75rem;
  font-size: 0.78rem;
}
.vqs-btn-back:not(:disabled):hover {
  background: #111;
  color: #666;
  border-color: #2a2a2a;
}

.vqs-btn-buy {
  flex: 1.5;
  background: rgba(74, 222, 128, 0.07);
  border-color: rgba(74, 222, 128, 0.2);
  color: #4ade80;
}
.vqs-btn-buy:not(:disabled):hover {
  background: rgba(74, 222, 128, 0.13);
  border-color: rgba(74, 222, 128, 0.4);
}

.vqs-btn-sell {
  flex: 1.5;
  background: rgba(248, 113, 113, 0.07);
  border-color: rgba(248, 113, 113, 0.2);
  color: #f87171;
}
.vqs-btn-sell:not(:disabled):hover {
  background: rgba(248, 113, 113, 0.13);
  border-color: rgba(248, 113, 113, 0.4);
}

.vqs-btn-skip {
  background: #0e0e0e;
  border-color: #1e1e1e;
  color: #444;
  padding: 0.6rem 0.75rem;
}
.vqs-btn-skip:not(:disabled):hover {
  background: #141414;
  color: #666;
}
/* Referral share */
.vqs-share-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.vqs-share-btn {
  padding: 0.3rem 0.85rem;
  background: #0a0a14;
  border: 1px solid #1e1e2e;
  border-radius: 6px;
  color: #818cf8;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.vqs-share-btn:hover:not(:disabled) { background: #12122a; border-color: #3a3a6a; }
.vqs-share-btn:disabled { opacity: 0.35; cursor: default; }
.vqs-share-hint {
  font-size: 0.7rem;
  color: #444;
}

/* Creator fee claim */
.vqs-creator-claim {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  background: #080a08;
  border: 1px solid #152015;
  border-radius: 8px;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}
.vqs-creator-label {
  font-size: 0.72rem;
  color: #3a6b3a;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.vqs-creator-fees {
  font-size: 0.82rem;
  color: #7ec87e;
  flex: 1;
}
.vqs-creator-fees--empty { color: #2a2a2a; }
.vqs-claim-btn {
  padding: 0.3rem 0.8rem;
  background: #0d1f0d;
  border: 1px solid #1e4a1e;
  border-radius: 6px;
  color: #6abf6a;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  flex-shrink: 0;
}
.vqs-claim-btn:hover:not(:disabled) { background: #122212; border-color: #2a6a2a; }
.vqs-claim-btn:disabled { opacity: 0.35; cursor: default; }
.vqs-claim-msg {
  width: 100%;
  font-size: 0.74rem;
  padding: 0.25rem 0;
}
.vqs-claim-msg--ok  { color: #4caf50; }
.vqs-claim-msg--err { color: #e05050; }
</style>
