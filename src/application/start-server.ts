import { createServer, type IncomingMessage } from 'node:http'
import { extname } from 'node:path'
import { addNote } from './add-note.js'
import { getBrokenLinksReport, getOrphansReport, getStats, validateVault } from './analyze-vault.js'
import { buildContextPackage } from './build-context.js'
import { getGraph } from './get-graph.js'
import { getGraphLayout } from './get-graph-layout.js'
import { indexVault } from './index-vault.js'
import { listAgents } from './list-agents.js'
import { listBacklinks, listLinks } from './list-links.js'
import { searchKnowledge } from './search-knowledge.js'
import { startVaultWatcher } from './watch-vault.js'
import { loadBrainlinkConfig, sanitizeSearchMode } from '../infrastructure/config.js'

type StartServerInput = {
  readonly vaultPath: string
  readonly host: string
  readonly port: number
  readonly shouldIndex: boolean
  readonly shouldWatch: boolean
}

type RunningServer = {
  readonly url: string
  readonly close: () => Promise<void>
}

const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

const createJsonResponse = (value: unknown): string =>
  JSON.stringify(value, null, 2)

const parsePositiveInteger = (value: string | null, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

type HttpError = Error & {
  readonly statusCode: number
}

const createHttpError = (statusCode: number, message: string): HttpError =>
  Object.assign(new Error(message), { statusCode })

const isHttpError = (error: unknown): error is HttpError =>
  error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'

const maxRequestBodyBytes = 1024 * 1024

const readSearchMode = async (url: URL): Promise<ReturnType<typeof sanitizeSearchMode>> => {
  const config = await loadBrainlinkConfig()

  return sanitizeSearchMode(url.searchParams.get('mode'), config.defaultSearchMode)
}

const hasInvalidSearchMode = (url: URL): boolean => {
  const mode = url.searchParams.get('mode')

  return mode !== null && !['fts', 'semantic', 'hybrid'].includes(mode)
}

const readRequestJson = async (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    request.on('data', (chunk: Buffer) => {
      size += chunk.length

      if (size > maxRequestBodyBytes) {
        reject(createHttpError(413, 'Request body too large.'))
        request.destroy()
        return
      }

      chunks.push(chunk)
    })
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8').trim()

      if (!body) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(createHttpError(400, 'Invalid JSON body.'))
      }
    })
    request.on('error', reject)
  })

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isReadMethod = (request: IncomingMessage): boolean =>
  request.method === 'GET' || request.method === 'HEAD'

const createClientHtml = (): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Brainlink Graph</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="shell">
      <section class="workspace" aria-label="Knowledge graph">
        <canvas id="graph" aria-label="Brainlink knowledge graph"></canvas>
        <div class="topbar">
          <div>
            <strong>Brainlink</strong>
            <span id="stats">Loading graph</span>
          </div>
          <label class="search">
            <input id="search" type="search" placeholder="Filter notes, tags or paths" autocomplete="off" />
          </label>
          <label class="agent-filter">
            <select id="agent"></select>
          </label>
        </div>
        <div class="toolbar" aria-label="Graph controls">
          <button id="zoomIn" type="button" title="Zoom in">+</button>
          <button id="zoomOut" type="button" title="Zoom out">-</button>
          <button id="reset" type="button" title="Reset view">⌂</button>
        </div>
      </section>
      <aside class="inspector" aria-label="Selected note">
        <div>
          <span class="eyebrow">Selected note</span>
          <h1 id="title">Graph Overview</h1>
          <p id="path">Select a node to inspect links and backlinks.</p>
        </div>
        <div class="metrics">
          <div><span id="nodeCount">0</span><small>Notes</small></div>
          <div><span id="edgeCount">0</span><small>Links</small></div>
          <div><span id="tagCount">0</span><small>Tags</small></div>
        </div>
        <section>
          <h2>Tags</h2>
          <div id="tags" class="tags"></div>
        </section>
        <section>
          <h2>Notes</h2>
          <ul id="notes"></ul>
        </section>
        <section>
          <h2>Content</h2>
          <pre id="content" class="note-content"></pre>
        </section>
        <section>
          <h2>Outgoing</h2>
          <ul id="outgoing"></ul>
        </section>
        <section>
          <h2>Backlinks</h2>
          <ul id="incoming"></ul>
        </section>
      </aside>
    </main>
    <script src="/app.js"></script>
  </body>
