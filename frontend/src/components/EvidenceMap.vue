<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  signals: { type: Array,  default: () => [] },
  weights: { type: Object, default: () => ({}) },
})

// ── Treemap layout ─────────────────────────────────────────────────────────────
function treemap(items, x, y, w, h) {
  if (!items.length) return []
  if (items.length === 1) return [{ ...items[0], x, y, w, h }]
  const total = items.reduce((s, i) => s + i.value, 0)
  let acc = 0, split = 1
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].value / total
    split = i + 1
    if (acc >= 0.5) break
  }
  const ratio = items.slice(0, split).reduce((s, i) => s + i.value, 0) / total
  if (w >= h) {
    const lw = w * ratio
    return [...treemap(items.slice(0, split), x, y, lw, h), ...treemap(items.slice(split), x + lw, y, w - lw, h)]
  } else {
    const th = h * ratio
    return [...treemap(items.slice(0, split), x, y, w, th), ...treemap(items.slice(split), x, y + th, w, h - th)]
  }
}

const real = computed(() => props.signals.filter(s => s.methodId !== 'ofac_check'))

const tiles = computed(() => {
  if (!real.value.length) return []
  const items = real.value
    .map(s => ({ ...s, value: Math.max(+(props.weights[s.methodId] ?? s.weight ?? 1), 0.1) }))
    .sort((a, b) => b.value - a.value)
  return treemap(items, 0, 0, 100, 100)
})

const passed = computed(() => real.value.filter(s => s.result !== false).length)
const total  = computed(() => real.value.length)

// ── Tooltip ────────────────────────────────────────────────────────────────────
const hovered    = ref(null)
const tooltipPos = ref({ x: 0, y: 0 })

function onEnter(tile, e) { hovered.value = tile; tooltipPos.value = { x: e.clientX, y: e.clientY } }
function onMove(e)  { if (hovered.value) tooltipPos.value = { x: e.clientX, y: e.clientY } }
function onLeave()  { hovered.value = null }

function effWeight(tile) {
  return +(props.weights[tile.methodId] ?? tile.weight ?? 1).toFixed(2)
}
</script>

<template>
  <div class="em-root" @mouseleave="onLeave">
    <div class="em-header">
      <span class="em-title">Evidence</span>
      <span class="em-ct">{{ passed }}/{{ total }} passed</span>
    </div>
    <div class="em-map">
      <div
        v-for="(tile, i) in tiles"
        :key="tile.methodId || i"
        class="em-tile"
        :class="tile.result !== false ? 'em-tile--pass' : 'em-tile--fail'"
        :style="{ left: tile.x.toFixed(2) + '%', top: tile.y.toFixed(2) + '%', width: tile.w.toFixed(2) + '%', height: tile.h.toFixed(2) + '%' }"
        @mouseenter="e => onEnter(tile, e)"
        @mousemove="onMove"
        @mouseleave="onLeave"
      >
        <span v-if="tile.w > 11 && tile.h > 22" class="em-tile-label">{{ tile.methodId }}</span>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="hovered"
        class="em-tooltip"
        :style="{ left: tooltipPos.x + 16 + 'px', top: tooltipPos.y - 8 + 'px' }"
      >
        <div class="em-tt-id">{{ hovered.methodId }}</div>
        <div class="em-tt-desc">{{ hovered.description }}</div>
        <div class="em-tt-meta">
          <span :class="hovered.result !== false ? 'em-tt-pass' : 'em-tt-fail'">
            {{ hovered.result !== false ? 'PASS' : 'FAIL' }}
          </span>
          <span class="em-tt-weight">weight {{ effWeight(hovered) }}</span>
        </div>
        <div v-if="hovered.details && Object.keys(hovered.details).length" class="em-tt-details">
          {{ JSON.stringify(hovered.details).slice(0, 140) }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.em-root  { width: 100%; user-select: none; }

.em-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.em-title {
  font-size: 10px;
  font-family: monospace;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 600;
}
.em-ct { font-size: 10px; font-family: monospace; color: #4b5563; }

.em-map {
  position: relative;
  width: 100%;
  padding-bottom: 28%;
  background: #050505;
  border: 1px solid #1a1a1a;
  border-radius: 4px;
  overflow: hidden;
}

.em-tile {
  position: absolute;
  box-sizing: border-box;
  padding: 2px;
  cursor: default;
}
.em-tile::after {
  content: '';
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 2px;
  transition: background 0.1s;
}
.em-tile--pass::after          { background: #166534; }
.em-tile--fail::after          { background: #111; border: 1px solid #1e1e1e; }
.em-tile--pass:hover::after    { background: #22c55e; }
.em-tile--fail:hover::after    { background: #2a2a2a; }

.em-tile-label {
  position: absolute;
  inset: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-family: monospace;
  color: rgba(255, 255, 255, 0.3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1;
}
.em-tile--pass .em-tile-label { color: rgba(255, 255, 255, 0.5); }
</style>

<style>
.em-tooltip {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  padding: 8px 12px;
  min-width: 190px;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.7);
}
.em-tt-id   { font-family: monospace; font-size: 11px; color: #555; word-break: break-all; }
.em-tt-desc { font-size: 12px; color: #ccc; line-height: 1.4; }
.em-tt-meta { display: flex; gap: 10px; align-items: center; font-size: 11px; }
.em-tt-pass { color: #22c55e; font-weight: 700; }
.em-tt-fail { color: #555;    font-weight: 700; }
.em-tt-weight { color: #444; }
.em-tt-details {
  font-family: monospace;
  font-size: 10px;
  color: #444;
  word-break: break-all;
  border-top: 1px solid #1a1a1a;
  padding-top: 4px;
  margin-top: 2px;
}
</style>
