<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

// ── Config ────────────────────────────────────────────────────────────────────
const MAX_ALIVE   = 28   // particles on-screen at once
const SPAWN_MS    = 900  // ms between spawns
const MIN_LIFE    = 9000 // ms a particle lives
const MAX_LIFE    = 18000

const container = ref(null)
let pool      = []          // fetched particle data
let alive     = []          // currently rendered elements
let spawnTimer = null
let poolIdx   = 0

// ── Helpers ───────────────────────────────────────────────────────────────────
function rand(min, max) { return Math.random() * (max - min) + min }
function pick(arr)      { return arr[Math.floor(Math.random() * arr.length)] }

// Truncate wallet addresses for display
function fmt(label) {
  if (/^0x[0-9a-fA-F]{40}$/.test(label))
    return label.slice(0, 6) + '…' + label.slice(-4)
  return label
}

// ── Spawn one particle ────────────────────────────────────────────────────────
function spawn() {
  if (!container.value || alive.length >= MAX_ALIVE || !pool.length) return

  const item    = pool[poolIdx % pool.length]
  poolIdx++

  const el      = document.createElement('div')
  el.className  = 'bp-particle'

  const x       = rand(2, 94)          // % from left
  const y       = rand(5, 88)          // % from top
  const life    = rand(MIN_LIFE, MAX_LIFE)
  const drift   = rand(-18, 18)        // px horizontal drift
  const driftY  = rand(-30, -80)       // px upward drift
  const scale   = rand(0.75, 1.15)
  const delay   = rand(0, 400)

  el.style.cssText = `
    left: ${x}%;
    top:  ${y}%;
    --drift-x: ${drift}px;
    --drift-y: ${driftY}px;
    --scale: ${scale};
    animation-duration: ${life}ms;
    animation-delay: ${delay}ms;
  `

  // Build inner content based on kind
  if (item.kind === 'avatar' && item.avatar) {
    el.innerHTML = `
      <div class="bp-avatar-wrap">
        <img class="bp-avatar" src="${item.avatar}" alt="" loading="lazy"
             onerror="this.parentElement.parentElement.style.display='none'" />
        ${item.label ? `<span class="bp-avatar-label">${fmt(item.label)}</span>` : ''}
      </div>`
  } else if (item.kind === 'address') {
    el.innerHTML = `<span class="bp-text bp-addr">${fmt(item.label)}</span>`
  } else if (item.kind === 'domain') {
    el.innerHTML = `<span class="bp-text bp-domain">${item.label}</span>`
  } else if (item.kind === 'handle') {
    const icon = PLATFORM_ICON[item.platform] || ''
    el.innerHTML = `<span class="bp-text bp-handle">${icon}${item.label}</span>`
  } else {
    // name
    el.innerHTML = `<span class="bp-text bp-name">${item.label}</span>`
  }

  container.value.appendChild(el)
  alive.push(el)

  // Remove after animation completes
  const cleanup = () => {
    el.remove()
    alive = alive.filter(e => e !== el)
  }
  setTimeout(cleanup, life + delay + 200)
}

const PLATFORM_ICON = {
  twitter: '𝕏 ', farcaster: '🟪 ', lens: '🌿 ',
  ens: '◈ ', link3: '⬡ ', github: '⌥ ',
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  try {
    const { data } = await axios.get('/checker/particles')
    pool = Array.isArray(data) && data.length ? data : []
  } catch { pool = [] }

  // Fallback seed if API is down
  if (!pool.length) {
    pool = [
      { kind:'address', label:'0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
      { kind:'name',    label:'Vitalik Buterin' },
      { kind:'domain',  label:'vitalik.eth' },
      { kind:'handle',  label:'@VitalikButerin' },
      { kind:'name',    label:'hayden.eth' },
      { kind:'domain',  label:'uniswap.eth' },
      { kind:'handle',  label:'@dwr' },
      { kind:'address', label:'0x4Fabb145d64652a948d72533023f6E7A623C7C53' },
      { kind:'handle',  label:'@stani' },
      { kind:'domain',  label:'lens.xyz' },
    ]
  }

  // Shuffle pool
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }

  // Seed a few immediately, then regular interval
  for (let i = 0; i < 10; i++) setTimeout(spawn, i * 120)
  spawnTimer = setInterval(spawn, SPAWN_MS)
})

onUnmounted(() => {
  clearInterval(spawnTimer)
  alive.forEach(el => el.remove())
  alive = []
})
</script>

<template>
  <div ref="container" class="bg-particles" aria-hidden="true" />
</template>

<style scoped>
.bg-particles {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

/* ── Each particle ── */
:deep(.bp-particle) {
  position: absolute;
  opacity: 0;
  transform: translate(0, 0) scale(var(--scale, 1));
  animation-name: bp-float;
  animation-timing-function: ease-in-out;
  animation-fill-mode: forwards;
  will-change: transform, opacity;
  user-select: none;
}

@keyframes bp-float {
  0%   { opacity: 0;    transform: translate(0,           0)          scale(var(--scale)); }
  12%  { opacity: 1; }
  80%  { opacity: 0.85; }
  100% { opacity: 0;    transform: translate(var(--drift-x), var(--drift-y)) scale(var(--scale)); }
}

/* ── Text particles ── */
:deep(.bp-text) {
  display: inline-block;
  font-family: 'SF Mono', 'Fira Code', monospace;
  white-space: nowrap;
  border-radius: 6px;
  padding: 3px 8px;
  backdrop-filter: blur(2px);
}

:deep(.bp-addr) {
  font-size: 11px;
  color: rgba(99, 102, 241, 0.55);
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.12);
  letter-spacing: 0.04em;
}

:deep(.bp-domain) {
  font-size: 12px;
  color: rgba(167, 139, 250, 0.6);
  background: rgba(139, 92, 246, 0.05);
  border: 1px solid rgba(139, 92, 246, 0.14);
}

:deep(.bp-handle) {
  font-size: 12px;
  color: rgba(129, 140, 248, 0.6);
  background: rgba(99, 102, 241, 0.04);
  border: 1px solid rgba(99, 102, 241, 0.1);
}

:deep(.bp-name) {
  font-size: 12px;
  font-family: system-ui, sans-serif;
  color: rgba(209, 213, 219, 0.35);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  letter-spacing: 0.01em;
}

/* ── Avatar particles ── */
:deep(.bp-avatar-wrap) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

:deep(.bp-avatar) {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(99, 102, 241, 0.25);
  display: block;
  filter: grayscale(20%);
}

:deep(.bp-avatar-label) {
  font-size: 10px;
  font-family: system-ui, sans-serif;
  color: rgba(156, 163, 175, 0.5);
  white-space: nowrap;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
