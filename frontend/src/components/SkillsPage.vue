<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['navigate'])

// ── Demo fallback data ────────────────────────────────────────────────────────
const DEMO_SKILLS = [
  {
    id: 'poh_identity',
    version: '1.0.0',
    author: 'poh_protocol',
    description: 'Proof-of-Human identity verification using on-chain signals and AI brain',
    status: 'active',
    totalStaked: 50000,
    private: false,
  }
]

// ── State ─────────────────────────────────────────────────────────────────────
const skills = ref([])
const loading = ref(true)
const selectedSkill = ref(null)

// ── Helpers ───────────────────────────────────────────────────────────────────
const minerBase = window._pohMinerBase || 'https://miner.proofofhuman.ge'

function truncate(str, n) {
  if (!str) return ''
  return str.length > n ? str.slice(0, n) + '…' : str
}

function convictionPct(totalStaked) {
  return Math.min(100, ((totalStaked || 0) / 10000) * 100)
}

// ── Load skills from miner network (fall back to demo) ────────────────────────
async function loadSkills() {
  loading.value = true
  try {
    const res = await fetch(`${minerBase}/api/skills`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    skills.value = (data.skills || []).filter(s => !s.private)
  } catch {
    skills.value = DEMO_SKILLS
  } finally {
    loading.value = false
  }
}

function openDetail(skill) { selectedSkill.value = skill }
function closeDetail()     { selectedSkill.value = null }

onMounted(loadSkills)
</script>

<template>
  <div class="sp-root">
    <!-- Navbar -->
    <header class="lp-nav">
      <div class="lp-nav-logo" @click="emit('navigate', 'landing')">
        <img src="/poh-icon.png" alt="POH" class="lp-logo-img" />
      </div>
      <nav class="lp-nav-links">
        <button class="lp-nav-btn" @click="emit('navigate', 'landing')">← Back</button>
      </nav>
    </header>

    <!-- Loading spinner -->
    <div v-if="loading" class="sp-spinner-wrap">
      <div class="sp-spinner"></div>
      <span class="sp-spinner-label">Loading skills…</span>
    </div>

    <!-- Detail view -->
    <div v-else-if="selectedSkill" class="sp-detail-wrap">
      <div class="sp-detail">
        <button class="sp-back-btn" @click="closeDetail()">← Skills</button>

        <div class="sp-detail-header">
          <span class="sp-detail-id">{{ selectedSkill.id }}</span>
          <span class="sp-badge" :class="selectedSkill.status === 'active' ? 'sp-badge--active' : 'sp-badge--proposed'">
            {{ selectedSkill.status === 'active' ? 'Active' : 'Proposed' }}
          </span>
        </div>

        <!-- Manifest -->
        <section class="sp-section">
          <h3 class="sp-section-title">Manifest</h3>
          <table class="sp-manifest-table">
            <tbody>
              <tr><td class="sp-mt-key">ID</td><td class="sp-mt-val">{{ selectedSkill.id }}</td></tr>
              <tr><td class="sp-mt-key">Version</td><td class="sp-mt-val">{{ selectedSkill.version || '—' }}</td></tr>
              <tr><td class="sp-mt-key">Author</td><td class="sp-mt-val">{{ selectedSkill.author || '—' }}</td></tr>
              <tr><td class="sp-mt-key">Description</td><td class="sp-mt-val">{{ selectedSkill.description || '—' }}</td></tr>
              <tr v-if="selectedSkill.allowedEndpoints">
                <td class="sp-mt-key">Endpoints</td>
                <td class="sp-mt-val">{{ selectedSkill.allowedEndpoints?.join(', ') || '—' }}</td>
              </tr>
              <tr><td class="sp-mt-key">Status</td><td class="sp-mt-val">{{ selectedSkill.status }}</td></tr>
            </tbody>
          </table>
        </section>

        <!-- Staking conviction (read-only) -->
        <section class="sp-section">
          <h3 class="sp-section-title">Staking Conviction</h3>
          <div class="sp-conv-bar-wrap">
            <div class="sp-conv-bar-bg">
              <div class="sp-conv-bar-fill" :style="{ width: convictionPct(selectedSkill.totalStaked) + '%' }"></div>
            </div>
            <div class="sp-conv-label">
              POH staked: <strong>{{ (selectedSkill.totalStaked || 0).toLocaleString() }}</strong> / 10,000 (graduation threshold)
            </div>
          </div>
          <div v-if="selectedSkill.status === 'active'" class="sp-graduated-badge">✓ Graduated</div>
          <div v-else class="sp-conv-progress">
            {{ convictionPct(selectedSkill.totalStaked).toFixed(1) }}% toward graduation
          </div>
          <p class="sp-stake-hint">
            Stake POH on skills from your <a href="https://miner.proofofhuman.ge" target="_blank" class="sp-link">miner node</a>.
          </p>
        </section>

        <!-- Run this skill -->
        <section v-if="selectedSkill.inputSchema" class="sp-section">
          <h3 class="sp-section-title">Run This Skill</h3>
          <pre class="sp-schema-pre">{{ JSON.stringify(selectedSkill.inputSchema, null, 2) }}</pre>
        </section>
      </div>
    </div>

    <!-- Skills grid -->
    <div v-else class="sp-main">
      <div class="sp-header">
        <h1 class="sp-page-title">Skills</h1>
        <p class="sp-page-sub">
          Third-party skills extend the PoH network. Stake POH to signal conviction and graduate skills to mainnet.
        </p>
        <div v-if="!apiReachable" class="sp-demo-note">
          Showing demo data — no miner node reachable at <code>{{ minerBase }}</code>
        </div>
      </div>

      <div class="sp-grid">
        <div
          v-for="skill in skills"
          :key="skill.id"
          class="sp-card"
          @click="openDetail(skill)"
        >
          <div class="sp-card-top">
            <span class="sp-card-id">{{ skill.id }}</span>
            <span class="sp-badge" :class="skill.status === 'active' ? 'sp-badge--active' : 'sp-badge--proposed'">
              {{ skill.status === 'active' ? 'Active' : 'Proposed' }}
            </span>
          </div>
          <p class="sp-card-desc">{{ skill.description }}</p>
          <div class="sp-card-meta">
            <span class="sp-card-author">{{ truncate(skill.author, 16) }}</span>
            <span class="sp-card-staked">{{ (skill.totalStaked || 0).toLocaleString() }} POH staked</span>
          </div>
          <div class="sp-conv-bar-bg sp-conv-bar-bg--card">
            <div class="sp-conv-bar-fill" :style="{ width: convictionPct(skill.totalStaked) + '%' }"></div>
          </div>
        </div>
      </div>

      <div v-if="skills.length === 0" class="sp-empty">
        No skills found on this node.
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ── Root & shared vars ──────────────────────────────────────────────────────── */
.sp-root {
  min-height: 100vh;
  background: #000;
  color: #fff;
  display: flex;
  flex-direction: column;
  font-family: 'Iceland', sans-serif;
}

/* ── Navbar (matches LandingPage) ────────────────────────────────────────────── */
.lp-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.1rem 2rem;
  border-bottom: 1px solid #111;
  position: sticky;
  top: 0;
  background: #000;
  z-index: 100;
}

