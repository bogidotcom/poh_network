<template>
  <div class="profile-root">

    <!-- Header: avatar + name + bio -->
    <div class="profile-header">
      <div class="profile-avatar-wrap">
        <img v-if="profile.avatar" :src="profile.avatar" class="profile-avatar" @error="e => e.target.style.display='none'" />
        <div v-else class="profile-avatar-fallback">{{ initials }}</div>
      </div>
      <div class="profile-header-info">
        <div class="profile-name">{{ profile.displayName || fmt(profile.address) }}</div>
        <div v-if="profile.displayName" class="profile-addr-sub">{{ fmt(profile.address) }}</div>
        <div v-if="profile.bio" class="profile-bio">{{ profile.bio }}</div>
      </div>
    </div>

    <!-- Verifications row: OFAC + Gitcoin + AI verdict -->
    <div class="profile-badges">
      <!-- OFAC -->
      <div v-if="ofac?.sanctioned" class="badge badge-danger" title="OFAC SDN list">
        ⛔ OFAC — {{ ofac.name }}
      </div>
      <div v-else class="badge badge-ok" title="Not on OFAC SDN list">✓ OFAC Clear</div>

      <!-- Gitcoin Passport -->
      <template v-if="profile.gitcoin">
        <div :class="['badge', profile.gitcoin.passing ? 'badge-ok' : 'badge-warn']" title="Gitcoin Passport score">
          {{ profile.gitcoin.passing ? '✓' : '⚠' }} Gitcoin {{ profile.gitcoin.score.toFixed(1) }}
        </div>
      </template>

      <!-- AI verdict badge -->
      <div v-if="verdict" :class="['badge', verdict.verdict === 'HUMAN' ? 'badge-human' : verdict.verdict === 'UNCERTAIN' ? 'badge-warn' : 'badge-danger']">
        {{ verdict.verdict === 'HUMAN' ? '✓ Verified Human' : verdict.verdict === 'UNCERTAIN' ? '? Uncertain' : '✗ Suspected Bot' }}
        <span class="badge-conf">{{ Math.round((verdict.confidence || 0) * 100) }}%</span>
      </div>
    </div>

    <!-- Identity Protocols -->
    <div v-if="hasIdentityData" class="profile-section">
      <div class="profile-section-title">Identity Protocols</div>
      <div class="id-protocol-grid">

        <!-- World ID (Worldcoin) -->
        <div v-if="worldIdFlag != null" :class="['id-protocol-card', worldIdFlag ? 'id-ok' : 'id-none']">
          <div class="id-protocol-icon">
            <img src="https://world.org/favicon.ico" class="id-ext-icon" alt="World ID" @error="e => e.target.replaceWith(Object.assign(document.createElement('span'), {textContent:'🌍'}))" />
          </div>
          <div class="id-protocol-body">
            <div class="id-protocol-name">World ID</div>
            <div class="id-protocol-status">{{ worldIdFlag ? 'Verified human' : 'Not verified' }}</div>
          </div>
          <span v-if="worldIdFlag" class="id-check">✓</span>
        </div>

        <!-- Proof of Humanity (Kleros) -->
        <div v-if="pohFlag != null" :class="['id-protocol-card', pohFlag ? 'id-ok' : 'id-none']">
          <div class="id-protocol-icon">⚖️</div>
          <div class="id-protocol-body">
            <div class="id-protocol-name">Proof of Humanity</div>
            <div class="id-protocol-status">{{ pohFlag ? 'Registered' : 'Not registered' }}</div>
          </div>
          <span v-if="pohFlag" class="id-check">✓</span>
        </div>

        <!-- Humanity Protocol (palm biometric on-chain) -->
        <div v-if="humanityFlag != null" :class="['id-protocol-card', humanityFlag ? 'id-ok' : 'id-none']">
          <div class="id-protocol-icon">🖐️</div>
          <div class="id-protocol-body">
            <div class="id-protocol-name">Humanity Protocol</div>
            <div class="id-protocol-status">{{ humanityFlag ? 'Palm verified' : 'Not verified' }}</div>
          </div>
          <span v-if="humanityFlag" class="id-check">✓</span>
        </div>

        <!-- BrightID -->
        <div v-if="brightidFlag != null" :class="['id-protocol-card', brightidFlag ? 'id-ok' : 'id-none']">
          <div class="id-protocol-icon">
            <img src="https://brightid.org/favicon.ico" class="id-ext-icon" alt="BrightID" @error="e => e.target.replaceWith(Object.assign(document.createElement('span'), {textContent:'🔆'}))" />
          </div>
          <div class="id-protocol-body">
            <div class="id-protocol-name">BrightID</div>
            <div class="id-protocol-status">{{ brightidFlag ? 'Verified unique' : 'Not verified' }}</div>
          </div>
          <span v-if="brightidFlag" class="id-check">✓</span>
        </div>

        <!-- BAB — Binance Account Bound (KYC) -->
        <div v-if="babFlag != null" :class="['id-protocol-card', babFlag ? 'id-ok' : 'id-none']">
          <div class="id-protocol-icon">
            <img src="https://www.binance.com/favicon.ico" class="id-ext-icon" alt="Binance" @error="e => e.target.replaceWith(Object.assign(document.createElement('span'), {textContent:'🏦'}))" />
          </div>
          <div class="id-protocol-body">
            <div class="id-protocol-name">BAB Token</div>
            <div class="id-protocol-status">{{ babFlag ? 'Binance KYC verified' : 'No BAB token' }}</div>
          </div>
          <span v-if="babFlag" class="id-check">✓</span>
        </div>

        <!-- Human Protocol (human.tech) -->
        <div v-if="ip.humanTech != null" :class="['id-protocol-card', ip.humanTech?.score >= 50 ? 'id-ok' : 'id-warn']">
          <div class="id-protocol-icon">🤖</div>
          <div class="id-protocol-body">
            <div class="id-protocol-name">Human Protocol</div>
            <div class="id-protocol-status">Score: {{ ip.humanTech?.score?.toFixed(0) ?? '—' }}</div>
          </div>
        </div>

        <!-- Nomis -->
        <div v-if="ip.nomis != null" :class="['id-protocol-card', ip.nomis?.score >= 50 ? 'id-ok' : 'id-warn']">
          <div class="id-protocol-icon">📊</div>
          <div class="id-protocol-body">
            <div class="id-protocol-name">Nomis</div>
            <div class="id-protocol-status">Score: {{ ip.nomis?.score?.toFixed(0) ?? '—' }}</div>
          </div>
          <div v-if="ip.nomis?.score != null" class="id-score-bar">
            <div class="id-score-fill" :style="{ width: Math.min(100, ip.nomis.score) + '%', background: ip.nomis.score >= 50 ? '#22c55e' : '#eab308' }"></div>
          </div>
        </div>

      </div>
    </div>

    <!-- Link3 / CyberConnect profile -->
    <div v-if="profile.link3Profile" class="profile-section">
      <div class="profile-section-title">Link3 Profile</div>
      <a :href="profile.link3Profile.url" target="_blank" rel="noopener" class="link3-card">
        <img src="https://link3.to/favicon.ico" class="link3-logo" alt="Link3"
             @error="e => e.target.style.display='none'" />
        <div class="link3-info">
          <span class="link3-handle">@{{ profile.link3Profile.handle }}</span>
          <span class="link3-subscribers">{{ profile.link3Profile.subscribers.toLocaleString() }} subscribers</span>
        </div>
        <span class="link3-arrow">↗</span>
      </a>
    </div>

    <!-- Web3 domains -->
    <div v-if="profile.domains?.length" class="profile-section">
      <div class="profile-section-title">Web3 Domains</div>
      <div class="profile-domains">
        <a v-for="d in profile.domains" :key="d.name" :href="d.url" target="_blank" rel="noopener" class="domain-chip">
          <span class="domain-platform">{{ d.platform }}</span>
          <span class="domain-name">{{ d.name }}</span>
        </a>
      </div>
    </div>

    <!-- Social profiles -->
    <div v-if="profile.links?.length" class="profile-section">
      <div class="profile-section-title">Profiles</div>
      <div class="profile-socials">
        <a v-for="l in profile.links" :key="l.platform + l.identity"
           :href="l.url" target="_blank" rel="noopener"
           class="social-chip" :title="l.description || l.displayName">
          <!-- Platform logo (real SVG or favicon) -->
          <img v-if="platformLogoUrl(l.platform, l.url)"
               :src="platformLogoUrl(l.platform, l.url)"
               class="social-platform-logo"
               :alt="l.platform"
               @error="e => e.target.style.display='none'" />
          <span v-else class="social-icon">{{ platformIcon(l.platform) }}</span>
          <!-- User's avatar on that platform -->
          <img v-if="l.avatar" :src="l.avatar" class="social-avatar" @error="e => e.target.style.display='none'" />
          <span class="social-identity">{{ l.identity || l.displayName }}</span>
        </a>
      </div>
    </div>

    <!-- Tx stats -->
    <div v-if="profile.txStats" class="profile-section">
      <div class="profile-section-title">Activity</div>
      <div class="profile-stats-row">
        <div class="stat-box">
          <div class="stat-label">Total Txs</div>
          <div class="stat-val">{{ profile.txStats.total?.toLocaleString() ?? '—' }}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">First Tx</div>
          <div class="stat-val">{{ fmtDate(profile.txStats.firstTx?.ts) }}</div>
          <a v-if="profile.txStats.firstTx?.hash" :href="`https://etherscan.io/tx/${profile.txStats.firstTx.hash}`"
             target="_blank" rel="noopener" class="stat-link">↗</a>
        </div>
        <div class="stat-box">
          <div class="stat-label">Last Tx</div>
          <div class="stat-val">{{ fmtDate(profile.txStats.lastTx?.ts) }}</div>
          <a v-if="profile.txStats.lastTx?.hash" :href="`https://etherscan.io/tx/${profile.txStats.lastTx.hash}`"
             target="_blank" rel="noopener" class="stat-link">↗</a>
        </div>
      </div>
    </div>

    <!-- Associated wallets (Gnosis Safe multisigs where this address is an owner) -->
    <div v-if="profile.associatedWallets?.length" class="profile-section">
      <div class="profile-section-title">
        Associated Wallets
        <span class="graph-hint">Safe multisig signer</span>
      </div>
      <div class="assoc-wallets">
        <div v-for="w in profile.associatedWallets" :key="w" class="assoc-wallet-row">
          <span class="assoc-wallet-icon">🔐</span>
          <a :href="`https://app.safe.global/home?safe=eth:${w}`" target="_blank" rel="noopener" class="assoc-wallet-addr">
            {{ fmt(w) }}
          </a>
          <button class="assoc-wallet-scan" @click="$emit('scan', w)">Scan</button>
          <a :href="`https://etherscan.io/address/${w}`" target="_blank" rel="noopener" class="stat-link" style="position:static;margin-left:4px">↗</a>
        </div>
      </div>
    </div>

    <!-- Transaction graph -->
    <div v-if="profile.graph?.nodes?.length > 1" class="profile-section">
      <div class="profile-section-title">
        Transaction Graph
        <span class="graph-hint">click node to inspect</span>
      </div>
      <TxGraph :graph="profile.graph" @scan="addr => $emit('scan', addr)" />
    </div>

    <!-- Evidence (pass / fail accordions) -->
    <div v-if="signals?.length" class="profile-section">
      <div class="profile-section-title">Evidence</div>
      <div class="evidence-summary">
        <span v-for="r in signals.filter(r => r.methodId !== 'ofac_check').slice(0, 16)" :key="r.methodId"
              :class="['ev-dot', r.result ? 'ev-pass' : 'ev-fail']" :title="r.description" />
        <span class="ev-count">{{ signals.filter(r => r.result && r.methodId !== 'ofac_check').length }}/{{ signals.filter(r => r.methodId !== 'ofac_check').length }} passed</span>
      </div>

      <!-- Passed -->
      <button class="ev-accordion-btn" @click="showPass = !showPass">
        <span>✓ Passed ({{ signals.filter(r => r.result && r.methodId !== 'ofac_check').length }})</span>
        <span class="ev-chevron" :class="{ open: showPass }">›</span>
      </button>
      <div v-show="showPass" class="ev-list">
        <div v-for="r in signals.filter(r => r.result && r.methodId !== 'ofac_check')" :key="r.methodId" class="ev-row ev-row-pass">
          <span class="ev-dot ev-pass" />
          <span class="ev-desc">{{ r.description }}</span>
        </div>
        <div v-if="!signals.filter(r => r.result && r.methodId !== 'ofac_check').length" class="ev-empty">No signals passed</div>
      </div>

      <!-- Failed -->
      <button class="ev-accordion-btn" @click="showFail = !showFail">
        <span>✗ Failed ({{ signals.filter(r => !r.result && r.methodId !== 'ofac_check').length }})</span>
        <span class="ev-chevron" :class="{ open: showFail }">›</span>
      </button>
      <div v-show="showFail" class="ev-list">
        <div v-for="r in signals.filter(r => !r.result && r.methodId !== 'ofac_check')" :key="r.methodId" class="ev-row ev-row-fail">
          <span class="ev-dot ev-fail" />
          <span class="ev-desc">{{ r.description }}</span>
        </div>
        <div v-if="!signals.filter(r => !r.result && r.methodId !== 'ofac_check').length" class="ev-empty">No signals failed</div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import TxGraph from './TxGraph.vue'