</html>`

const createClientCss = (): string => `:root {
  color-scheme: dark;
  --bg: #0d0f12;
  --panel: #15191f;
  --panel-strong: #1c222b;
  --line: #29313c;
  --text: #edf2f7;
  --muted: #99a5b5;
  --accent: #35d0a2;
  --accent-weak: rgba(53, 208, 162, 0.14);
  --danger: #ff6b6b;
}

* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input,
select {
  font: inherit;
}

.shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  width: 100%;
  height: 100svh;
  overflow: hidden;
}

.workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
}

#graph {
  display: block;
  width: 100%;
  height: 100%;
  background:
    radial-gradient(circle at 18% 20%, rgba(53, 208, 162, 0.12), transparent 28rem),
    linear-gradient(135deg, #0d0f12 0%, #12161c 55%, #0a0d10 100%);
  cursor: grab;
}

#graph:active {
  cursor: grabbing;
}

.topbar {
  position: absolute;
  top: 18px;
  left: 18px;
  right: 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  pointer-events: none;
}

.topbar > div {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.topbar strong {
  font-size: 18px;
}

.topbar span,
.eyebrow,
.inspector small {
  color: var(--muted);
  font-size: 12px;
}

.search {
  width: min(420px, 42vw);
  pointer-events: auto;
}

.agent-filter {
  width: min(220px, 28vw);
  pointer-events: auto;
}

.search input,
.agent-filter select {
  width: 100%;
  height: 40px;
  border: 1px solid var(--line);
  border-radius: 8px;
  outline: none;
  background: rgba(21, 25, 31, 0.88);
  color: var(--text);
  padding: 0 14px;
}

.search input:focus,
.agent-filter select:focus {
  border-color: var(--accent);
}

.toolbar {
  position: absolute;
  left: 18px;
  bottom: 18px;
  display: flex;
  gap: 8px;
}

.toolbar button {
  width: 38px;
  height: 38px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(21, 25, 31, 0.88);
  color: var(--text);
  cursor: pointer;
}

.toolbar button:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.inspector {
  display: grid;
  grid-template-rows: auto auto auto auto auto 1fr 1fr;
  gap: 22px;
  min-width: 0;
  height: 100%;
  padding: 24px;
  border-left: 1px solid var(--line);
  background: var(--panel);
  overflow: auto;
}

.inspector h1,
.inspector h2,
.inspector p {
  margin: 0;
}

.inspector h1 {
  margin-top: 6px;
  font-size: 26px;
  line-height: 1.12;
  overflow-wrap: anywhere;
}

.inspector h2 {
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

#path {
  margin-top: 10px;
  color: var(--muted);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.metrics div {
  display: grid;
  gap: 4px;
  padding: 14px;
  background: var(--panel-strong);
}

.metrics div + div {
  border-left: 1px solid var(--line);
}

.metrics span {
  font-size: 22px;
  font-weight: 700;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tags span {
  max-width: 100%;
  padding: 6px 9px;
  border-radius: 999px;
  background: var(--accent-weak);
  color: var(--accent);
  font-size: 12px;
  overflow-wrap: anywhere;
}

ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
  color: var(--text);
  overflow-wrap: anywhere;
}

li button {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

li button:hover {
  color: var(--accent);
}

li small {
  display: block;
  margin-top: 4px;
}

.note-content {
  max-height: 32svh;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #101419;
  color: var(--text);
  white-space: pre-wrap;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
}

@media (max-width: 860px) {
  .shell {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) 42svh;
  }

  .inspector {
    border-left: 0;
    border-top: 1px solid var(--line);
    padding: 18px;
  }

  .topbar {
    align-items: stretch;
    flex-direction: column;
  }

  .search {
    width: 100%;
  }

  .agent-filter {
    width: 100%;
  }
}`

const createClientJs = (): string => `const canvas = document.getElementById('graph')
const ctx = canvas.getContext('2d')
const state = {
  graph: { nodes: [], edges: [] },
  nodes: [],
  edges: [],
  selected: null,
  hovered: null,
  query: '',
  agentId: '',
  agentsSignature: '',
  transform: { x: 0, y: 0, scale: 1 },
  pointer: { x: 0, y: 0, down: false, dragNode: null, moved: false },
  graphSignature: '',
  last: performance.now()
}

const byId = id => document.getElementById(id)
const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')
const elements = {
  stats: byId('stats'),
  search: byId('search'),
  agent: byId('agent'),
  title: byId('title'),
  path: byId('path'),
  tags: byId('tags'),
  notes: byId('notes'),
  content: byId('content'),
  outgoing: byId('outgoing'),
  incoming: byId('incoming'),
  nodeCount: byId('nodeCount'),
  edgeCount: byId('edgeCount'),
  tagCount: byId('tagCount'),
  zoomIn: byId('zoomIn'),
  zoomOut: byId('zoomOut'),
  reset: byId('reset')
}

const agentQuery = () => state.agentId ? '?agent=' + encodeURIComponent(state.agentId) : ''

const segmentPalette = [
  '#5fb3ff',
  '#78d98f',
  '#f2c14e',
  '#ff8a65',
  '#b084f5',
  '#4dd0c8',
  '#f06fae',
  '#a3b86c',
  '#d88c5a',
  '#8fa7ff'
]

const hashText = value => Array.from(String(value)).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)

const segmentColor = node => {
  const segment = node.segment || node.group || 'default'
  const index = Math.abs(hashText(segment)) % segmentPalette.length

  return segmentPalette[index]
}

const hexToRgba = (hex, alpha) => {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255

  return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + alpha + ')'
}

const resize = () => {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(rect.width, 320)
  const height = Math.max(rect.height, 320)
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.floor(width * ratio)
  canvas.height = Math.floor(height * ratio)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
}

const filteredNodes = () => {
  const query = state.query.trim().toLowerCase()
  if (!query) return state.nodes
  return state.nodes.filter(node =>
    node.title.toLowerCase().includes(query) ||
    node.path.toLowerCase().includes(query) ||
    node.tags.some(tag => tag.toLowerCase().includes(query))
  )
}

const visibleIds = () => new Set(filteredNodes().map(node => node.id))

const visibleEdges = () => {
  const ids = visibleIds()
  return state.edges.filter(edge => ids.has(edge.source) && edge.target && ids.has(edge.target))
}

const resetView = () => {
  const rect = canvas.getBoundingClientRect()
  state.transform = { x: Math.max(rect.width, 320) / 2, y: Math.max(rect.height, 320) / 2, scale: 1 }
}

const createLayout = graph => {
  const nodes = graph.nodes.map(node => ({
    ...node,
    x: Number.isFinite(node.x) ? node.x : 0,
    y: Number.isFinite(node.y) ? node.y : 0
  }))
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const edges = graph.edges
    .filter(edge => edge.target && nodeMap.has(edge.source) && nodeMap.has(edge.target))
    .map(edge => ({ ...edge, sourceNode: nodeMap.get(edge.source), targetNode: nodeMap.get(edge.target) }))
  return { nodes, edges }
}

const graphSignature = graph => JSON.stringify({
  nodes: graph.nodes.map(node => [node.id, node.title, node.path, node.content, node.tags]),
  edges: graph.edges.map(edge => [edge.source, edge.target, edge.targetTitle])
})

const tick = delta => {
  const nodes = filteredNodes()
  const ids = new Set(nodes.map(node => node.id))
  const edges = state.edges.filter(edge => ids.has(edge.source) && edge.target && ids.has(edge.target))
  const strength = Math.min(delta / 16, 2)

  edges.forEach(edge => {
    const source = edge.sourceNode
    const target = edge.targetNode
    const dx = target.x - source.x
    const dy = target.y - source.y
    const distance = Math.max(Math.hypot(dx, dy), 1)
    const force = (distance - 150) * 0.002 * strength
    const fx = dx * force
    const fy = dy * force
    source.vx += fx
    source.vy += fy
    target.vx -= fx
    target.vy -= fy
  })

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]
      const b = nodes[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.max(Math.hypot(dx, dy), 1)
      const force = Math.min(2600 / (distance * distance), 0.12) * strength
      const fx = (dx / distance) * force
      const fy = (dy / distance) * force
      a.vx -= fx
      a.vy -= fy
      b.vx += fx
      b.vy += fy
    }
  }

  nodes.forEach(node => {
    if (state.pointer.dragNode === node) {
      node.vx = 0
      node.vy = 0
      return
    }
    node.vx += -node.x * 0.0008 * strength
    node.vy += -node.y * 0.0008 * strength
    node.vx *= 0.88
    node.vy *= 0.88
    node.x += node.vx * strength
    node.y += node.vy * strength
  })
}