.lp-nav-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
}

.lp-logo-img {
  width: 64px;
  height: 64px;
}

.lp-nav-links {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.lp-nav-btn {
  background: transparent;
  color: #aaa;
  border: 1px solid #1e1e1e;
  padding: 0.45rem 1rem;
  border-radius: 6px;
  font-family: inherit;
  font-size: 1.25rem;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.15s, border-color 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.lp-nav-btn:hover {
  color: #fff;
  border-color: #333;
}


/* ── Spinner ─────────────────────────────────────────────────────────────────── */
.sp-spinner-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 4rem;
}

.sp-spinner {
  width: 36px;
  height: 36px;
  border: 2px solid #1e1e1e;
  border-top-color: #22c55e;
  border-radius: 50%;
  animation: sp-spin 0.8s linear infinite;
}

@keyframes sp-spin {
  to { transform: rotate(360deg); }
}

.sp-spinner-label {
  color: #555;
  font-size: 0.9rem;
}

/* ── Main / header ───────────────────────────────────────────────────────────── */
.sp-main {
  flex: 1;
  padding: 2.5rem 2rem;
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.sp-header {
  margin-bottom: 2.5rem;
}

.sp-page-title {
  font-size: 2rem;
  font-weight: 700;
  color: #fff;
  margin: 0 0 0.5rem;
  letter-spacing: 0.03em;
}

.sp-page-sub {
  color: #555;
  font-size: 1.25rem;
  line-height: 1.65;
  margin: 0 0 0.75rem;
}

.sp-demo-note {
  display: inline-block;
  border: 1px solid #1e1e1e;
  color: #666;
  font-size: 0.78rem;
  padding: 0.3rem 0.75rem;
  border-radius: 4px;
}

.sp-demo-note code {
  color: #aaa;
  font-family: monospace;
}

/* ── Grid ────────────────────────────────────────────────────────────────────── */
.sp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 1px;
  background: #111;
  border: 1px solid #111;
}

/* ── Card ────────────────────────────────────────────────────────────────────── */
.sp-card {
  background: #000;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sp-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.sp-card-id {
  font-family: monospace;
  font-size: 1rem;
  color: #fff;
  letter-spacing: 0.04em;
}

.sp-card-desc {
  color: #555;
  font-size: 1.25rem;
  line-height: 1.6;
  margin: 0;
  flex: 1;
}

.sp-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.78rem;
  color: #444;
}

