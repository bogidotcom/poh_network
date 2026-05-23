<template>
  <div class="txgraph-wrap">
    <svg ref="svgRef" class="txgraph-svg" />
    <!-- tooltip -->
    <div v-if="tooltip.visible" class="txgraph-tooltip" :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }">
      <span class="txgraph-addr">{{ fmt(tooltip.id) }}</span>
      <button class="txgraph-scan-btn" @click="$emit('scan', tooltip.id)">Scan</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as d3 from 'd3'

const props = defineProps({
  graph: { type: Object, required: true }, // { nodes: [...], edges: [...] }
})
const emit = defineEmits(['scan'])

const svgRef = ref(null)
const tooltip = ref({ visible: false, x: 0, y: 0, id: '' })

function fmt(addr) {
  if (!addr || addr.length < 10) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

let simulation = null

function draw() {
  if (!svgRef.value || !props.graph) return
  const el = svgRef.value
  d3.select(el).selectAll('*').remove()

  const W = el.clientWidth  || 560
  const H = el.clientHeight || 340

  const svg = d3.select(el)
    .attr('width', W)
    .attr('height', H)

  // arrow marker
  svg.append('defs').append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -4 8 8')
    .attr('refX', 18).attr('refY', 0)
    .attr('markerWidth', 6).attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L8,0L0,4')
    .attr('fill', '#6b7280')

  const g = svg.append('g')

  // zoom + pan
  svg.call(d3.zoom().scaleExtent([0.3, 3]).on('zoom', e => g.attr('transform', e.transform)))

  const nodes = props.graph.nodes.map(n => ({ ...n }))
  const edges = props.graph.edges.map(e => ({ ...e }))

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id).distance(90))
    .force('charge', d3.forceManyBody().strength(-220))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(28))

  const link = g.append('g').selectAll('line')
    .data(edges).join('line')
    .attr('class', 'txgraph-edge')
    .attr('marker-end', 'url(#arrow)')

  const nodeG = g.append('g').selectAll('g')
    .data(nodes).join('g')
    .attr('class', 'txgraph-node-g')
    .call(d3.drag()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
      .on('drag',  (event, d) => { d.fx = event.x; d.fy = event.y })
      .on('end',   (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null })
    )
    .on('click', (event, d) => {
      event.stopPropagation()
      if (d.isCenter) return
      const rect = svgRef.value.getBoundingClientRect()
      tooltip.value = { visible: true, x: event.clientX - rect.left + 12, y: event.clientY - rect.top - 10, id: d.id }
    })

  // close tooltip on svg click
  svg.on('click', () => { tooltip.value.visible = false })

  nodeG.append('circle')
    .attr('r', d => d.isCenter ? 16 : 9)
    .attr('class', d => d.isCenter ? 'txgraph-center' : 'txgraph-peer')

  nodeG.append('text')
    .attr('dy', d => d.isCenter ? 28 : 20)
    .attr('text-anchor', 'middle')
    .attr('class', 'txgraph-label')
    .text(d => fmt(d.id))

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
    nodeG.attr('transform', d => `translate(${d.x},${d.y})`)
  })
}

onMounted(() => { draw() })
onUnmounted(() => { if (simulation) simulation.stop() })
watch(() => props.graph, () => { if (simulation) simulation.stop(); draw() }, { deep: true })
</script>

<style scoped>
.txgraph-wrap { position: relative; width: 100%; height: 340px; background: rgba(255,255,255,0.03); border-radius: 10px; overflow: hidden; }
.txgraph-svg  { width: 100%; height: 100%; }

:deep(.txgraph-edge)   { stroke: #374151; stroke-width: 1.5; fill: none; }
:deep(.txgraph-center) { fill: #6366f1; stroke: #818cf8; stroke-width: 2; }
:deep(.txgraph-peer)   { fill: #1f2937; stroke: #4b5563; stroke-width: 1.5; cursor: pointer; transition: fill 0.15s; }
:deep(.txgraph-peer:hover) { fill: #374151; stroke: #6366f1; }
:deep(.txgraph-label)  { font-size: 9px; fill: #9ca3af; pointer-events: none; font-family: monospace; }

.txgraph-tooltip {
  position: absolute;
  background: #111827;
  border: 1px solid #374151;
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 20;
  white-space: nowrap;
  pointer-events: all;
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
}
.txgraph-addr     { font-family: monospace; font-size: 12px; color: #e5e7eb; }
.txgraph-scan-btn { background: #6366f1; color: #fff; border: none; border-radius: 5px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
.txgraph-scan-btn:hover { background: #4f46e5; }
</style>
