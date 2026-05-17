<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

// ── Layout constants ──────────────────────────────────────────────────────────
const NET_CX = 400, NET_CY = 210

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortLabel(desc = '') {
  const segment = desc.split(' — ')[0].split(' – ')[0].split(' (')[0].trim()
  const words = segment.split(' ').slice(0, 2).join(' ')
  return words.length > 13 ? words.slice(0, 12) + '…' : words
}

function edgeDuration(id) {
  const h = String(id).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return (1.4 + (h % 8) * 0.2).toFixed(1) + 's'
}

// ── State ─────────────────────────────────────────────────────────────────────
const methods      = ref([])
const activeId     = ref(null)
const brainPulse   = ref(false)
let   _timer       = null

// ── Nodes (computed from loaded methods, static fallback) ─────────────────────
const FALLBACK_NODES = [
  { id: 's0', type: 'evm',    label: 'ETH Balance',  x: 192, y: 100 },
  { id: 's1', type: 'evm',    label: 'TX Count',     x: 148, y: 210 },
  { id: 's2', type: 'evm',    label: 'USDC Hold',    x: 192, y: 320 },
  { id: 's3', type: 'rest',   label: 'ENS',          x: 295, y:  48 },
  { id: 's4', type: 'rest',   label: 'Farcaster',    x: 400, y:  34 },
  { id: 's5', type: 'rest',   label: 'Gitcoin',      x: 505, y:  48 },
  { id: 's6', type: 'solana', label: 'SOL Balance',  x: 608, y: 100 },
  { id: 's7', type: 'solana', label: 'SPL Token',    x: 652, y: 210 },
  { id: 's8', type: 'solana', label: 'TX Count',     x: 608, y: 320 },
]

const nodes = computed(() => {
  const all  = methods.value
  const evm  = all.filter(m => m.type === 'evm').slice(0, 6)
  const rest = all.filter(m => m.type === 'rest').slice(0, 5)
  const sol  = all.filter(m => m.type === 'solana').slice(0, 4)
  if (!all.length) return FALLBACK_NODES

  const R = 188
  const out = []
  const place = (arr, aStart, aSpan) => arr.forEach((m, i) => {
    const a = (aStart + (arr.length > 1 ? i * aSpan / (arr.length - 1) : aSpan / 2)) * Math.PI / 180
    out.push({ id: m.id, type: m.type, label: shortLabel(m.description),
      x: Math.round(NET_CX + R * Math.cos(a)),
      y: Math.round(NET_CY + R * Math.sin(a)) })
  })
  place(evm,  140, 80)
  place(rest, 245, 50)
  place(sol,  320, 80)
  return out
})

const methodCount = computed(() => methods.value.length || 9)

// ── Animation loop ────────────────────────────────────────────────────────────
function startAnimation() {
  _timer = setInterval(() => {
    const n = nodes.value
    if (!n.length) return
    activeId.value = n[Math.floor(Math.random() * n.length)].id
    setTimeout(() => { brainPulse.value = true  }, 680)
    setTimeout(() => { brainPulse.value = false; activeId.value = null }, 1100)
  }, 1700)
}

onMounted(async () => {
  startAnimation()
  try {
    const { data } = await axios.get('/methods/verifyer')
    methods.value = data.sort((a, b) => (a.score || 0) - (b.score || 0))
  } catch {}
})

onUnmounted(() => clearInterval(_timer))
</script>