.sp-card-author {
  font-family: monospace;
}

.sp-card-staked {
  color: #22c55e;
  opacity: 0.75;
}

.sp-card-badges {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.sp-card {
  cursor: pointer;
}

.sp-card:hover {
  background: #060606;
}

/* ── Badges ──────────────────────────────────────────────────────────────────── */
.sp-badge {
  font-size: 0.7rem;
  padding: 0.2rem 0.55rem;
  border-radius: 3px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;
}

.sp-badge--active {
  background: #0d2b18;
  color: #22c55e;
  border: 1px solid #1a3a27;
}

.sp-badge--proposed {
  background: #111;
  color: #666;
  border: 1px solid #1e1e1e;
}

.sp-badge--private {
  background: #1a1206;
  color: #d97706;
  border: 1px solid #3a2a0a;
}

/* ── Conviction bar ──────────────────────────────────────────────────────────── */
.sp-conv-bar-bg {
  background: #111;
  border-radius: 3px;
  height: 4px;
  overflow: hidden;
}

.sp-conv-bar-bg--card {
  margin-top: 0.25rem;
}

.sp-conv-bar-fill {
  height: 100%;
  background: #22c55e;
  border-radius: 3px;
  transition: width 0.4s ease;
}

/* ── Back button ──────────────────────────────────────────────────────────────── */

/* ── Empty state ─────────────────────────────────────────────────────────────── */
.sp-empty {
  text-align: center;
  color: #333;
  padding: 4rem 2rem;
  font-size: 1.25rem;
}

/* ── Detail view ─────────────────────────────────────────────────────────────── */
.sp-detail-wrap {
  flex: 1;
  padding: 2rem;
  max-width: 780px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.sp-detail {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.sp-back-btn {
  background: transparent;
  color: #666;
  border: none;
  font-family: inherit;
  font-size: 0.9rem;
  cursor: pointer;
  padding: 0;
  align-self: flex-start;
  transition: color 0.15s;
}

.sp-back-btn:hover {
  color: #fff;
}

.sp-detail-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.sp-detail-id {
  font-family: monospace;
  font-size: 1.5rem;
  color: #fff;
  letter-spacing: 0.06em;
}

/* ── Sections ────────────────────────────────────────────────────────────────── */
.sp-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  border: 1px solid #1e1e1e;
  padding: 1.25rem 1.5rem;
  border-radius: 6px;
}

.sp-section-title {
  font-size: 0.75rem;
  color: #444;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  margin: 0;
}

/* ── Manifest table ──────────────────────────────────────────────────────────── */
.sp-manifest-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.sp-mt-key {
  color: #444;
  width: 120px;
  padding: 0.3rem 0.5rem 0.3rem 0;
  vertical-align: top;
  letter-spacing: 0.06em;
}

.sp-mt-val {
  color: #ccc;
  padding: 0.3rem 0;
  font-family: monospace;
  font-size: 0.85rem;
  line-height: 1.5;
}

/* ── Conviction detail ───────────────────────────────────────────────────────── */
.sp-conv-bar-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.sp-conv-label {
  font-size: 0.85rem;
  color: #555;
}

.sp-conv-label strong {
  color: #fff;
}

.sp-graduated-badge {
  display: inline-block;
  background: #0d2b18;
  color: #22c55e;
  border: 1px solid #1a3a27;
  padding: 0.3rem 0.75rem;
  border-radius: 4px;
  font-size: 0.85rem;
  align-self: flex-start;
}

.sp-conv-progress {
  font-size: 0.85rem;
  color: #555;
}

/* ── Stake hint ───────────────────────────────────────────────────────────────── */
.sp-stake-hint {
  color: #444;
  font-size: 1.1rem;
  margin: 0;
}

.sp-link {
  color: #22c55e;
  text-decoration: none;
}

.sp-link:hover {
  text-decoration: underline;
}

/* ── Schema pre ──────────────────────────────────────────────────────────────── */
.sp-schema-pre {
  background: #060606;
  border: 1px solid #1a1a1a;
  padding: 1rem;
  border-radius: 4px;
  font-size: 0.78rem;
  color: #666;
  overflow-x: auto;
  margin: 0;
}



/* ── Responsive ──────────────────────────────────────────────────────────────── */
@media (max-width: 600px) {
  .sp-main { padding: 1.5rem 1rem; }
  .sp-detail-wrap { padding: 1.5rem 1rem; }
  .lp-nav { padding: 0.8rem 1rem; }
  .sp-stake-input { width: 100%; }
}
</style>