const props = defineProps({
  profile: { type: Object, required: true },
  verdict: { type: Object, default: null },
  ofac:    { type: Object, default: null },
  signals: { type: Array,  default: () => [] },
})
defineEmits(['scan'])

const showPass = ref(false)
const showFail = ref(false)

// Shorthand for identity protocols (from profileEnrich REST data)
const ip = computed(() => props.profile.identityProtocols || {})

// Fast lookup: methodId → result (true/false) from live checker signals
const sigMap = computed(() => {
  const m = {}
  for (const r of props.signals || []) {
    if (r.methodId != null) m[r.methodId] = !!r.result
  }
  return m
})

// ── Per-protocol resolved flags ───────────────────────────────────────────────
// Each returns: true = verified, false = checked but not verified, null = no data

const brightidFlag = computed(() => {
  if (ip.value.brightid != null) return ip.value.brightid.verified ? true : false
  return null
})

const babFlag = computed(() => {
  if (ip.value.bab?.hasKyc) return true
  // Signal covers both BSC and opBNB BAB checks
  const bsc   = sigMap.value['poh_bab_bsc_1776849825388']
  const opbnb = sigMap.value['poh_bab_opbnb_1776849825388']
  if (bsc != null || opbnb != null) return !!(bsc || opbnb)
  return null
})

