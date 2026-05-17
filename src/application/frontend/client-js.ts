export const createClientJs = (): string => `const canvas = document.getElementById('graph')
const ctx = canvas.getContext('2d')
const largeGraphNodeThreshold = 4000
const largeGraphEdgeRenderLimit = 16000
const renderNodeBudget = 1800
const minNodePixelRadius = 1.8
const viewportPaddingPx = 280
const state = {
  graph: { nodes: [], edges: [] },
  nodes: [],
  edges: [],
  visibleNodes: [],
  visibleEdges: [],
  renderNodes: [],
  renderEdges: [],
  nodeDegrees: new Map(),
  selected: null,
  hovered: null,
  query: '',
  contentFilter: { query: '', ids: null, token: 0, timer: null },
  agentId: '',
  agentsSignature: '',
  nodeDetails: new Map(),
  transform: { x: 0, y: 0, scale: 1 },
  pointer: { x: 0, y: 0, down: false, dragNode: null, moved: false },
  graphSignature: '',
  graphStatus: '',
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
  search: byId('search'),
  agent: byId('agent'),
  nodeCount: byId('nodeCount'),
  edgeCount: byId('edgeCount'),
  tagCount: byId('tagCount'),
  zoomIn: byId('zoomIn'),
  zoomOut: byId('zoomOut'),
  fit: byId('fit'),
  reset: byId('reset'),
  contentDialog: byId('contentDialog'),
  contentTitle: byId('contentTitle'),
  contentPath: byId('contentPath'),
  contentTags: byId('contentTags'),
  contentOutgoing: byId('contentOutgoing'),
  contentIncoming: byId('contentIncoming'),
  contentBody: byId('contentBody'),
  contentClose: byId('contentClose')
}

const zoomRange = {
  min: 0.05,
  max: 4.5
}

const agentQuery = () => state.agentId ? '?agent=' + encodeURIComponent(state.agentId) : ''

const setGraphStatus = text => {
  state.graphStatus = text
}

const handleGraphRefreshError = error => {
  console.error(error)
}

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

const normalizeQuery = value => value.trim().toLowerCase()

const localFilteredNodes = query =>
  state.nodes.filter(node =>
    node.title.toLowerCase().includes(query) ||
    node.path.toLowerCase().includes(query) ||
    node.tags.some(tag => tag.toLowerCase().includes(query))
  )

const filteredNodes = () => {
  const query = normalizeQuery(state.query)
  if (!query) return state.nodes
  if (state.contentFilter.query === query && state.contentFilter.ids instanceof Set) {
    return state.nodes.filter(node => state.contentFilter.ids.has(node.id))
  }

  return localFilteredNodes(query)
}

const recomputeVisibility = () => {
  const nodes = filteredNodes()
  const ids = new Set(nodes.map(node => node.id))
  const edges = state.edges.filter(edge => ids.has(edge.source) && edge.target && ids.has(edge.target))
  const limitedEdges = state.nodes.length > largeGraphNodeThreshold
    ? [...edges]
      .sort((left, right) => edgeWeight(right) - edgeWeight(left))
      .slice(0, largeGraphEdgeRenderLimit)
    : edges

  state.visibleNodes = nodes
  state.visibleEdges = limitedEdges
}

const edgeWeight = edge => Number.isFinite(edge.weight) ? Math.max(1, edge.weight) : 1

const clampScale = value => Math.max(zoomRange.min, Math.min(zoomRange.max, value))

const graphBounds = nodes => {
  if (nodes.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  nodes.forEach(node => {
    const radius = baseNodeRadius(node)
    minX = Math.min(minX, node.x - radius)
    maxX = Math.max(maxX, node.x + radius)
    minY = Math.min(minY, node.y - radius)
    maxY = Math.max(maxY, node.y + radius)
  })

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1)
  }
}

const fitScaleBiasByNodeCount = nodeCount => {
  if (nodeCount <= 6) return 2.4
  if (nodeCount <= 20) return 1.9
  if (nodeCount <= 60) return 1.5
  if (nodeCount <= 180) return 1.25
  if (nodeCount <= 600) return 1.05
  if (nodeCount <= 2000) return 0.9
  if (nodeCount <= 6000) return 0.72
  return 0.62
}

const fitView = (options = { useFiltered: true }) => {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(rect.width, 320)
  const height = Math.max(rect.height, 320)
  const nodes = options.useFiltered ? filteredNodes() : state.nodes
  const bounds = graphBounds(nodes)

  if (!bounds) {
    state.transform = { x: width / 2, y: height / 2, scale: 1 }
    return
  }

  const padding = 100
  const scaleX = width / (bounds.width + padding * 2)
  const scaleY = height / (bounds.height + padding * 2)
  const fitScale = clampScale(Math.min(scaleX, scaleY))
  const biasedScale = clampScale(fitScale * fitScaleBiasByNodeCount(nodes.length))
  const minimumLargeGraphScale = nodes.length > largeGraphNodeThreshold ? 0.13 : zoomRange.min
  const scale = Math.max(biasedScale, minimumLargeGraphScale)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2

  state.transform = {
    x: width / 2 - centerX * scale,
    y: height / 2 - centerY * scale,
    scale
  }
}

const resetView = () => fitView({ useFiltered: false })

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

const encodeEntityTag = (value) => {
  const utf8 = new TextEncoder().encode(value)
  let binary = ''

  for (let index = 0; index < utf8.length; index += 1) {
    binary += String.fromCharCode(utf8[index])
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

const graphSignature = graph => JSON.stringify({
  nodes: graph.nodes.map(node => [node.id, node.title, node.path, node.tags]),
  edges: graph.edges.map(edge => [edge.source, edge.target, edge.targetTitle, edge.weight, edge.priority])
})

const resetContentFilter = () => {
  if (state.contentFilter.timer) {
    clearTimeout(state.contentFilter.timer)
  }
  state.contentFilter = {
    query: '',
    ids: null,
    token: state.contentFilter.token + 1,
    timer: null
  }
  recomputeVisibility()
}

const syncContentFilter = async (query, token) => {
  const response = await fetch(
    '/api/graph-filter?q=' +
      encodeURIComponent(query) +
      '&limit=' +
      encodeURIComponent(String(Math.max(state.nodes.length, 1))) +
      agentQuery()
  )

  if (!response.ok || token !== state.contentFilter.token) {
    return
  }

  const payload = await response.json()
  const nodeIds = Array.isArray(payload?.nodeIds) ? payload.nodeIds.filter(id => typeof id === 'string') : []
  if (token !== state.contentFilter.token) {
    return
  }

  state.contentFilter.query = query
  state.contentFilter.ids = new Set(nodeIds)
  recomputeVisibility()
}

const scheduleContentFilterSync = () => {
  const query = normalizeQuery(state.query)
  if (!query) {
    resetContentFilter()
    return
  }

  if (state.contentFilter.timer) {
    clearTimeout(state.contentFilter.timer)
  }

  const token = state.contentFilter.token + 1
  state.contentFilter = {
    query: state.contentFilter.query,
    ids: state.contentFilter.ids,
    token,
    timer: setTimeout(() => {
      syncContentFilter(query, token).catch(() => {})
    }, 180)
  }
}

const tick = delta => {
  const nodes = state.renderNodes.length > 0 ? state.renderNodes : state.visibleNodes
  const edges = state.renderEdges.length > 0 ? state.renderEdges : state.visibleEdges
  if (nodes.length > 1200) {
    return
  }
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
  if (state.nodes.length > largeGraphNodeThreshold && state.transform.scale < 0.55) {
    return null
  }

  const nodes = state.renderNodes
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    const radius = nodeRadius(node)
    if (Math.hypot(point.x - node.x, point.y - node.y) <= radius + 5) return node
  }
  return null
}

const baseNodeRadius = node => {
  const degree = state.nodeDegrees.get(node.id) ?? 0
  return 9 + Math.min(degree, 8) * 1.6
}

const nodeRadius = node => Math.max(baseNodeRadius(node), minNodePixelRadius / Math.max(state.transform.scale, 0.0001))

const worldViewportBounds = () => {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(rect.width, 320)
  const height = Math.max(rect.height, 320)
  const padding = viewportPaddingPx

  return {
    minX: (-state.transform.x - padding) / state.transform.scale,
    maxX: (width - state.transform.x + padding) / state.transform.scale,
    minY: (-state.transform.y - padding) / state.transform.scale,
    maxY: (height - state.transform.y + padding) / state.transform.scale
  }
}

const isNodeInViewport = (node, viewport) =>
  node.x >= viewport.minX &&
  node.x <= viewport.maxX &&
  node.y >= viewport.minY &&
  node.y <= viewport.maxY

const viewportNodeStride = () => {
  if (state.nodes.length <= largeGraphNodeThreshold) {
    return 1
  }

  if (state.transform.scale >= 0.95) {
    return 1
  }
  if (state.transform.scale >= 0.7) {
    return 2
  }
  if (state.transform.scale >= 0.48) {
    return 3
  }
  if (state.transform.scale >= 0.28) {
    return 5
  }

  return 8
}

const computeRenderVisibility = () => {
  if (state.visibleNodes.length <= 2000) {
    state.renderNodes = state.visibleNodes
    const ids = new Set(state.renderNodes.map((node) => node.id))
    state.renderEdges = state.visibleEdges.filter((edge) => ids.has(edge.source) && edge.target && ids.has(edge.target))
    return
  }

  const viewport = worldViewportBounds()
  const stride = viewportNodeStride()
  const picked = []

  for (let index = 0; index < state.visibleNodes.length; index += 1) {
    const node = state.visibleNodes[index]
    if (!isNodeInViewport(node, viewport)) {
      continue
    }

    const isPriority =
      node.id === state.selected?.id ||
      node.id === state.hovered?.id ||
      node.id === state.pointer.dragNode?.id
    if (isPriority || index % stride === 0) {
      picked.push(node)
    }
  }

  const nodes = picked.length > renderNodeBudget
    ? picked.slice(0, renderNodeBudget)
    : picked
  if (nodes.length === 0 && state.visibleNodes.length > 0) {
    const centerX = (viewport.minX + viewport.maxX) / 2
    const centerY = (viewport.minY + viewport.maxY) / 2
    const closest = [...state.visibleNodes]
      .sort((left, right) => {
        const leftDistance = (left.x - centerX) ** 2 + (left.y - centerY) ** 2
        const rightDistance = (right.x - centerX) ** 2 + (right.y - centerY) ** 2
        return leftDistance - rightDistance
      })
      .slice(0, Math.min(renderNodeBudget, 180))
    const closestIds = new Set(closest.map((node) => node.id))

    state.renderNodes = closest
    state.renderEdges = state.visibleEdges.filter(
      (edge) => closestIds.has(edge.source) && edge.target && closestIds.has(edge.target)
    )
    return
  }

  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = state.visibleEdges.filter((edge) => nodeIds.has(edge.source) && edge.target && nodeIds.has(edge.target))

  state.renderNodes = nodes
  state.renderEdges = edges
}

const render = now => {
  const delta = now - state.last
  state.last = now
  const minFrameIntervalMs = state.nodes.length > largeGraphNodeThreshold ? 48 : 16
  if (delta < minFrameIntervalMs) {
    requestAnimationFrame(render)
    return
  }
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

  computeRenderVisibility()
  tick(delta)
  const drawEdges = !(state.nodes.length > largeGraphNodeThreshold && state.transform.scale < 0.22)
  if (drawEdges) {
    state.renderEdges.forEach(edge => {
    const selectedEdge = state.selected && (edge.source === state.selected.id || edge.target === state.selected.id)
    ctx.beginPath()
    ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y)
    ctx.lineTo(edge.targetNode.x, edge.targetNode.y)
    ctx.strokeStyle = selectedEdge ? graphTheme.edgeActive : graphTheme.edge
    ctx.lineWidth = (selectedEdge ? 1.8 : 1) + Math.min(edgeWeight(edge) - 1, 8) * 0.22
    ctx.stroke()
    })
  }

  state.renderNodes.forEach(node => {
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

    const shouldDrawLabels =
      isSelected ||
      isHovered ||
      (state.nodes.length <= largeGraphNodeThreshold && (state.transform.scale > 1.18 || state.nodes.length <= 25))
    if (shouldDrawLabels) {
      ctx.fillStyle = graphTheme.label
      ctx.font = '12px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(node.title.slice(0, 34), node.x, node.y + radius + 8)
    }
  })

  ctx.restore()
  if (state.renderNodes.length === 0) {
    ctx.fillStyle = '#99a5b5'
    ctx.font = '12px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Move or zoom to reveal nearby notes', width / 2, height / 2)
  }
  requestAnimationFrame(render)
}

const list = items => items.length
  ? items.map(item => '<li>' + (item.id ? '<button type="button" data-node-id="' + escapeHtml(item.id) + '">' + escapeHtml(item.title) + '</button>' : escapeHtml(item.title)) + '<small>' + escapeHtml(item.path) + (item.weight ? ' · weight ' + escapeHtml(item.weight) + ' · ' + escapeHtml(item.priority || 'normal') : '') + '</small></li>').join('')
  : '<li><small>No links found.</small></li>'

const linkedNodes = node => {
  const nodeById = new Map(state.nodes.map(item => [item.id, item]))
  const withEdgeMeta = (linkedNode, edge) => linkedNode ? {
    ...linkedNode,
    weight: edge.weight,
    priority: edge.priority
  } : null
  const outgoing = state.graph.edges
    .filter(edge => edge.source === node.id)
    .map(edge => withEdgeMeta(edge.target ? nodeById.get(edge.target) : { title: edge.targetTitle + ' (unresolved)', path: 'Missing note' }, edge))
    .filter(Boolean)
  const incoming = state.graph.edges
    .filter(edge => edge.target === node.id)
    .map(edge => withEdgeMeta(nodeById.get(edge.source), edge))
    .filter(Boolean)

  return { outgoing, incoming }
}

const fetchNodeDetails = async node => {
  const cached = state.nodeDetails.get(node.id)
  if (cached) {
    return cached
  }

  const response = await fetch('/api/graph-node?id=' + encodeURIComponent(node.id) + agentQuery())
  if (!response.ok) {
    throw new Error('Failed to load graph node details')
  }

  const payload = await response.json()
  const detail = payload?.node
  if (!detail || !detail.id) {
    throw new Error('Invalid graph node payload')
  }
  state.nodeDetails.set(detail.id, detail)
  return detail
}

const openContentDialog = async node => {
  if (!node) return
  const { outgoing, incoming } = linkedNodes(node)
  elements.contentTitle.textContent = node.title
  elements.contentPath.textContent = node.path
  elements.contentTags.innerHTML = node.tags.length
    ? node.tags.map(tag => '<span>#' + escapeHtml(tag) + '</span>').join('')
    : '<span>No tags</span>'
  elements.contentOutgoing.innerHTML = list(outgoing)
  elements.contentIncoming.innerHTML = list(incoming)
  elements.contentBody.textContent = 'Loading note content...'
  if (!elements.contentDialog.open) {
    elements.contentDialog.showModal()
  }

  try {
    const detailedNode = await fetchNodeDetails(node)
    if (state.selected?.id !== node.id) {
      return
    }
    elements.contentBody.textContent = detailedNode.content
  } catch {
    elements.contentBody.textContent = 'Unable to load note content.'
  }
}

const selectNode = (node, options = { openContent: false }) => {
  state.selected = node
  if (node && options.openContent) {
    openContentDialog(node).catch(() => {
      elements.contentBody.textContent = 'Unable to load note content.'
    })
  }
}

const selectNodeById = id => {
  const node = state.nodes.find(item => item.id === id)
  if (node) selectNode(node, { openContent: true })
}

const zoomAtPoint = (screenX, screenY, factor) => {
  const nextScale = clampScale(state.transform.scale * factor)
  if (nextScale === state.transform.scale) return
  const worldX = (screenX - state.transform.x) / state.transform.scale
  const worldY = (screenY - state.transform.y) / state.transform.scale
  state.transform.scale = nextScale
  state.transform.x = screenX - worldX * nextScale
  state.transform.y = screenY - worldY * nextScale
}

const wheelZoomFactor = event => {
  const isModifierZoom = event.metaKey || event.ctrlKey
  const delta = Math.abs(event.deltaY)

  if (delta < 1) {
    return event.deltaY < 0 ? 1.04 : 0.96
  }

  const zoomInFactor = isModifierZoom ? 1.12 : 1.08
  const zoomOutFactor = isModifierZoom ? 0.88 : 0.92

  return event.deltaY < 0 ? zoomInFactor : zoomOutFactor
}

const bindEvents = () => {
  window.addEventListener('resize', resize)
  elements.search.addEventListener('input', event => {
    state.query = event.target.value
    recomputeVisibility()
    scheduleContentFilterSync()
  })
  elements.agent.addEventListener('change', event => {
    state.agentId = event.target.value
    state.selected = null
    state.nodeDetails = new Map()
    resetContentFilter()
    recomputeVisibility()
    scheduleContentFilterSync()
    loadGraph({ reset: true }).catch(error => {
      console.error(error)
    })
  })
  elements.zoomIn.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect()
    zoomAtPoint(Math.max(rect.width, 320) / 2, Math.max(rect.height, 320) / 2, 1.18)
  })
  elements.zoomOut.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect()
    zoomAtPoint(Math.max(rect.width, 320) / 2, Math.max(rect.height, 320) / 2, 0.84)
  })
  if (elements.fit) {
    elements.fit.addEventListener('click', () => {
      fitView({ useFiltered: true })
    })
  }
  elements.reset.addEventListener('click', () => {
    resetView()
  })
  elements.contentClose.addEventListener('click', () => elements.contentDialog.close())
  elements.contentDialog.addEventListener('click', event => {
    const target = event.target
    if (target instanceof HTMLElement && target.dataset.nodeId) {
      selectNodeById(target.dataset.nodeId)
      return
    }
    if (event.target === elements.contentDialog) elements.contentDialog.close()
  })
  canvas.addEventListener('wheel', event => {
    event.preventDefault()
    const rect = canvas.getBoundingClientRect()
    const cursorX = event.clientX - rect.left
    const cursorY = event.clientY - rect.top
    const factor = wheelZoomFactor(event)
    zoomAtPoint(cursorX, cursorY, factor)
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
    if (state.pointer.dragNode && !state.pointer.moved) selectNode(state.pointer.dragNode, { openContent: true })
    if (!state.pointer.dragNode && !state.pointer.moved) selectNode(state.hovered, { openContent: true })
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
    const formatAgentLabel = (agent) => agent.id
    elements.agent.innerHTML = agents.length
      ? agents.map(agent => '<option value="' + escapeHtml(agent.id) + '">' + escapeHtml(formatAgentLabel(agent)) + '</option>').join('')
      : '<option value="shared">shared</option>'
    state.agentsSignature = signature
  }
  elements.agent.value = selected
}

const loadGraph = async (options = { reset: false }) => {
  const response = await fetch('/api/graph-layout' + agentQuery(), {
    headers: state.graphSignature
      ? {
          'if-none-match': encodeEntityTag(state.graphSignature)
        }
      : undefined
  })

  if (response.status === 304) {
    return
  }

  const payload = await response.json()
  const graph = payload?.layout ?? payload
  const signature = payload?.signature ?? graphSignature(graph)
  if (!options.reset && signature === state.graphSignature) return
  const selectedId = state.selected?.id
  const layout = createLayout(graph)
  state.graphSignature = signature
  state.graph = graph
  state.nodes = layout.nodes
  state.edges = layout.edges
  state.nodeDegrees = state.edges.reduce((degrees, edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + edgeWeight(edge))
    if (edge.target) {
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + edgeWeight(edge))
    }
    return degrees
  }, new Map())
  state.nodeDetails = new Map()
  resetContentFilter()
  recomputeVisibility()
  scheduleContentFilterSync()
  const tags = new Set(graph.nodes.flatMap(node => node.tags))
  setGraphStatus(state.agentId + ' · ' + graph.nodes.length + ' notes · ' + graph.edges.length + ' links · live')
  elements.nodeCount.textContent = graph.nodes.length
  elements.edgeCount.textContent = graph.edges.length
  elements.tagCount.textContent = tags.size
  resize()
  if (options.reset) resetView()
  const selectedNode = state.nodes.find(node => node.id === selectedId) ?? null
  selectNode(selectedNode, { openContent: Boolean(selectedNode && elements.contentDialog.open) })
  if (!selectedNode && elements.contentDialog.open) {
    elements.contentDialog.close()
  }
}

bindEvents()
requestAnimationFrame(() => {
  resize()
  resetView()
})

const pollIntervalMs = 5000
let tickCounter = 0

const refreshGraphLoop = () => {
  if (document.hidden) {
    return
  }

  loadGraph().catch(handleGraphRefreshError)

  tickCounter += 1
  if (tickCounter % 3 === 0) {
    loadAgents().catch((error) => {
      console.error(error)
    })
  }
}

loadAgents()
  .then(() => loadGraph({ reset: true }))
  .then(() => {
    requestAnimationFrame(render)
    setInterval(refreshGraphLoop, pollIntervalMs)
  })
  .catch(error => {
    console.error(error)
  })

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    return
  }

  loadGraph({ reset: true }).catch(handleGraphRefreshError)
})
`