const worldPoint = event => {
  const rect = canvas.getBoundingClientRect()
  return {
    x: (event.clientX - rect.left - state.transform.x) / state.transform.scale,
    y: (event.clientY - rect.top - state.transform.y) / state.transform.scale
  }
}

const hitNode = point => {
  const nodes = filteredNodes()
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    const radius = nodeRadius(node)
    if (Math.hypot(point.x - node.x, point.y - node.y) <= radius + 5) return node
  }
  return null
}

const nodeRadius = node => {
  const degree = state.edges.filter(edge => edge.source === node.id || edge.target === node.id).length
  return 9 + Math.min(degree, 8) * 1.6
}

const render = now => {
  const delta = now - state.last
  state.last = now
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(rect.width, 320)
  const height = Math.max(rect.height, 320)
  ctx.clearRect(0, 0, width, height)
  if (state.nodes.length === 0) {
    ctx.fillStyle = '#99a5b5'
    ctx.font = '14px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('No indexed notes found', width / 2, height / 2)
    requestAnimationFrame(render)
    return
  }
  ctx.save()
  ctx.translate(state.transform.x, state.transform.y)
  ctx.scale(state.transform.scale, state.transform.scale)

  visibleEdges().forEach(edge => {
    const selectedEdge = state.selected && (edge.source === state.selected.id || edge.target === state.selected.id)
    const selectedColor = state.selected ? segmentColor(state.selected) : segmentColor(edge.sourceNode)
    ctx.beginPath()
    ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y)
    ctx.lineTo(edge.targetNode.x, edge.targetNode.y)
    ctx.strokeStyle = selectedEdge ? hexToRgba(selectedColor, 0.58) : 'rgba(153, 165, 181, 0.18)'
    ctx.lineWidth = selectedEdge ? 1.8 : 1
    ctx.stroke()
  })

  filteredNodes().forEach(node => {
    const radius = nodeRadius(node)
    const isSelected = state.selected?.id === node.id
    const isHovered = state.hovered?.id === node.id
    const color = segmentColor(node)
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius + (isSelected ? 7 : isHovered ? 4 : 0), 0, Math.PI * 2)
    ctx.fillStyle = isSelected ? hexToRgba(color, 0.26) : isHovered ? hexToRgba(color, 0.18) : hexToRgba(color, 0.08)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = isSelected ? 2.6 : 1.5
    ctx.strokeStyle = isSelected ? '#edf2f7' : '#0d0f12'
    ctx.stroke()

    if (isSelected || isHovered || state.transform.scale > 1.18 || state.nodes.length <= 25) {
      ctx.fillStyle = '#edf2f7'
      ctx.font = '12px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(node.title.slice(0, 34), node.x, node.y + radius + 8)
    }
  })

  ctx.restore()
  requestAnimationFrame(render)
}

