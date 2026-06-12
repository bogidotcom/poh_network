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
    myStake: 0,
    private: false,
  }
]

// ── State ─────────────────────────────────────────────────────────────────────
const skills = ref([])
const loading = ref(true)
const apiReachable = ref(false)
const selectedSkill = ref(null)
const stakeAmount = ref('')
const stakeError = ref('')
const stakeSuccess = ref('')
const staking = ref(false)

// ── Create skill modal ────────────────────────────────────────────────────────
const showCreate = ref(false)
const createForm = ref({ id: '', version: '1.0.0', description: '', code: '', isPrivate: false })
const createError = ref('')
const createLoading = ref(false)

function openCreate() {
  createForm.value = { id: '', version: '1.0.0', description: '', code: '', isPrivate: false }
  createError.value = ''
  showCreate.value = true
}

function closeCreate() {
  showCreate.value = false
}

async function doCreate() {
  createError.value = ''
  const { id, version, description, code, isPrivate } = createForm.value
  if (!id.trim()) { createError.value = 'Skill ID is required'; return }
  if (!code.trim()) { createError.value = 'Skill code is required'; return }
  createLoading.value = true
  try {
    const res = await fetch(`${minerBase}/api/skills/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: { id: id.trim(), version, description },
        code: code.trim(),
        private: isPrivate,
      }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Failed to propose skill')
    closeCreate()
    await loadSkills()
  } catch (e) {
    createError.value = e.message
  } finally {
    createLoading.value = false
  }
}

async function doPublish(skillId) {
  try {
    const res = await fetch(`${minerBase}/api/skills/${encodeURIComponent(skillId)}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Publish failed')
    await loadSkills()
    if (selectedSkill.value?.id === skillId) {
      selectedSkill.value = { ...selectedSkill.value, private: false }
    }
  } catch (e) {
    alert(`Publish failed: ${e.message}`)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const minerBase = window._pohMinerBase || 'https://miner.proofofhuman.ge'

function truncate(str, n) {
  if (!str) return ''
  return str.length > n ? str.slice(0, n) + '…' : str
}

function convictionPct(totalStaked) {
  return Math.min(100, ((totalStaked || 0) / 10000) * 100)
}

// ── Load skills from miner API (or fall back to demo) ────────────────────────
async function loadSkills() {
  loading.value = true
  try {
    const res = await fetch(`${minerBase}/api/skills`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    skills.value = data.skills || []
    apiReachable.value = true
  } catch {
    skills.value = DEMO_SKILLS
    apiReachable.value = false
  } finally {
    loading.value = false
  }
}

// ── Staking actions ───────────────────────────────────────────────────────────
async function doStake() {
  if (!apiReachable.value) return
  const amount = Number(stakeAmount.value)
  if (!amount || amount <= 0) { stakeError.value = 'Enter a valid amount'; return }
  stakeError.value = ''
  stakeSuccess.value = ''
  staking.value = true
  try {
    const res = await fetch(`${minerBase}/api/skills/${selectedSkill.value.id}/stake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, stakerAddress: 'anon' }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Stake failed')
    selectedSkill.value = { ...selectedSkill.value, totalStaked: data.total, myStake: data.myStake }
    // Update skills list
    const idx = skills.value.findIndex(s => s.id === selectedSkill.value.id)
    if (idx !== -1) skills.value[idx] = { ...skills.value[idx], totalStaked: data.total, myStake: data.myStake }
    stakeSuccess.value = `Staked ${amount} POH`
    stakeAmount.value = ''
  } catch (e) {
    stakeError.value = e.message
  } finally {
    staking.value = false
  }
}

async function doUnstake() {
  if (!apiReachable.value) return
  const amount = Number(stakeAmount.value)
  if (!amount || amount <= 0) { stakeError.value = 'Enter a valid amount'; return }
  stakeError.value = ''
  stakeSuccess.value = ''
  staking.value = true
  try {
    const res = await fetch(`${minerBase}/api/skills/${selectedSkill.value.id}/unstake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, stakerAddress: 'anon' }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Unstake failed')
    selectedSkill.value = { ...selectedSkill.value, totalStaked: data.total, myStake: data.myStake }
    const idx = skills.value.findIndex(s => s.id === selectedSkill.value.id)
    if (idx !== -1) skills.value[idx] = { ...skills.value[idx], totalStaked: data.total, myStake: data.myStake }
    stakeSuccess.value = `Unstaked ${amount} POH`
    stakeAmount.value = ''
  } catch (e) {
    stakeError.value = e.message
  } finally {
    staking.value = false
  }
}

function openDetail(skill) {
  selectedSkill.value = skill
  stakeAmount.value = ''
  stakeError.value = ''
  stakeSuccess.value = ''
}

function closeDetail() {
  selectedSkill.value = null
}

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
        <button class="lp-nav-btn lp-nav-btn--submit" @click="openCreate()">Submit Skill</button>
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
          <span v-if="selectedSkill.private" class="sp-badge sp-badge--private">Private</span>
        </div>

        <!-- Publish section (only for private skills) -->
        <section v-if="selectedSkill.private" class="sp-section sp-section--private">
          <h3 class="sp-section-title">Private Skill</h3>
          <p class="sp-private-note">
            This skill is stored on your local node only. Other nodes cannot see or use it.
            When you publish, it is broadcast to the network and queued for the next block.
          </p>
          <button class="sp-btn sp-btn--publish" @click="doPublish(selectedSkill.id)">
            Publish to Network
          </button>
        </section>

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

        <!-- Staking conviction -->
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
        </section>

        <!-- Staking section -->
        <section class="sp-section">
          <h3 class="sp-section-title">Staking</h3>
          <div v-if="!apiReachable" class="sp-no-miner">
            Connect to a miner node to stake POH
          </div>
          <div v-else class="sp-stake-ui">
            <div class="sp-my-stake">
              My stake: <strong>{{ (selectedSkill.myStake || 0).toLocaleString() }} POH</strong>
            </div>
            <div class="sp-stake-row">
              <input
                v-model="stakeAmount"
                type="number"
                min="1"
                placeholder="Amount (POH)"
                class="sp-stake-input"
              />
              <button class="sp-btn sp-btn--stake" :disabled="staking" @click="doStake()">Stake</button>
              <button class="sp-btn sp-btn--unstake" :disabled="staking" @click="doUnstake()">Unstake</button>
            </div>
            <div v-if="stakeError" class="sp-stake-error">{{ stakeError }}</div>
            <div v-if="stakeSuccess" class="sp-stake-ok">{{ stakeSuccess }}</div>
          </div>
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
        >
          <div class="sp-card-top">
            <span class="sp-card-id">{{ skill.id }}</span>
            <div class="sp-card-badges">
              <span class="sp-badge sp-badge--private" v-if="skill.private">Private</span>
              <span class="sp-badge" :class="skill.status === 'active' ? 'sp-badge--active' : 'sp-badge--proposed'">
                {{ skill.status === 'active' ? 'Active' : 'Proposed' }}
              </span>
            </div>
          </div>
          <p class="sp-card-desc">{{ skill.description }}</p>
          <div class="sp-card-meta">
            <span class="sp-card-author">{{ truncate(skill.author, 16) }}</span>
            <span class="sp-card-staked" v-if="!skill.private">{{ (skill.totalStaked || 0).toLocaleString() }} POH staked</span>
            <span class="sp-card-staked sp-card-staked--private" v-else>Local only</span>
          </div>
          <!-- Conviction progress bar (public skills only) -->
          <div v-if="!skill.private" class="sp-conv-bar-bg sp-conv-bar-bg--card">
            <div class="sp-conv-bar-fill" :style="{ width: convictionPct(skill.totalStaked) + '%' }"></div>
          </div>
          <div class="sp-card-actions">
            <template v-if="skill.private">
              <button class="sp-btn sp-btn--publish" @click="doPublish(skill.id)">Publish</button>
              <button class="sp-btn sp-btn--details" @click="openDetail(skill)">Details</button>
            </template>
            <template v-else>
              <button class="sp-btn sp-btn--stake-outline" @click="openDetail(skill)">Stake</button>
              <button class="sp-btn sp-btn--details" @click="openDetail(skill)">Details</button>
            </template>
          </div>
        </div>
      </div>

      <div v-if="skills.length === 0" class="sp-empty">
        No skills found on this node.
      </div>
    </div>

    <!-- Create Skill Modal -->
    <div v-if="showCreate" class="sp-modal-overlay" @click.self="closeCreate()">
      <div class="sp-modal">
        <div class="sp-modal-header">
          <h2 class="sp-modal-title">Submit Skill</h2>
          <button class="sp-modal-close" @click="closeCreate()">×</button>
        </div>

        <div class="sp-modal-body">
          <div class="sp-field">
            <label class="sp-field-label">Skill ID</label>
            <input v-model="createForm.id" class="sp-field-input" placeholder="e.g. my_skill" />
          </div>

          <div class="sp-field">
            <label class="sp-field-label">Version</label>
            <input v-model="createForm.version" class="sp-field-input" placeholder="1.0.0" />
          </div>

          <div class="sp-field">
            <label class="sp-field-label">Description</label>
            <input v-model="createForm.description" class="sp-field-input" placeholder="What does this skill do?" />
          </div>

          <div class="sp-field">
            <label class="sp-field-label">Code (JS — must export <code>async function run(input, config)</code>)</label>
            <textarea v-model="createForm.code" class="sp-field-textarea" rows="8"
              placeholder="module.exports.run = async function(input, config) {&#10;  return { result: 'hello' };&#10;};" />
          </div>

          <div class="sp-field sp-field--toggle">
            <label class="sp-toggle-label">
              <input type="checkbox" v-model="createForm.isPrivate" class="sp-toggle-input" />
              <span class="sp-toggle-track"><span class="sp-toggle-thumb"></span></span>
              <span class="sp-toggle-text">
                <strong>Private</strong> — store locally only, not broadcast to the network.
                You can publish it later.
              </span>
            </label>
          </div>

          <div v-if="createError" class="sp-stake-error">{{ createError }}</div>
        </div>

        <div class="sp-modal-footer">
          <button class="sp-btn sp-btn--stake" :disabled="createLoading" @click="doCreate()">
            {{ createForm.isPrivate ? 'Save Privately' : 'Propose on Network' }}
          </button>
          <button class="sp-btn sp-btn--unstake" @click="closeCreate()">Cancel</button>
        </div>
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
  font-size: 0.95rem;
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

.lp-nav-btn--submit {
  color: #22c55e;
  border-color: #1a3a27;
}

.lp-nav-btn--submit:hover {
  border-color: #22c55e;
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
  font-size: 0.95rem;
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
  font-size: 0.87rem;
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

.sp-card-actions {
  display: flex;
  gap: 0.5rem;
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

/* ── Buttons ─────────────────────────────────────────────────────────────────── */
.sp-btn {
  padding: 0.4rem 0.9rem;
  border-radius: 5px;
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  transition: opacity 0.15s, border-color 0.15s;
}

.sp-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.sp-btn--stake-outline {
  background: transparent;
  color: #22c55e;
  border: 1px solid #1a3a27;
}

.sp-btn--stake-outline:hover {
  border-color: #22c55e;
}

.sp-btn--details {
  background: transparent;
  color: #aaa;
  border: 1px solid #1e1e1e;
}

.sp-btn--details:hover {
  color: #fff;
  border-color: #333;
}

.sp-btn--stake {
  background: #22c55e;
  color: #000;
  border: none;
  font-weight: 700;
}

.sp-btn--stake:hover:not(:disabled) {
  opacity: 0.88;
}

.sp-btn--unstake {
  background: transparent;
  color: #aaa;
  border: 1px solid #1e1e1e;
}

.sp-btn--unstake:hover:not(:disabled) {
  color: #fff;
  border-color: #333;
}

.sp-btn--publish {
  background: #1a1206;
  color: #d97706;
  border: 1px solid #3a2a0a;
}

.sp-btn--publish:hover:not(:disabled) {
  border-color: #d97706;
}

/* ── Empty state ─────────────────────────────────────────────────────────────── */
.sp-empty {
  text-align: center;
  color: #333;
  padding: 4rem 2rem;
  font-size: 0.95rem;
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

/* ── Staking UI ──────────────────────────────────────────────────────────────── */
.sp-no-miner {
  color: #444;
  font-size: 0.9rem;
  padding: 0.5rem 0;
}

.sp-stake-ui {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sp-my-stake {
  font-size: 0.88rem;
  color: #555;
}

.sp-my-stake strong {
  color: #22c55e;
}

.sp-stake-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.sp-stake-input {
  background: #0a0a0a;
  border: 1px solid #1e1e1e;
  color: #fff;
  padding: 0.45rem 0.75rem;
  border-radius: 5px;
  font-family: inherit;
  font-size: 0.9rem;
  width: 150px;
  transition: border-color 0.15s;
}

.sp-stake-input:focus {
  outline: none;
  border-color: #333;
}

.sp-stake-error {
  color: #e55;
  font-size: 0.82rem;
}

.sp-stake-ok {
  color: #22c55e;
  font-size: 0.82rem;
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

/* ── Private skill section ───────────────────────────────────────────────────── */
.sp-section--private {
  border-color: #3a2a0a;
}

.sp-private-note {
  color: #666;
  font-size: 0.87rem;
  line-height: 1.6;
  margin: 0;
}

.sp-card-staked--private {
  color: #d97706;
  opacity: 0.75;
}

/* ── Create Skill Modal ───────────────────────────────────────────────────────── */
.sp-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.sp-modal {
  background: #0a0a0a;
  border: 1px solid #1e1e1e;
  border-radius: 8px;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.sp-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid #1e1e1e;
}

.sp-modal-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #fff;
  margin: 0;
  letter-spacing: 0.04em;
}

.sp-modal-close {
  background: transparent;
  border: none;
  color: #555;
  font-size: 1.4rem;
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
}

.sp-modal-close:hover { color: #fff; }

.sp-modal-body {
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.sp-modal-footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid #1e1e1e;
  display: flex;
  gap: 0.75rem;
}

.sp-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.sp-field-label {
  font-size: 0.75rem;
  color: #555;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sp-field-label code {
  font-family: monospace;
  color: #888;
  text-transform: none;
  letter-spacing: 0;
}

.sp-field-input,
.sp-field-textarea {
  background: #060606;
  border: 1px solid #1e1e1e;
  color: #fff;
  padding: 0.5rem 0.75rem;
  border-radius: 5px;
  font-family: monospace;
  font-size: 0.85rem;
  transition: border-color 0.15s;
  resize: vertical;
}

.sp-field-input:focus,
.sp-field-textarea:focus {
  outline: none;
  border-color: #333;
}

/* ── Toggle ──────────────────────────────────────────────────────────────────── */
.sp-field--toggle { flex-direction: row; align-items: flex-start; }

.sp-toggle-label {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  cursor: pointer;
}

.sp-toggle-input { display: none; }

.sp-toggle-track {
  flex-shrink: 0;
  width: 36px;
  height: 20px;
  background: #1e1e1e;
  border-radius: 10px;
  position: relative;
  transition: background 0.2s;
  margin-top: 2px;
}

.sp-toggle-input:checked + .sp-toggle-track {
  background: #3a2a0a;
  border: 1px solid #d97706;
}

.sp-toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #555;
  border-radius: 50%;
  transition: transform 0.2s, background 0.2s;
}

.sp-toggle-input:checked + .sp-toggle-track .sp-toggle-thumb {
  transform: translateX(16px);
  background: #d97706;
}

.sp-toggle-text {
  font-size: 0.85rem;
  color: #666;
  line-height: 1.5;
}

.sp-toggle-text strong { color: #d97706; }

/* ── Responsive ──────────────────────────────────────────────────────────────── */
@media (max-width: 600px) {
  .sp-main { padding: 1.5rem 1rem; }
  .sp-detail-wrap { padding: 1.5rem 1rem; }
  .lp-nav { padding: 0.8rem 1rem; }
  .sp-stake-input { width: 100%; }
  .sp-modal-body { padding: 1rem; }
  .sp-modal-footer { padding: 0.75rem 1rem; }
}
</style>
