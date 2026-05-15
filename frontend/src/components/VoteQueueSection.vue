<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { Code, TrendingUp, TrendingDown } from 'lucide-vue-next'
import { createChart } from 'lightweight-charts'

const props = defineProps({
  loading:            { type: Boolean, default: false },
  votingList:         { type: Array,   default: () => [] },
  voteIndex:          { type: Number,  default: 0 },
  currentVoteItem:    { type: Object,  default: null },
  voteSubmitting:     { type: Boolean, default: false },
  voteFeedback:       { type: String,  default: '' },
  feedbackValidating: { type: Boolean, default: false },
  // curve props
  curveState:         { type: Object,  default: null },
  chartCandles:       { type: Array,   default: () => [] },
  solBalance:         { type: Number,  default: 0 },
  ownedTokens:        { type: Number,  default: 0 },
  quoteResult:        { type: Object,  default: null },
  curveLoading:       { type: Boolean, default: false },
})

const emit = defineEmits([
  'update:voteIndex',
  'update:voteFeedback',
  'cast-vote',
  'auto-expand',
  // curve
  'curve-buy',
  'curve-sell',
  'curve-quote',
])

// ── Chart ────────────────────────────────────────────────────────────────────
const chartContainer = ref(null)
let chart     = null
let lineSeries = null

function buildChart() {
  if (!chartContainer.value) return
  if (chart) { chart.remove(); chart = null; lineSeries = null }

  chart = createChart(chartContainer.value, {
    width:  chartContainer.value.clientWidth,
    height: 160,
    layout: {
      background: { color: '#080808' },
      textColor:  '#555',
    },
    grid: {
      vertLines: { color: '#111' },
      horzLines: { color: '#111' },
    },
    crosshair: { mode: 1 },
    rightPriceScale: {
      borderColor: '#1a1a1a',
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: '#1a1a1a',
      timeVisible: true,
    },
    handleScroll: false,
    handleScale:  false,
  })

  lineSeries = chart.addAreaSeries({
    lineColor:        '#4ade80',
    topColor:         'rgba(74,222,128,0.18)',
    bottomColor:      'rgba(74,222,128,0)',
    lineWidth:        2,
    priceFormat:      { type: 'price', precision: 9, minMove: 0.000000001 },
  })

  applyChartData()
}

function applyChartData() {
  if (!lineSeries || !props.chartCandles.length) return
  const data = props.chartCandles.map(c => ({ time: c.time, value: c.close / 1e9 }))
  lineSeries.setData(data)
  chart.timeScale().fitContent()
}

watch(() => props.chartCandles, applyChartData, { deep: true })
watch(() => props.currentVoteItem, async (newItem) => {
  if (!newItem) return
  await nextTick()
  buildChart()
})

const resizeObs = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(() => { if (chart && chartContainer.value) chart.applyOptions({ width: chartContainer.value.clientWidth }) })
  : null

watch(chartContainer, (el) => {
  if (el && resizeObs) resizeObs.observe(el)
})

onMounted(() => { if (props.currentVoteItem) nextTick(buildChart) })
onUnmounted(() => {
  resizeObs?.disconnect()
  chart?.remove()
})

// ── Trade input ──────────────────────────────────────────────────────────────
const betTokens = ref('')

function setMaxBuy() {
  if (!props.solBalance || !props.curveState) return
  // Rough max: all SOL minus a small reserve for gas (~0.002 SOL)
  const availSol     = Math.max(0, props.solBalance - 0.002)
  const availLamports = Math.floor(availSol * 1e9)
  // Binary-search for max tokens buyable
  const { BASE_PRICE, SLOPE } = { BASE_PRICE: 100_000, SLOPE: 100 }
  const s = props.curveState.supply || 0
  // quadratic: SLOPE/2 * n^2 + (BASE_PRICE + SLOPE*s) * n - availLamports = 0
  const a = SLOPE / 2, b = BASE_PRICE + SLOPE * s, c = -availLamports
  const n = Math.floor((-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a))
  betTokens.value = String(Math.max(1, n))
  onAmountInput()
}

function setMaxSell() {
  betTokens.value = String(props.ownedTokens || 0)
  onAmountInput()
}