const list = items => items.length
  ? items.map(item => '<li>' + (item.id ? '<button type="button" data-node-id="' + escapeHtml(item.id) + '">' + escapeHtml(item.title) + '</button>' : escapeHtml(item.title)) + '<small>' + escapeHtml(item.path) + '</small></li>').join('')
  : '<li><small>No links found.</small></li>'

const allNotesList = () => state.nodes.length
  ? state.nodes.map(node => '<li><button type="button" data-node-id="' + escapeHtml(node.id) + '">' + escapeHtml(node.title) + '</button><small>' + escapeHtml(node.path) + '</small></li>').join('')
  : '<li><small>No notes indexed.</small></li>'

const selectNode = node => {
  state.selected = node
  if (!node) {
    elements.title.textContent = 'Graph Overview'
    elements.path.textContent = state.nodes.length + ' notes and ' + state.graph.edges.length + ' links indexed.'
    elements.tags.innerHTML = ''
    elements.notes.innerHTML = allNotesList()
    elements.content.textContent = 'Selecione uma nota no grafo ou na lista para ver o Markdown completo, backlinks e links de saida.'
    elements.outgoing.innerHTML = '<li><small>Select a note to inspect outgoing links.</small></li>'
    elements.incoming.innerHTML = '<li><small>Select a note to inspect backlinks.</small></li>'
    return
  }
  const nodeById = new Map(state.nodes.map(item => [item.id, item]))
  const outgoing = state.graph.edges
    .filter(edge => edge.source === node.id)
    .map(edge => edge.target ? nodeById.get(edge.target) : { title: edge.targetTitle + ' (unresolved)', path: 'Missing note' })
    .filter(Boolean)
  const incoming = state.graph.edges
    .filter(edge => edge.target === node.id)
    .map(edge => nodeById.get(edge.source))
    .filter(Boolean)

  elements.title.textContent = node.title
  elements.path.textContent = node.path
  elements.tags.innerHTML = node.tags.length
    ? node.tags.map(tag => '<span>#' + escapeHtml(tag) + '</span>').join('')
    : '<span>No tags</span>'
  elements.notes.innerHTML = allNotesList()
  elements.content.textContent = node.content
  elements.outgoing.innerHTML = list(outgoing)
  elements.incoming.innerHTML = list(incoming)
}