const humanityFlag = computed(() => {
  // On-chain oracle (humanityProtocol.js — fixed RPC)
  if (sigMap.value['humanity_protocol'] != null) return sigMap.value['humanity_protocol']
  // REST API fallback (profileEnrich)
  if (ip.value.humanity != null) return ip.value.humanity.registered ? true : false
  return null
})

const worldIdFlag = computed(() => {
  // Galxe hasWorldcoin signal — World ID linked to this wallet
  if (sigMap.value['1777600000006galxe_worl'] != null) return sigMap.value['1777600000006galxe_worl']
  return null
})

const pohFlag = computed(() => {
  // Proof of Humanity — Kleros biometric registry on Ethereum
  if (sigMap.value['1776780461275Ethereum'] != null) return sigMap.value['1776780461275Ethereum']
  return null
})

// Show identity section when at least one protocol has any data
const hasIdentityData = computed(() => {
  return brightidFlag.value  != null
      || babFlag.value        != null
      || humanityFlag.value   != null
      || worldIdFlag.value    != null
      || pohFlag.value        != null
      || ip.value.humanTech   != null
      || ip.value.nomis       != null
})

const initials = computed(() => {
  const n = props.profile.displayName || props.profile.address || ''
  return n.slice(0, 2).toUpperCase()
})