<template>
  <section class="net-section">
    <div class="network-label">DETECTION NETWORK</div>
    <p class="net-subtitle">
      {{ methodCount }} active methods · signals flow to AI brain in real time
    </p>

    <div class="net-wrap">
      <svg class="net-svg" viewBox="0 0 800 440" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="net-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="net-glow-sm" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        <!-- Method → Brain edges -->
        <line
          v-for="n in nodes" :key="`e-${n.id}`"
          :x1="n.x" :y1="n.y" :x2="NET_CX" :y2="NET_CY"
          :class="['net-edge', `net-edge--${n.type}`, { 'net-edge--active': activeId === n.id }]"
          :style="{ animationDuration: edgeDuration(n.id) }"
        />

        <!-- Brain → verdict edges -->
        <line :x1="NET_CX" :y1="NET_CY + 38" x2="272" y2="378" class="net-verdict-edge net-verdict-edge--human" />
        <line :x1="NET_CX" :y1="NET_CY + 38" x2="528" y2="378" class="net-verdict-edge net-verdict-edge--bot"   />

        <!-- Method nodes -->
        <g
          v-for="n in nodes" :key="n.id"
          :transform="`translate(${n.x},${n.y})`"
          :class="['net-ngroup', `net-ngroup--${n.type}`, { 'net-ngroup--active': activeId === n.id }]"
        >
          <circle r="9" class="net-node" />
          <text y="21" text-anchor="middle" class="net-nlabel">{{ n.label }}</text>
        </g>

        <!-- AI Brain: outer g positions via SVG translate, inner g handles CSS scale animation -->
        <g :transform="`translate(${NET_CX},${NET_CY})`">
          <g :class="['net-brain-g', { 'net-brain-g--pulse': brainPulse }]">
            <circle r="46" class="net-brain-ring" />
            <circle r="35" class="net-brain-core" filter="url(#net-glow)" />
            <text y="-13" text-anchor="middle" class="net-brain-title">AI Brain</text>
            <!-- E = Evaluator / L = Learner / C = Compiler -->
            <g transform="translate(-16,9)">
              <circle r="7.5" class="net-role net-role--eval" filter="url(#net-glow-sm)" />
              <text y="4" text-anchor="middle" class="net-role-lbl">E</text>
            </g>
            <g transform="translate(0,15)">
              <circle r="7.5" class="net-role net-role--learn" filter="url(#net-glow-sm)" />
              <text y="4" text-anchor="middle" class="net-role-lbl">L</text>
            </g>
            <g transform="translate(16,9)">
              <circle r="7.5" class="net-role net-role--comp" filter="url(#net-glow-sm)" />
              <text y="4" text-anchor="middle" class="net-role-lbl">C</text>
            </g>
          </g>
        </g>

        <!-- Verdict output nodes -->
        <g transform="translate(272,394)">
          <rect x="-52" y="-18" width="104" height="34" rx="17" class="net-verdict net-verdict--human" />
          <text y="5" text-anchor="middle" class="net-verdict-lbl">HUMAN</text>
        </g>
        <g transform="translate(528,394)">
          <rect x="-40" y="-18" width="80" height="34" rx="17" class="net-verdict net-verdict--bot" />
          <text y="5" text-anchor="middle" class="net-verdict-lbl">BOT</text>
        </g>
      </svg>
    </div>

    <!-- Legend -->
    <div class="net-legend">
      <div class="net-legend-group">
        <div class="nl-item"><span class="nl-dot nl-dot--evm"></span>EVM</div>
        <div class="nl-item"><span class="nl-dot nl-dot--solana"></span>Solana</div>
        <div class="nl-item"><span class="nl-dot nl-dot--rest"></span>REST</div>
      </div>
      <div class="nl-sep"></div>
      <div class="net-legend-group">
        <div class="nl-item"><span class="nl-dot nl-dot--eval"></span>Evaluator · DeepSeek R1</div>
        <div class="nl-item"><span class="nl-dot nl-dot--learn"></span>Learner · Qwen 2.5</div>
        <div class="nl-item"><span class="nl-dot nl-dot--comp"></span>Compiler · Mixtral</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.net-section { margin-bottom: 3rem; }

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

.net-svg { display: block; width: 100%; height: auto; }