const selectNodeById = id => {
  const node = state.nodes.find(item => item.id === id)
  if (node) selectNode(node)
}

const zoom = factor => {
  state.transform.scale = Math.max(0.25, Math.min(3.5, state.transform.scale * factor))
}

const bindEvents = () => {
  window.addEventListener('resize', resize)
  elements.search.addEventListener('input', event => {
    state.query = event.target.value
    elements.stats.textContent = state.query
      ? filteredNodes().length + ' filtered notes'
      : state.nodes.length + ' notes · ' + state.edges.length + ' links'
  })
  elements.agent.addEventListener('change', event => {
    state.agentId = event.target.value
    state.selected = null
    loadGraph({ reset: true }).catch(error => {
      elements.stats.textContent = 'Failed to load agent graph'
      console.error(error)
    })
  })
  elements.zoomIn.addEventListener('click', () => zoom(1.18))
  elements.zoomOut.addEventListener('click', () => zoom(0.84))
  elements.reset.addEventListener('click', resetView)
  ;[elements.notes, elements.outgoing, elements.incoming].forEach(element => {
    element.addEventListener('click', event => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const nodeId = target.dataset.nodeId
      if (nodeId) selectNodeById(nodeId)
    })
  })
  canvas.addEventListener('wheel', event => {
    event.preventDefault()
    zoom(event.deltaY < 0 ? 1.08 : 0.92)
  }, { passive: false })
  canvas.addEventListener('pointerdown', event => {
    const point = worldPoint(event)
    const node = hitNode(point)
    state.pointer = { x: event.clientX, y: event.clientY, down: true, dragNode: node, moved: false }
    if (node) {
      node.x = point.x
      node.y = point.y
    }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', event => {
    const point = worldPoint(event)
    state.hovered = hitNode(point)
    if (!state.pointer.down) return
    const dx = event.clientX - state.pointer.x
    const dy = event.clientY - state.pointer.y
    state.pointer.x = event.clientX
    state.pointer.y = event.clientY
    state.pointer.moved = state.pointer.moved || Math.abs(dx) + Math.abs(dy) > 3
    if (state.pointer.dragNode) {
      state.pointer.dragNode.x = point.x
      state.pointer.dragNode.y = point.y
      return
    }
    state.transform.x += dx
    state.transform.y += dy
  })
  canvas.addEventListener('pointerup', event => {
    if (state.pointer.dragNode && !state.pointer.moved) selectNode(state.pointer.dragNode)
    if (!state.pointer.dragNode && !state.pointer.moved) selectNode(state.hovered)
    state.pointer = { x: 0, y: 0, down: false, dragNode: null, moved: false }
    canvas.releasePointerCapture(event.pointerId)
  })
}