function onAmountInput() {
  const n = parseInt(betTokens.value)
  if (!n || n <= 0 || !props.currentVoteItem) return
  emit('curve-quote', props.currentVoteItem.id, n)
}

function handleBuy() {
  const n = parseInt(betTokens.value)
  if (!n || n <= 0) return
  emit('curve-buy', props.currentVoteItem.id, n)
}

function handleSell() {
  const n = parseInt(betTokens.value)
  if (!n || n <= 0) return
  emit('curve-sell', props.currentVoteItem.id, n)
}

// Formatted price display
function fmtPrice(lamports) {
  if (lamports == null) return '—'
  const sol = lamports / 1e9
  if (sol < 0.000001) return sol.toFixed(9) + ' SOL'
  if (sol < 0.001)    return sol.toFixed(7) + ' SOL'
  return sol.toFixed(5) + ' SOL'
}

function fmtSol(n) {
  return (n || 0).toFixed(4)
}

function signalStrength(item) {
  if (!props.curveState) return item.score?.toFixed(1) ?? '0.0'
  const curveBoost = 1 + Math.log1p(Math.max(0, (props.curveState.supply || 0) / 100)) * 0.3
  return ((item.score || 0) * curveBoost).toFixed(1)
}
</script>

<template>
  <div class="votes-page">
    <div class="votes-header">
      <div class="scan-tag">CONSENSUS QUEUE</div>
      <h2 class="scan-title">Signal feedback</h2>
      <p class="scan-sub">Buy to signal human confidence — sell to withdraw trust. Your POH stake weight and market position determine your influence. 5% protocol fee on all trades.</p>
    </div>

    <div v-if="loading" class="empty-state"><p>Loading...</p></div>

    <div v-else-if="!currentVoteItem" class="empty-state">
      <Code :size="28" />
      <p>{{ votingList.length ? 'All signals reviewed.' : 'Queue is empty.' }}</p>
      <button v-if="votingList.length" class="utility-link" @click="emit('update:voteIndex', 0)">Start over</button>
    </div>

    <div v-else class="vote-single">
      <!-- Progress -->
      <div class="vote-progress">
        <div class="vote-progress-bar">
          <div class="vote-progress-fill" :style="{ width: (voteIndex / votingList.length * 100) + '%' }"></div>
        </div>
        <span class="vote-progress-label">{{ voteIndex + 1 }} / {{ votingList.length }}</span>
      </div>

      <div class="vote-card-single">

        <!-- Method metadata -->
        <div class="vcs-meta">
          <span class="vmc-type">{{ currentVoteItem.type?.toUpperCase() }}</span>
          <span v-if="currentVoteItem.chainId" class="vcs-chain">chain {{ currentVoteItem.chainId }}</span>
          <span class="vmc-score">strength {{ signalStrength(currentVoteItem) }}</span>
          <span v-if="curveState" class="vcs-price">{{ fmtPrice(curveState.currentPrice) }}</span>
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

        <!-- Bonding curve chart -->
        <div class="curve-chart-wrap">
          <div class="curve-chart-header">
            <span class="curve-chart-label">Signal price</span>
            <span v-if="curveState" class="curve-stats">
              <span>supply {{ curveState.supply ?? 0 }}</span>
              <span>vol {{ fmtSol(curveState.totalVolumeSol / 1e9) }} SOL</span>
            </span>
          </div>
          <div ref="chartContainer" class="curve-chart"></div>
        </div>

        <!-- Trade section -->
        <div class="trade-section">
          <div class="trade-balance-row">
            <span class="trade-balance-label">SOL balance</span>
            <span class="trade-balance-val">{{ fmtSol(solBalance) }} SOL</span>
            <span v-if="ownedTokens > 0" class="trade-owned">owns {{ ownedTokens }} tokens</span>
          </div>

          <div class="trade-input-row">
            <input
              type="number"
              v-model="betTokens"
              @input="onAmountInput"
              placeholder="Token amount"
              min="1"
              class="premium-input trade-input"
            />
            <button class="mini-btn" @click="setMaxBuy" title="Max buyable with SOL balance">Buy max</button>
            <button class="mini-btn" @click="setMaxSell" :disabled="!ownedTokens" title="Sell all owned tokens">Sell max</button>
          </div>

          <!-- Quote preview -->
          <div v-if="quoteResult && betTokens" class="trade-quote">
            <template v-if="quoteResult.action === 'buy'">
              <span>Cost <strong>{{ (quoteResult.grossCostLamports / 1e9).toFixed(6) }} SOL</strong></span>
              <span class="trade-fee">fee {{ (quoteResult.feeLamports / 1e9).toFixed(6) }} SOL</span>
              <span>→ price after {{ fmtPrice(quoteResult.priceAfter) }}</span>
            </template>
            <template v-if="quoteResult.action === 'sell'">
              <span>Receive <strong>{{ (quoteResult.solOutLamports / 1e9).toFixed(6) }} SOL</strong></span>
              <span class="trade-fee">fee {{ (quoteResult.feeLamports / 1e9).toFixed(6) }} SOL</span>
              <span>→ price after {{ fmtPrice(quoteResult.priceAfter) }}</span>
            </template>
          </div>
        </div>

        <!-- Feedback textarea -->
        <textarea
          :value="voteFeedback"
          @input="emit('update:voteFeedback', $event.target.value)"
          class="vcs-feedback"
          placeholder="Optional: explain your reasoning…"
          rows="2"
          maxlength="200"
        ></textarea>

        <!-- Action buttons -->
        <div class="vcs-actions">
          <button
            class="vcs-btn vcs-btn-yes"
            :disabled="voteSubmitting || feedbackValidating || curveLoading"
            @click="handleBuy"
          >
            <TrendingUp :size="15" />
            {{ curveLoading ? '…' : feedbackValidating ? 'Checking…' : 'Human (Buy)' }}
          </button>
          <button
            class="vcs-btn vcs-btn-no"
            :disabled="voteSubmitting || feedbackValidating || curveLoading || !ownedTokens"
            @click="handleSell"
          >
            <TrendingDown :size="15" />
            {{ curveLoading ? '…' : feedbackValidating ? 'Checking…' : 'Robot (Sell)' }}
          </button>
          <button class="vcs-btn vcs-btn-skip" :disabled="feedbackValidating" @click="emit('cast-vote', 'skip')">
            Skip →
          </button>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Chart ─────────────────────────────────────────────────────────────── */
