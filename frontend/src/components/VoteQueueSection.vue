<script setup>
import { ref, computed } from 'vue'
import { Code, Zap } from 'lucide-vue-next'

const props = defineProps({
  loading:            { type: Boolean, default: false },
  votingList:         { type: Array,   default: () => [] },
  voteIndex:          { type: Number,  default: 0 },
  currentVoteItem:    { type: Object,  default: null },
  voteSubmitting:     { type: Boolean, default: false },
  voteFeedback:       { type: String,  default: '' },
  feedbackValidating: { type: Boolean, default: false },
  walletAddress:      { type: String,  default: '' },
})

const emit = defineEmits([
  'update:voteIndex',
  'update:voteFeedback',
  'cast-vote',
  'auto-expand',
])

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

// ── Formatting ────────────────────────────────────────────────────────────────
function signalStrength(item) {
  return (item.score || 0).toFixed(1)
}
</script>

<template>
  <div class="vqs-root">

    <div class="vqs-header">
      <h2 class="scan-title">Vote on Signals</h2>
      <h3>Validate which signals correctly identify humans vs bots.</h3>
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
        <button class="vqs-btn vqs-btn-back" :disabled="voteIndex <= 0" @click="emit('update:voteIndex', voteIndex - 1)">← Back</button>
        <button class="vqs-btn vqs-btn-yes" :disabled="voteSubmitting || feedbackValidating" @click="emit('cast-vote', true)">
          <span>✓ Human</span>
        </button>
        <button class="vqs-btn vqs-btn-no" :disabled="voteSubmitting || feedbackValidating" @click="emit('cast-vote', false)">
          <span>✗ Bot</span>
        </button>
        <button class="vqs-btn vqs-btn-skip" :disabled="voteSubmitting || feedbackValidating" @click="emit('cast-vote', 'skip')">Next →</button>
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

/* ── Header ───────────────────────────────────────────────────────────────── */
.vqs-header { display: flex; flex-direction: column; gap: 0.35rem; }

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

.vqs-btn-yes {
  flex: 1.5;
  background: rgba(34, 197, 94, 0.07);
  border-color: #22c55e;
  color: #22c55e;
}
.vqs-btn-yes:not(:disabled):hover {
  background: rgba(34, 197, 94, 0.13);
  border-color: #22c55e;
}

.vqs-btn-no {
  flex: 1.5;
  background: rgba(239, 68, 68, 0.07);
  border-color: #ef4444;
  color: #ef4444;
}
.vqs-btn-no:not(:disabled):hover {
  background: rgba(239, 68, 68, 0.13);
  border-color: #ef4444;
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
</style>