const loadAgents = async () => {
  const response = await fetch('/api/agents')
  const payload = await response.json()
  const agents = Array.isArray(payload.agents) ? payload.agents : []
  const currentExists = agents.some(agent => agent.id === state.agentId)
  const selected = currentExists
    ? state.agentId
    : (agents.find(agent => agent.id === 'shared')?.id ?? agents[0]?.id ?? 'shared')
  const signature = JSON.stringify(agents.map(agent => [agent.id, agent.documentCount]))

  state.agentId = selected
  if (signature !== state.agentsSignature) {
    elements.agent.innerHTML = agents.length
      ? agents.map(agent => '<option value="' + escapeHtml(agent.id) + '">' + escapeHtml(agent.id) + ' · ' + agent.documentCount + '</option>').join('')
      : '<option value="shared">shared · 0</option>'
    state.agentsSignature = signature
  }
  elements.agent.value = selected
}

const loadGraph = async (options = { reset: false }) => {
  const response = await fetch('/api/graph-layout' + agentQuery())
  const graph = await response.json()
  const signature = graphSignature(graph)
  if (!options.reset && signature === state.graphSignature) return
  const selectedId = state.selected?.id
  const layout = createLayout(graph)
  state.graphSignature = signature
  state.graph = graph
  state.nodes = layout.nodes
  state.edges = layout.edges
  const tags = new Set(graph.nodes.flatMap(node => node.tags))
  elements.stats.textContent = state.agentId + ' · ' + graph.nodes.length + ' notes · ' + graph.edges.length + ' links · live'
  elements.nodeCount.textContent = graph.nodes.length
  elements.edgeCount.textContent = graph.edges.length
  elements.tagCount.textContent = tags.size
  resize()
  if (options.reset) resetView()
  selectNode(state.nodes.find(node => node.id === selectedId) ?? null)
}

