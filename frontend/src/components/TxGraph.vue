<template>
  <div class="txgraph-wrap">
    <svg ref="svgRef" class="txgraph-svg" />
    <!-- legend -->
    <div class="txgraph-legend">
      <span class="txgraph-legend-dot txgraph-legend-center" />center
      <span class="txgraph-legend-dot txgraph-legend-hop1" />1-hop
      <span class="txgraph-legend-dot txgraph-legend-hop2" />2-hop
    </div>
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

  const hop2Edges = edges.filter(e => {
    const src = nodes.find(n => n.id === (e.source?.id ?? e.source))
    return src?.hop === 1
  })
  const hop1Edges = edges.filter(e => !hop2Edges.includes(e))

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id)
      .distance(d => {
        const src = nodes.find(n => n.id === (d.source?.id ?? d.source))
        return src?.hop === 1 ? 70 : 110
      }))
    .force('charge', d3.forceManyBody().strength(d => d.hop === 2 ? -80 : -200))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(d => d.hop === 2 ? 18 : 26))

  // hop-2 edges (dimmer)
  const linkHop2 = g.append('g').selectAll('line')
    .data(hop2Edges).join('line')
    .attr('class', 'txgraph-edge txgraph-edge-hop2')
    .attr('marker-end', 'url(#arrow)')

  // hop-1 edges (normal)
  const linkHop1 = g.append('g').selectAll('line')
    .data(hop1Edges).join('line')
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
    .attr('r', d => d.hop === 0 ? 16 : d.hop === 2 ? 6 : 9)
    .attr('class', d => d.hop === 0 ? 'txgraph-center' : d.hop === 2 ? 'txgraph-hop2' : 'txgraph-peer')

  nodeG.append('text')
    .attr('dy', d => d.hop === 0 ? 28 : d.hop === 2 ? 16 : 20)
    .attr('text-anchor', 'middle')
    .attr('class', d => d.hop === 2 ? 'txgraph-label txgraph-label-dim' : 'txgraph-label')
    .text(d => d.hop === 2 ? fmt(d.id).slice(0, 8) + '…' : fmt(d.id))

  simulation.on('tick', () => {
    linkHop1.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
    linkHop2.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y)
    nodeG.attr('transform', d => `translate(${d.x},${d.y})`)
  })
}

onMounted(() => { draw() })
onUnmounted(() => { if (simulation) simulation.stop() })
watch(() => props.graph, () => { if (simulation) simulation.stop(); draw() }, { deep: true })
</script>

<style scoped>
.txgraph-wrap { position: relative; width: 100%; height: 360px; background: rgba(255,255,255,0.03); border-radius: 10px; overflow: hidden; }
.txgraph-svg  { width: 100%; height: 100%; }

:deep(.txgraph-edge)       { stroke: #374151; stroke-width: 1.5; fill: none; }
:deep(.txgraph-edge-hop2)  { stroke: #1f2937; stroke-width: 1; stroke-dasharray: 3 3; fill: none; }
:deep(.txgraph-center)     { fill: #6366f1; stroke: #818cf8; stroke-width: 2; }
:deep(.txgraph-peer)       { fill: #1f2937; stroke: #4b5563; stroke-width: 1.5; cursor: pointer; transition: fill 0.15s; }
:deep(.txgraph-peer:hover) { fill: #374151; stroke: #6366f1; }
:deep(.txgraph-hop2)       { fill: #111827; stroke: #374151; stroke-width: 1; cursor: pointer; transition: fill 0.15s; }
:deep(.txgraph-hop2:hover) { fill: #1f2937; stroke: #4b5563; }
:deep(.txgraph-label)      { font-size: 9px; fill: #9ca3af; pointer-events: none; font-family: monospace; }
:deep(.txgraph-label-dim)  { font-size: 8px; fill: #4b5563; pointer-events: none; font-family: monospace; }

.txgraph-legend {
  position: absolute;
  bottom: 8px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 10px;
  color: #6b7280;
  pointer-events: none;
}
.txgraph-legend-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 3px;
  vertical-align: middle;
}
.txgraph-legend-center { background: #6366f1; box-shadow: 0 0 0 1.5px #818cf8; }
.txgraph-legend-hop1   { background: #1f2937; box-shadow: 0 0 0 1.5px #4b5563; }
.txgraph-legend-hop2   { background: #111827; box-shadow: 0 0 0 1px #374151; width: 6px; height: 6px; }

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