/* Edges */
.net-edge {
  stroke: #1c1c1c;
  stroke-width: 1.2;
  stroke-dasharray: 3 11;
  animation: net-flow 2s linear infinite;
}
.net-edge--evm    { stroke: #2a2a2a; }
.net-edge--rest   { stroke: #222; }
.net-edge--solana { stroke: #2a1a44; }
.net-edge--active { stroke-width: 1.8; animation-duration: 0.45s !important; }
.net-edge--active.net-edge--evm    { stroke: #808080; }
.net-edge--active.net-edge--rest   { stroke: #444; }
.net-edge--active.net-edge--solana { stroke: #9945ff88; }

@keyframes net-flow { to { stroke-dashoffset: -28; } }

/* Brain → verdict edges */
.net-verdict-edge { stroke-width: 1; stroke-dasharray: 3 9; animation: net-flow 3s linear infinite; }
.net-verdict-edge--human { stroke: #1a3a1a; }
.net-verdict-edge--bot   { stroke: #3a1a1a; }

/* Method nodes */
.net-ngroup circle { fill: #080808; stroke-width: 1.5; transition: fill 0.25s, filter 0.25s; }
.net-ngroup--evm    circle { stroke: #2a2a2a; }
.net-ngroup--rest   circle { stroke: #1e1e1e; }
.net-ngroup--solana circle { stroke: #4a2a7a; }
.net-ngroup--active circle { fill: #111; }
.net-ngroup--active.net-ngroup--evm    circle { stroke: #666;    filter: drop-shadow(0 0 5px #808080); }
.net-ngroup--active.net-ngroup--rest   circle { stroke: #808080;    filter: drop-shadow(0 0 5px #444); }
.net-ngroup--active.net-ngroup--solana circle { stroke: #9945ff; filter: drop-shadow(0 0 6px #9945ff88); }

.net-nlabel {
  font-size: 9.5px;
  fill: #888;
  font-family: -apple-system, 'SF Mono', monospace;
  pointer-events: none;
  transition: fill 0.25s;
}
.net-ngroup--active .net-nlabel { fill: #666; }

/* Brain */
.net-brain-ring {
  fill: none; stroke: #1a1a1a; stroke-width: 1;
  stroke-dasharray: 4 6;
  animation: net-flow 8s linear infinite reverse;
}
.net-brain-core { fill: #0d0d0d; stroke: #fff; stroke-width: 1.5; transition: filter 0.3s; }
.net-brain-g {
  transition: transform 0.2s ease;
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.net-brain-g--pulse { transform: scale(1.04); }
.net-brain-g--pulse .net-brain-core {
  filter: drop-shadow(0 0 18px rgba(255,255,255,0.35)) drop-shadow(0 0 6px rgba(255,255,255,0.2));
}
.net-brain-title {
  font-size: 8.5px; font-weight: 600; fill: #888;
  font-family: -apple-system, sans-serif;
  letter-spacing: 0.08em; text-transform: uppercase; pointer-events: none;
}

/* Role badges */
.net-role { stroke-width: 1; }
.net-role--eval  { fill: #0a1a0a; stroke: #1a4a1a; }
.net-role--learn { fill: #0a100a; stroke: #1a3a2a; }
.net-role--comp  { fill: #0a0a1a; stroke: #1a1a4a; }
.net-brain-g--pulse .net-role--eval  { stroke: #2aaa2a; filter: drop-shadow(0 0 4px #2aaa2a88); }
.net-brain-g--pulse .net-role--learn { stroke: #2a8a5a; filter: drop-shadow(0 0 4px #2a8a5a88); }
.net-brain-g--pulse .net-role--comp  { stroke: #2a4aaa; filter: drop-shadow(0 0 4px #2a4aaa88); }
.net-role-lbl {
  font-size: 7px; font-weight: 700; fill: #808080;
  font-family: -apple-system, monospace; pointer-events: none;
}
.net-brain-g--pulse .net-role-lbl { fill: #aaa; }

/* Verdict nodes */
.net-verdict { stroke-width: 1; fill: #060606; }
.net-verdict--human { stroke: #1a3a1a; }
.net-verdict--bot   { stroke: #3a1a1a; }
.net-verdict-lbl {
  font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
  font-family: -apple-system, monospace; fill: #444; pointer-events: none;
}

/* Legend */
.net-legend {
  display: flex; justify-content: center; align-items: center;
  gap: 0.5rem 1.5rem; margin-top: 1rem; flex-wrap: wrap;
}
.net-legend-group { display: flex; gap: 1.25rem; flex-wrap: wrap; align-items: center; }
.nl-sep { width: 1px; height: 14px; background: #222; flex-shrink: 0; }
.nl-item { display: flex; align-items: center; gap: 0.4rem; font-size: 1.1rem; color: #888; white-space: nowrap; }
.nl-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; border: 1px solid transparent; }
.nl-dot--evm    { background: #1a1a1a; border-color: #888; }
.nl-dot--solana { background: #0d0019; border-color: #4a2a7a; }
.nl-dot--rest   { background: #0d0d0d; border-color: #222; }
.nl-dot--eval   { background: #0a1a0a; border-color: #1a4a1a; }
.nl-dot--learn  { background: #0a100a; border-color: #1a3a2a; }
.nl-dot--comp   { background: #0a0a1a; border-color: #1a1a4a; }
</style>