bindEvents()
requestAnimationFrame(() => {
  resize()
  resetView()
})
loadAgents().then(() => loadGraph({ reset: true })).then(() => {
  requestAnimationFrame(render)
  setInterval(() => {
    loadAgents().then(() => loadGraph()).catch(error => {
      elements.stats.textContent = 'Failed to refresh graph'
      console.error(error)
    })
  }, 2000)
}).catch(error => {
  elements.stats.textContent = 'Failed to load graph'
  console.error(error)
})`

const createResponse = (body: string, statusCode = 200, contentType = 'text/plain; charset=utf-8') => ({
  body,
  statusCode,
  headers: {
    'content-type': contentType,
    'cache-control': 'no-store'
  }
})

const readAgentQuery = (url: URL): string | undefined =>
  url.searchParams.get('agent') ?? undefined

const route = async (request: IncomingMessage, url: URL, vaultPath: string) => {
  if (isReadMethod(request) && (url.pathname === '/' || url.pathname === '/index.html')) {
    return createResponse(createClientHtml(), 200, contentTypes['.html'])
  }

  if (isReadMethod(request) && url.pathname === '/styles.css') {
    return createResponse(createClientCss(), 200, contentTypes['.css'])
  }

  if (isReadMethod(request) && url.pathname === '/app.js') {
    return createResponse(createClientJs(), 200, contentTypes['.js'])
  }

  if (isReadMethod(request) && url.pathname === '/api/graph') {
    return createResponse(createJsonResponse(await getGraph(vaultPath, readAgentQuery(url))), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/graph-layout') {
    return createResponse(createJsonResponse(await getGraphLayout(vaultPath, readAgentQuery(url))), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/agents') {
    return createResponse(createJsonResponse({ agents: await listAgents(vaultPath) }), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/search') {
    const query = url.searchParams.get('q') ?? ''
    const limit = parsePositiveInteger(url.searchParams.get('limit'), 10)
    const mode = await readSearchMode(url)

    if (hasInvalidSearchMode(url)) {
      return createResponse(createJsonResponse({ error: 'Invalid mode. Use fts, semantic or hybrid.' }), 400, contentTypes['.json'])
    }

    return createResponse(
      createJsonResponse({ query, agent: readAgentQuery(url), limit, mode, results: await searchKnowledge(vaultPath, query, limit, readAgentQuery(url), mode) }),
      200,
      contentTypes['.json']
    )
  }

  if (isReadMethod(request) && url.pathname === '/api/context') {
    const query = url.searchParams.get('q') ?? ''
    const limit = parsePositiveInteger(url.searchParams.get('limit'), 12)
    const tokens = parsePositiveInteger(url.searchParams.get('tokens'), 2000)
    const mode = await readSearchMode(url)

    if (hasInvalidSearchMode(url)) {
      return createResponse(createJsonResponse({ error: 'Invalid mode. Use fts, semantic or hybrid.' }), 400, contentTypes['.json'])
    }

    return createResponse(createJsonResponse(await buildContextPackage(vaultPath, query, limit, tokens, readAgentQuery(url), mode)), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/links') {
    return createResponse(createJsonResponse({ links: await listLinks(vaultPath, readAgentQuery(url)) }), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/backlinks') {
    const title = url.searchParams.get('title') ?? ''

    return createResponse(createJsonResponse({ title, backlinks: await listBacklinks(vaultPath, title, readAgentQuery(url)) }), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/stats') {
    return createResponse(createJsonResponse(await getStats(vaultPath, readAgentQuery(url))), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/broken-links') {
    return createResponse(createJsonResponse({ brokenLinks: await getBrokenLinksReport(vaultPath, readAgentQuery(url)) }), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/orphans') {
    return createResponse(createJsonResponse({ orphans: await getOrphansReport(vaultPath, readAgentQuery(url)) }), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/validate') {
    return createResponse(createJsonResponse(await validateVault(vaultPath, readAgentQuery(url))), 200, contentTypes['.json'])
  }

  if (request.method === 'POST' && url.pathname === '/api/index') {
    return createResponse(createJsonResponse(await indexVault(vaultPath)), 200, contentTypes['.json'])
  }

  if (request.method === 'POST' && url.pathname === '/api/notes') {
    const body = await readRequestJson(request)

    if (!isRecord(body) || typeof body.title !== 'string' || typeof body.content !== 'string' || !body.title.trim() || !body.content.trim()) {
      return createResponse(createJsonResponse({ error: 'Expected JSON body with non-empty title and content.' }), 400, contentTypes['.json'])
    }

    const agent = typeof body.agent === 'string' ? body.agent : undefined
    const path = await addNote(vaultPath, body.title, body.content, agent)
    const index = await indexVault(vaultPath)

    return createResponse(createJsonResponse({ title: body.title, agent, path, index }), 201, contentTypes['.json'])
  }

  return createResponse('Not found', 404)
}

export const startServer = async (input: StartServerInput): Promise<RunningServer> => {
  if (input.shouldIndex) {
    await indexVault(input.vaultPath)
  }

  const watcher = input.shouldWatch
    ? startVaultWatcher({
        vaultPath: input.vaultPath,
        onError: (error) => console.error(error)
      })
    : null

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? input.host}`)
    const extension = extname(url.pathname)
    const contentType = contentTypes[extension] ?? 'text/plain; charset=utf-8'

    route(request, url, input.vaultPath)
      .then((result) => {
        response.writeHead(result.statusCode, result.headers)
        response.end(result.body)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        const statusCode = isHttpError(error) ? error.statusCode : 500
        response.writeHead(statusCode, { 'content-type': contentTypes['.json'] })
        response.end(createJsonResponse({ error: message }))
      })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(input.port, input.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : input.port

  return {
    url: `http://${input.host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        watcher?.close()
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
  }
}