function fmt(addr) {
  if (!addr || addr.length < 10) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// Simple Icons CDN — only slugs confirmed to exist on simpleicons.org
// White (#ffffff) so they're visible on the dark background
const PLATFORM_LOGO_SLUGS = {
  twitter:    'x',
  x:          'x',
  farcaster:  'farcaster',
  lens:       'lens',
  github:     'github',
  telegram:   'telegram',
  discord:    'discord',
  linkedin:   'linkedin',
  reddit:     'reddit',
  youtube:    'youtube',
  instagram:  'instagram',
  tiktok:     'tiktok',
  bluesky:    'bluesky',
  medium:     'medium',
  mirror:     'mirror',
  spotify:    'spotify',
  keybase:    'keybase',
  nostr:      'nostr',
  galxe:      'galxe',
  ens:        'ens',
  basenames:  'base',
}

// Returns an image URL for the platform logo, or null for emoji fallback
function platformLogoUrl(platform, url) {
  const key = platform?.toLowerCase()
  const slug = PLATFORM_LOGO_SLUGS[key]
  if (slug) return `https://cdn.simpleicons.org/${slug}/ffffff`
  // For website links use Google's favicon service
  if (key === 'website' && url) {
    try { return `https://www.google.com/s2/favicons?sz=32&domain=${new URL(url).hostname}` }
    catch {}
  }
  return null
}

// Emoji fallback for platforms not in the slug map
const PLATFORM_ICONS = {
  sns: '◎', unstoppabledomains: '🔓', website: '🌐',
}
function platformIcon(p) {
  return PLATFORM_ICONS[p?.toLowerCase()] || '🔗'
}
</script>

<style scoped>
.profile-root { display: flex; flex-direction: column; gap: 20px; }

/* ── Header ── */
.profile-header { display: flex; align-items: flex-start; gap: 16px; }
.profile-avatar-wrap { flex-shrink: 0; }
.profile-avatar { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 2px solid #374151; }
.profile-avatar-fallback { width: 64px; height: 64px; border-radius: 50%; background: #1f2937; border: 2px solid #374151; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; color: #9ca3af; }
.profile-header-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.profile-name { font-size: 18px; font-weight: 700; color: #f9fafb; }
.profile-addr-sub { font-size: 12px; color: #6b7280; font-family: monospace; }
.profile-bio { font-size: 13px; color: #9ca3af; line-height: 1.5; margin-top: 2px; }

/* ── Badges ── */
.profile-badges { display: flex; flex-wrap: wrap; gap: 8px; }
.badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
.badge-ok     { background: rgba(34,197,94,0.12); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
.badge-warn   { background: rgba(234,179,8,0.12);  color: #eab308; border: 1px solid rgba(234,179,8,0.3); }
.badge-danger { background: rgba(239,68,68,0.12);  color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
.badge-human  { background: rgba(99,102,241,0.12); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); }
.badge-conf   { opacity: 0.7; font-weight: 400; }

/* ── Section ── */
.profile-section { display: flex; flex-direction: column; gap: 10px; }
.profile-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; display: flex; align-items: center; gap: 8px; }
.graph-hint { font-weight: 400; text-transform: none; letter-spacing: 0; color: #4b5563; }

/* ── Identity Protocols ── */
.id-protocol-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.id-protocol-card {
  display: flex; align-items: center; gap: 10px;
  background: rgba(255,255,255,0.04); border: 1px solid #1f2937;
  border-radius: 10px; padding: 10px 12px; position: relative;
}
.id-ok   { border-color: rgba(34,197,94,0.3);  background: rgba(34,197,94,0.05); }
.id-warn { border-color: rgba(234,179,8,0.25); background: rgba(234,179,8,0.04); }
.id-none { border-color: #1f2937; opacity: 0.6; }
.id-protocol-icon { font-size: 20px; line-height: 1; flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; }
.id-ext-icon { width: 20px; height: 20px; object-fit: contain; border-radius: 3px; }
.id-protocol-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.id-protocol-name { font-size: 12px; font-weight: 700; color: #e5e7eb; }
.id-protocol-status { font-size: 11px; color: #6b7280; }
.id-check { color: #22c55e; font-size: 14px; font-weight: 700; flex-shrink: 0; }
.id-score-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: #1f2937; border-radius: 0 0 10px 10px; overflow: hidden; }
.id-score-fill { height: 100%; border-radius: 0 0 10px 10px; transition: width 0.4s; }

/* ── Link3 Profile ── */
.link3-card {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; background: rgba(99,102,241,0.05);
  border: 1px solid rgba(99,102,241,0.2); border-radius: 10px;
  text-decoration: none; transition: border-color 0.15s;
}
.link3-card:hover { border-color: rgba(99,102,241,0.5); }
.link3-logo { width: 20px; height: 20px; object-fit: contain; border-radius: 3px; flex-shrink: 0; }
.link3-info { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.link3-handle { font-size: 14px; font-weight: 700; color: #e5e7eb; }
.link3-subscribers { font-size: 11px; color: #6b7280; }
.link3-arrow { font-size: 14px; color: #6366f1; flex-shrink: 0; }

/* ── Domains ── */
.profile-domains { display: flex; flex-wrap: wrap; gap: 8px; }
.domain-chip { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.05); border: 1px solid #374151; border-radius: 8px; padding: 5px 10px; text-decoration: none; transition: border-color 0.15s; }
.domain-chip:hover { border-color: #6366f1; }
.domain-platform { font-size: 10px; color: #6b7280; font-weight: 600; text-transform: uppercase; }
.domain-name { font-size: 13px; color: #e5e7eb; font-family: monospace; }

/* ── Socials ── */
.profile-socials { display: flex; flex-wrap: wrap; gap: 8px; }
.social-chip { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.04); border: 1px solid #374151; border-radius: 8px; padding: 5px 10px; text-decoration: none; cursor: pointer; transition: border-color 0.15s; }
.social-chip:hover { border-color: #6366f1; }
.social-avatar        { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; }
.social-platform-logo { width: 14px; height: 14px; object-fit: contain; flex-shrink: 0; opacity: 0.75; }
.social-icon          { font-size: 13px; line-height: 1; }
.social-identity      { font-size: 12px; color: #d1d5db; }

/* ── Stats ── */
.profile-stats-row { display: flex; gap: 12px; flex-wrap: wrap; }
.stat-box { flex: 1; min-width: 100px; background: rgba(255,255,255,0.04); border: 1px solid #1f2937; border-radius: 10px; padding: 10px 14px; position: relative; }
.stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin-bottom: 4px; }
.stat-val   { font-size: 15px; font-weight: 600; color: #f9fafb; }
.stat-link  { position: absolute; top: 8px; right: 10px; font-size: 14px; color: #6b7280; text-decoration: none; }
.stat-link:hover { color: #818cf8; }

/* ── Associated wallets ── */
.assoc-wallets { display: flex; flex-direction: column; gap: 6px; }
.assoc-wallet-row { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.03); border: 1px solid #1f2937; border-radius: 8px; padding: 8px 12px; }
.assoc-wallet-icon { font-size: 14px; flex-shrink: 0; }
.assoc-wallet-addr { font-size: 13px; color: #d1d5db; font-family: monospace; text-decoration: none; flex: 1; }
.assoc-wallet-addr:hover { color: #818cf8; }
.assoc-wallet-scan { background: #374151; color: #d1d5db; border: none; border-radius: 5px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.assoc-wallet-scan:hover { background: #6366f1; color: #fff; }

/* ── Evidence ── */
.evidence-summary { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.ev-dot  { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
.ev-pass { background: #22c55e; }
.ev-fail { background: #374151; }
.ev-count { font-size: 12px; color: #6b7280; margin-left: 6px; }
.ev-accordion-btn { display: flex; justify-content: space-between; align-items: center; width: 100%; background: rgba(255,255,255,0.04); border: 1px solid #1f2937; border-radius: 8px; padding: 9px 14px; cursor: pointer; color: #9ca3af; font-size: 13px; transition: border-color 0.15s; }
.ev-accordion-btn:hover { border-color: #374151; color: #e5e7eb; }
.ev-chevron { transition: transform 0.2s; font-size: 16px; }
.ev-chevron.open { transform: rotate(90deg); }
.ev-list { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; }
.ev-row  { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 6px; }
.ev-row-pass { background: rgba(34,197,94,0.04); }
.ev-row-fail { background: rgba(239,68,68,0.04); }
.ev-desc { font-size: 12px; color: #9ca3af; }
.ev-empty { font-size: 12px; color: #4b5563; padding: 6px 10px; }
</style>
