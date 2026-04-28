export const createClientJs = (): string => `const canvas = document.getElementById('graph')
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

const graphTheme = {
  node: '#aeb8c5',
  nodeSelected: '#f3f7fb',
  nodeHover: '#cbd5e1',
  nodeHalo: 'rgba(203, 213, 225, 0.14)',
  nodeHaloActive: 'rgba(243, 247, 251, 0.2)',
  nodeStroke: '#0d0f12',
  nodeStrokeActive: '#ffffff',
  edge: 'rgba(153, 165, 181, 0.16)',
  edgeActive: 'rgba(226, 232, 240, 0.52)',
  label: '#edf2f7'
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
    ctx.beginPath()
    ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y)
    ctx.lineTo(edge.targetNode.x, edge.targetNode.y)
    ctx.strokeStyle = selectedEdge ? graphTheme.edgeActive : graphTheme.edge
    ctx.lineWidth = selectedEdge ? 1.8 : 1
    ctx.stroke()
  })

  filteredNodes().forEach(node => {
    const radius = nodeRadius(node)
    const isSelected = state.selected?.id === node.id
    const isHovered = state.hovered?.id === node.id
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius + (isSelected ? 7 : isHovered ? 4 : 0), 0, Math.PI * 2)
    ctx.fillStyle = isSelected || isHovered ? graphTheme.nodeHaloActive : graphTheme.nodeHalo
    ctx.fill()
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = isSelected ? graphTheme.nodeSelected : isHovered ? graphTheme.nodeHover : graphTheme.node
    ctx.fill()
    ctx.lineWidth = isSelected ? 2.6 : 1.5
    ctx.strokeStyle = isSelected ? graphTheme.nodeStrokeActive : graphTheme.nodeStroke
    ctx.stroke()

    if (isSelected || isHovered || state.transform.scale > 1.18 || state.nodes.length <= 25) {
      ctx.fillStyle = graphTheme.label
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