.curve-chart-wrap {
  margin: 1rem 0 0.5rem;
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
}
.curve-chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem 0.35rem;
  background: #0a0a0a;
}
.curve-chart-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #444;
}
.curve-stats {
  display: flex;
  gap: 0.75rem;
  font-size: 0.72rem;
  color: #555;
}
.curve-chart {
  width: 100%;
  background: #080808;
}

/* ── Price badge ────────────────────────────────────────────────────────── */
.vcs-price {
  font-size: 0.72rem;
  color: #4ade80;
  font-family: 'JetBrains Mono', monospace;
  margin-left: auto;
}

/* ── Trade section ──────────────────────────────────────────────────────── */
.trade-section {
  margin: 0.75rem 0 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.trade-balance-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.78rem;
  color: #555;
}
.trade-balance-label { color: #444; }
.trade-balance-val   { color: #aaa; font-family: 'JetBrains Mono', monospace; }
.trade-owned         { margin-left: auto; color: #4ade80; font-size: 0.72rem; }

.trade-input-row {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.trade-input {
  flex: 1;
  min-width: 0;
}

.trade-quote {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  font-size: 0.78rem;
  color: #666;
  padding: 0.4rem 0.6rem;
  background: #0a0a0a;
  border: 1px solid #1a1a1a;
  border-radius: 6px;
}
.trade-quote strong { color: #ccc; }
.trade-fee          { color: #444; }

/* ── Action buttons ─────────────────────────────────────────────────────── */
.vcs-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.vcs-btn-yes {
  flex: 1.4;
  background: rgba(74,222,128,0.08);
  border-color: rgba(74,222,128,0.25);
  color: #4ade80;
}
.vcs-btn-yes:not(:disabled):hover {
  background: rgba(74,222,128,0.15);
  border-color: rgba(74,222,128,0.5);
}
.vcs-btn-no {
  flex: 1.4;
  background: rgba(248,113,113,0.08);
  border-color: rgba(248,113,113,0.25);
  color: #f87171;
}
.vcs-btn-no:not(:disabled):hover {
  background: rgba(248,113,113,0.15);
  border-color: rgba(248,113,113,0.5);
}
.vcs-btn-no:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
