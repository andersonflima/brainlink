export const createClientJs = (): string => `const canvas = document.getElementById('graph')
const ctx = canvas.getContext('2d')
const largeGraphNodeThreshold = 4000
const massiveGraphNodeThreshold = 20000
const largeGraphEdgeRenderLimit = 120000
const renderNodeBudget = 900
const renderEdgeBudget = 2400
const clusterActivationNodeThreshold = 600
const clusterZoomThreshold = 0.18
const macroGalaxyZoomThreshold = 0.012
const massiveAutoFitMacroScale = 0.006
const defaultMacroScale = 0.006
const clusterCellPixelSize = 64
const minNodePixelRadius = 2.3
const viewportPaddingPx = 280
const worldCoordinateLimit = 5_000_000
const transformCoordinateLimit = 20_000_000
const hoverHitTestIntervalMs = 64
const overviewClusterMaxCount = 1400
const zoomRecoveryGuardMs = 1500
const state = {
  graph: { nodes: [], edges: [] },
  nodes: [],
  nodeById: new Map(),
  edges: [],
  visibleNodes: [],
  visibleEdges: [],
  renderNodes: [],
  renderEdges: [],
  renderClusters: [],
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
  cursor: { x: 0, y: 0, inCanvas: false },
  graphSignature: '',
  graphStatus: '',
  graphTotals: { nodes: 0, edges: 0 },
  last: performance.now(),
  offscreenFrameCount: 0,
  recoveringViewport: false,
  renderVisibilityDirty: true,
  lastViewportKey: '',
  visibleNodeSpatial: { cellSize: 220, minX: 0, minY: 0, maxX: 0, maxY: 0, buckets: new Map() },
  visibleEdgeByNode: new Map(),
  overviewClusters: [],
  macroCenter: { x: 0, y: 0 },
  macroRepresentative: null,
  primaryHub: null,
  filterWorker: null,
  filterReady: false,
  lastHoverHitAt: 0,
  lastManualZoomAt: 0
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
  min: 0.0002,
  max: 4.5
}

const initialAgentFromUrl = (() => {
  try {
    const raw = new URL(window.location.href).searchParams.get('agent')
    const value = raw?.trim() ?? ''
    return value.length > 0 ? value : ''
  } catch {
    return ''
  }
})()

const agentQuery = (separator = '?') => state.agentId ? separator + 'agent=' + encodeURIComponent(state.agentId) : ''

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

const initFilterWorker = () => {
  if (typeof Worker === 'undefined') {
    return
  }
  try {
    const worker = new Worker('/app-worker.js')
    worker.onmessage = event => {
      const payload = event.data
      if (!payload || typeof payload !== 'object') return

      if (payload.type === 'ready') {
        state.filterReady = true
        if (state.nodes.length > 0) {
          worker.postMessage({
            type: 'load-nodes',
            nodes: state.nodes.map(node => ({
              id: node.id,
              title: node.title,
              path: node.path || '',
              tags: Array.isArray(node.tags) ? node.tags : []
            }))
          })
        }
        return
      }

      if (payload.type === 'filter-result') {
        const token = payload.token
        if (token !== state.contentFilter.token) {
          return
        }

        const ids = Array.isArray(payload.ids) ? payload.ids.filter(id => typeof id === 'string') : []
        state.contentFilter.query = normalizeQuery(state.query)
        state.contentFilter.ids = new Set(ids)
        recomputeVisibility()
      }
    }
    state.filterWorker = worker
  } catch {
    state.filterWorker = null
    state.filterReady = false
  }
}

const pushNodesToFilterWorker = () => {
  if (!state.filterWorker || !state.filterReady) {
    return
  }

  state.filterWorker.postMessage({
    type: 'load-nodes',
    nodes: state.nodes.map(node => ({
      id: node.id,
      title: node.title,
      path: node.path || '',
      tags: Array.isArray(node.tags) ? node.tags : []
    }))
  })
}

const resize = () => {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(rect.width, 320)
  const height = Math.max(rect.height, 320)
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.floor(width * ratio)
  canvas.height = Math.floor(height * ratio)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  markRenderDirty()
}

const normalizeQuery = value => value.trim().toLowerCase()
const hubNodeRetentionLimit = 2
const hubNodePattern = /\b(memory\s*hub|knowledge\s*hub|hub|moc|map|memory\s*map|mapa)\b/i

const localFilteredNodes = query =>
  state.nodes.filter(node =>
    node.title.toLowerCase().includes(query) ||
    (node.path || '').toLowerCase().includes(query) ||
    node.tags.some(tag => tag.toLowerCase().includes(query))
  )

const rankedHubNodes = () => {
  if (state.nodes.length === 0) {
    return []
  }

  const byTitleAndDegree = [...state.nodes]
    .filter(node => hubNodePattern.test(node.title) || hubNodePattern.test(node.path) || node.tags.some(tag => hubNodePattern.test(tag)))
    .sort((left, right) => {
      const byDegree = (state.nodeDegrees.get(right.id) ?? 0) - (state.nodeDegrees.get(left.id) ?? 0)
      if (byDegree !== 0) return byDegree
      return left.title.localeCompare(right.title)
    })

  if (byTitleAndDegree.length > 0) {
    return byTitleAndDegree.slice(0, hubNodeRetentionLimit)
  }

  return [...state.nodes]
    .sort((left, right) => {
      const byDegree = (state.nodeDegrees.get(right.id) ?? 0) - (state.nodeDegrees.get(left.id) ?? 0)
      if (byDegree !== 0) return byDegree
      return left.title.localeCompare(right.title)
    })
    .slice(0, 1)
}

const withPersistentHubNodes = nodes => {
  if (nodes.length === 0) {
    return rankedHubNodes()
  }

  const ids = new Set(nodes.map(node => node.id))
  const hubsToKeep = rankedHubNodes().filter(node => !ids.has(node.id))
  return nodes.concat(hubsToKeep)
}

const filteredNodes = () => {
  const query = normalizeQuery(state.query)
  if (!query) return state.nodes
  if (state.contentFilter.query === query && state.contentFilter.ids instanceof Set) {
    const matched = state.nodes.filter(node => state.contentFilter.ids.has(node.id))
    return withPersistentHubNodes(matched)
  }

  return withPersistentHubNodes(localFilteredNodes(query))
}

const resolveMacroRepresentative = (nodes) => {
  if (nodes.length === 0) {
    return null
  }

  let best = nodes[0]
  let bestDegree = state.nodeDegrees.get(best.id) ?? 0

  for (let index = 1; index < nodes.length; index += 1) {
    const node = nodes[index]
    const degree = state.nodeDegrees.get(node.id) ?? 0
    if (degree > bestDegree) {
      best = node
      bestDegree = degree
    }
  }

  return best
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
  state.visibleNodeSpatial = createSpatialIndex(nodes)
  state.visibleEdgeByNode = createVisibleEdgeLookup(limitedEdges)
  state.overviewClusters = nodes.length > massiveGraphNodeThreshold ? buildOverviewClusters(nodes) : []
  const bounds = graphBounds(nodes)
  state.macroCenter = bounds
    ? {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2
    }
    : { x: 0, y: 0 }
  state.macroRepresentative = resolveMacroRepresentative(nodes)
  state.primaryHub = rankedHubNodes()[0] ?? null
  markRenderDirty()
}

const edgeWeight = edge => Number.isFinite(edge.weight) ? Math.max(1, edge.weight) : 1
const markRenderDirty = () => {
  state.renderVisibilityDirty = true
}

const createSpatialIndex = nodes => {
  if (nodes.length === 0) {
    return { cellSize: 220, minX: 0, minY: 0, maxX: 0, maxY: 0, buckets: new Map() }
  }

  const bounds = graphBounds(nodes)
  if (!bounds) {
    return { cellSize: 220, minX: 0, minY: 0, maxX: 0, maxY: 0, buckets: new Map() }
  }

  const targetNodesPerCell = 18
  const approximateCellArea = Math.max((bounds.width * bounds.height) / Math.max(nodes.length / targetNodesPerCell, 1), 1)
  const cellSize = Math.max(90, Math.min(2200, Math.sqrt(approximateCellArea)))
  const buckets = new Map()

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    const cellX = Math.floor((node.x - bounds.minX) / cellSize)
    const cellY = Math.floor((node.y - bounds.minY) / cellSize)
    const key = cellX + ':' + cellY
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(node)
      continue
    }
    buckets.set(key, [node])
  }

  return {
    cellSize,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    buckets
  }
}

const viewportNodesFromSpatialIndex = viewport => {
  if (state.visibleNodes.length <= 2500) {
    return state.visibleNodes.filter(node => isNodeInViewport(node, viewport))
  }

  const spatial = state.visibleNodeSpatial
  if (!spatial || spatial.buckets.size === 0) {
    return state.visibleNodes.filter(node => isNodeInViewport(node, viewport))
  }

  const minCellX = Math.floor((viewport.minX - spatial.minX) / spatial.cellSize)
  const maxCellX = Math.floor((viewport.maxX - spatial.minX) / spatial.cellSize)
  const minCellY = Math.floor((viewport.minY - spatial.minY) / spatial.cellSize)
  const maxCellY = Math.floor((viewport.maxY - spatial.minY) / spatial.cellSize)
  const nodes = []

  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const bucket = spatial.buckets.get(cellX + ':' + cellY)
      if (!bucket) continue

      for (let index = 0; index < bucket.length; index += 1) {
        const node = bucket[index]
        if (isNodeInViewport(node, viewport)) {
          nodes.push(node)
        }
      }
    }
  }

  return nodes
}

const createVisibleEdgeLookup = edges => {
  const lookup = new Map()

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index]
    if (!edge.target) continue

    const sourceList = lookup.get(edge.source)
    if (sourceList) {
      sourceList.push(edge)
    } else {
      lookup.set(edge.source, [edge])
    }

    const targetList = lookup.get(edge.target)
    if (targetList) {
      targetList.push(edge)
    } else {
      lookup.set(edge.target, [edge])
    }
  }

  return lookup
}

const buildOverviewClusters = nodes => {
  if (nodes.length === 0) {
    return []
  }

  const bounds = graphBounds(nodes)
  if (!bounds) {
    return []
  }

  const longest = Math.max(bounds.width, bounds.height, 1)
  const cellSize = Math.max(longest / 56, 900)
  const buckets = new Map()

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    const keyX = Math.floor((node.x - bounds.minX) / cellSize)
    const keyY = Math.floor((node.y - bounds.minY) / cellSize)
    const key = keyX + ':' + keyY
    const degree = state.nodeDegrees.get(node.id) ?? 0
    const current = buckets.get(key)
    if (current) {
      current.count += 1
      current.sumX += node.x
      current.sumY += node.y
      if (degree > current.degree) {
        current.representative = node
        current.degree = degree
      }
      continue
    }

    buckets.set(key, {
      id: key,
      count: 1,
      sumX: node.x,
      sumY: node.y,
      representative: node,
      degree
    })
  }

  return Array.from(buckets.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, overviewClusterMaxCount)
    .map((cluster) => ({
      id: cluster.id,
      x: cluster.sumX / Math.max(cluster.count, 1),
      y: cluster.sumY / Math.max(cluster.count, 1),
      count: cluster.count,
      representative: cluster.representative
    }))
}

const filterOverviewClustersByViewport = viewport =>
  state.overviewClusters.filter((cluster) =>
    cluster.x >= viewport.minX &&
    cluster.x <= viewport.maxX &&
    cluster.y >= viewport.minY &&
    cluster.y <= viewport.maxY
  )

const edgeBudgetForCurrentFrame = () => {
  const zoom = state.transform.scale
  if (zoom < 0.12) return 380
  if (zoom < 0.18) return 700
  if (zoom < 0.28) return 1100
  if (zoom < 0.45) return 1600
  if (zoom < 0.7) return 2100
  return renderEdgeBudget
}

const clusterBudgetForScale = (scale) => {
  if (scale < 0.008) return 90
  if (scale < 0.014) return 150
  if (scale < 0.022) return 240
  if (scale < 0.035) return 360
  return 520
}

const nodeBudgetForScale = (scale) => {
  if (scale < 0.035) return 220
  if (scale < 0.06) return 360
  if (scale < 0.09) return 520
  if (scale < 0.14) return 720
  return renderNodeBudget
}

const collectVisibleEdgesForNodes = nodeIds => {
  if (nodeIds.size === 0) {
    return []
  }

  const seen = new Set()
  const collected = []
  const limit = edgeBudgetForCurrentFrame()

  nodeIds.forEach(nodeId => {
    const candidateEdges = state.visibleEdgeByNode.get(nodeId) ?? []
    for (let index = 0; index < candidateEdges.length; index += 1) {
      const edge = candidateEdges[index]
      if (!edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
        continue
      }
      const key = edge.source < edge.target
        ? edge.source + '|' + edge.target + '|' + edge.targetTitle
        : edge.target + '|' + edge.source + '|' + edge.targetTitle
      if (seen.has(key)) continue

      seen.add(key)
      collected.push(edge)
      if (collected.length >= limit) {
        return
      }
    }
  })

  return collected
}

const fallbackViewportNodes = () => {
  const nodes = []
  const maxNodes = Math.min(renderNodeBudget, 220)
  const step = Math.max(1, Math.ceil(state.visibleNodes.length / maxNodes))

  for (let index = 0; index < state.visibleNodes.length && nodes.length < maxNodes; index += step) {
    nodes.push(state.visibleNodes[index])
  }

  if (state.selected && !nodes.find(node => node.id === state.selected.id)) {
    nodes.push(state.selected)
  }

  return nodes
}

const sampleVisibleNodes = (limit = renderNodeBudget, sourceNodes = state.visibleNodes) => {
  if (sourceNodes.length === 0 || limit <= 0) {
    return []
  }

  const nodes = []
  const maxNodes = Math.min(Math.max(limit, 1), sourceNodes.length)
  const step = Math.max(1, Math.ceil(sourceNodes.length / maxNodes))

  for (let index = 0; index < sourceNodes.length && nodes.length < maxNodes; index += step) {
    nodes.push(sourceNodes[index])
  }

  if (state.selected && !nodes.find(node => node.id === state.selected.id)) {
    nodes.push(state.selected)
  }

  return nodes
}

const enrichSampleWithNeighbors = (nodes) => {
  if (nodes.length === 0) {
    return {
      nodes,
      edges: []
    }
  }

  const maxNodes = Math.min(renderNodeBudget, nodes.length + 200)
  const expanded = [...nodes]
  const ids = new Set(expanded.map((node) => node.id))

  for (let index = 0; index < nodes.length && expanded.length < maxNodes; index += 1) {
    const node = nodes[index]
    const candidates = [...(state.visibleEdgeByNode.get(node.id) ?? [])]
      .filter((edge) => edge.target)
      .sort((left, right) => edgeWeight(right) - edgeWeight(left))
      .slice(0, 3)

    for (let candidateIndex = 0; candidateIndex < candidates.length && expanded.length < maxNodes; candidateIndex += 1) {
      const edge = candidates[candidateIndex]
      const otherId = edge.source === node.id ? edge.target : edge.source

      if (!otherId || ids.has(otherId)) {
        continue
      }

      const otherNode = state.nodeById.get(otherId)
      if (!otherNode) {
        continue
      }

      ids.add(otherId)
      expanded.push(otherNode)
    }
  }

  const edges = collectVisibleEdgesForNodes(ids)

  return {
    nodes: expanded,
    edges
  }
}

const ensureHubNodesInRenderedSet = (nodes) => {
  if (nodes.length === 0) {
    return nodes
  }

  const maxNodes = Math.max(renderNodeBudget, nodes.length)
  const ids = new Set(nodes.map((node) => node.id))
  const hubs = rankedHubNodes()
  const merged = [...nodes]

  for (let index = 0; index < hubs.length && merged.length < maxNodes; index += 1) {
    const hub = hubs[index]
    if (!ids.has(hub.id)) {
      merged.push(hub)
      ids.add(hub.id)
    }
  }

  return merged
}

const clampScale = value => Math.max(zoomRange.min, Math.min(zoomRange.max, value))
const isFiniteNumber = value => Number.isFinite(value)
const isReasonableCoordinate = value => isFiniteNumber(value) && Math.abs(value) <= worldCoordinateLimit
const clampTransformCoordinate = value => {
  if (!isFiniteNumber(value)) return 0
  if (value > transformCoordinateLimit) return transformCoordinateLimit
  if (value < -transformCoordinateLimit) return -transformCoordinateLimit
  return value
}

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
  if (nodeCount <= 6) return 1.22
  if (nodeCount <= 20) return 1.12
  if (nodeCount <= 60) return 1.04
  if (nodeCount <= 180) return 1
  if (nodeCount <= 600) return 0.94
  if (nodeCount <= 2000) return 0.82
  if (nodeCount <= 6000) return 0.68
  return 0.56
}

const autoFitScaleRangeByNodeCount = nodeCount => {
  if (nodeCount <= 6) return { min: 0.4, max: 2.2 }
  if (nodeCount <= 20) return { min: 0.34, max: 1.65 }
  if (nodeCount <= 60) return { min: 0.25, max: 1.22 }
  if (nodeCount <= 180) return { min: 0.18, max: 0.92 }
  if (nodeCount <= 600) return { min: 0.12, max: 0.72 }
  if (nodeCount <= 2000) return { min: 0.08, max: 0.52 }
  if (nodeCount <= 6000) return { min: 0.06, max: 0.32 }
  return { min: 0.0008, max: 0.24 }
}

const fitView = (options = { useFiltered: true, macro: false, preferHubCenter: true }) => {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(rect.width, 320)
  const height = Math.max(rect.height, 320)
  const nodes = options.useFiltered ? filteredNodes() : state.nodes
  const bounds = graphBounds(nodes)

  if (!bounds) {
    state.transform = { x: width / 2, y: height / 2, scale: 1 }
    state.offscreenFrameCount = 0
    state.recoveringViewport = false
    markRenderDirty()
    return
  }

  const paddingByNodeCount = nodeCount => {
    if (nodeCount <= 6) return 28
    if (nodeCount <= 20) return 44
    if (nodeCount <= 60) return 68
    if (nodeCount <= 180) return 86
    if (nodeCount <= 600) return 110
    if (nodeCount <= 2000) return 140
    return 180
  }
  const padding = paddingByNodeCount(nodes.length)
  const scaleX = width / (bounds.width + padding * 2)
  const scaleY = height / (bounds.height + padding * 2)
  const fitScale = Math.min(scaleX, scaleY)
  const biasedScale = clampScale(fitScale * fitScaleBiasByNodeCount(nodes.length))
  const scaleRange = autoFitScaleRangeByNodeCount(nodes.length)
  const baselineScale = clampScale(Math.min(scaleRange.max, Math.max(scaleRange.min, biasedScale)))
  const macroScale = nodes.length > massiveGraphNodeThreshold ? massiveAutoFitMacroScale : defaultMacroScale
  const scale = options.macro && nodes.length > 1
    ? clampScale(Math.min(baselineScale, macroScale))
    : nodes.length > massiveGraphNodeThreshold
      ? clampScale(Math.min(baselineScale, massiveAutoFitMacroScale))
      : baselineScale
  const hubCenter =
    options.preferHubCenter && state.primaryHub && nodes.some((node) => node.id === state.primaryHub.id)
      ? state.primaryHub
      : null
  const centerX = hubCenter ? hubCenter.x : (bounds.minX + bounds.maxX) / 2
  const centerY = hubCenter ? hubCenter.y : (bounds.minY + bounds.maxY) / 2

  state.transform = {
    x: clampTransformCoordinate(width / 2 - centerX * scale),
    y: clampTransformCoordinate(height / 2 - centerY * scale),
    scale: clampScale(scale)
  }
  state.offscreenFrameCount = 0
  state.recoveringViewport = false
  markRenderDirty()
}

const resetView = () => fitView({ useFiltered: false, macro: true, preferHubCenter: true })

const createLayout = graph => {
  const nodeRows = Array.isArray(graph.nodes) ? graph.nodes : []
  const edgeRows = Array.isArray(graph.edges) ? graph.edges : []
  const nodes = nodeRows.map(node => {
    if (Array.isArray(node)) {
      const [id, title, x, y, group, segment] = node
      return {
        id: typeof id === 'string' ? id : '',
        title: typeof title === 'string' ? title : 'Untitled',
        path: '',
        tags: [],
        group: typeof group === 'string' ? group : 'root',
        segment: typeof segment === 'string' ? segment : 'root',
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        vx: 0,
        vy: 0
      }
    }

    return {
      ...node,
      path: typeof node.path === 'string' ? node.path : '',
      tags: Array.isArray(node.tags) ? node.tags : [],
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      vx: Number.isFinite(node.vx) ? node.vx : 0,
      vy: Number.isFinite(node.vy) ? node.vy : 0
    }
  })
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const edges = edgeRows
    .map(edge => {
      if (Array.isArray(edge)) {
        const [source, target, weight, priority] = edge
        return {
          source: typeof source === 'string' ? source : '',
          target: typeof target === 'string' ? target : null,
          targetTitle: '',
          weight: Number.isFinite(weight) ? weight : 1,
          priority: typeof priority === 'string' ? priority : 'normal'
        }
      }
      return edge
    })
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
      agentQuery('&')
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
  const merged = new Set([...(state.contentFilter.ids instanceof Set ? state.contentFilter.ids : []), ...nodeIds])
  state.contentFilter.ids = merged
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
      if (state.filterWorker && state.filterReady) {
        state.filterWorker.postMessage({
          type: 'filter',
          query,
          token,
          limit: Math.max(state.nodes.length, 1)
        })
      }
      syncContentFilter(query, token).catch(() => {})
    }, 180)
  }
}

const tick = delta => {
  const nodes = state.renderNodes.length > 0 ? state.renderNodes : state.visibleNodes
  const edges = state.renderEdges.length > 0 ? state.renderEdges : state.visibleEdges
  const shouldRunPhysics =
    state.nodes.length <= 8000 &&
    nodes.length <= 320 &&
    state.transform.scale >= 0.08
  if (!shouldRunPhysics) {
    return
  }
  const strength = Math.min(delta / 16, 2)

  edges.forEach(edge => {
    const source = edge.sourceNode
    const target = edge.targetNode
    source.vx = Number.isFinite(source.vx) ? source.vx : 0
    source.vy = Number.isFinite(source.vy) ? source.vy : 0
    target.vx = Number.isFinite(target.vx) ? target.vx : 0
    target.vy = Number.isFinite(target.vy) ? target.vy : 0
    const dx = target.x - source.x
    const dy = target.y - source.y
    const distance = Math.max(Math.hypot(dx, dy), 1)
    const force = (distance - 150) * 0.002 * strength
    const fx = (dx / distance) * force
    const fy = (dy / distance) * force
    source.vx += fx
    source.vy += fy
    target.vx -= fx
    target.vy -= fy
  })

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]
      const b = nodes[j]
      a.vx = Number.isFinite(a.vx) ? a.vx : 0
      a.vy = Number.isFinite(a.vy) ? a.vy : 0
      b.vx = Number.isFinite(b.vx) ? b.vx : 0
      b.vy = Number.isFinite(b.vy) ? b.vy : 0
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
    node.vx = Number.isFinite(node.vx) ? node.vx : 0
    node.vy = Number.isFinite(node.vy) ? node.vy : 0
    node.x = Number.isFinite(node.x) ? node.x : 0
    node.y = Number.isFinite(node.y) ? node.y : 0
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
  computeRenderVisibility()
  if (state.renderClusters.length > 0) {
    return null
  }
  if (state.nodes.length > largeGraphNodeThreshold && state.transform.scale < 0.9) {
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

const shouldRenderClusters = viewportNodes =>
  state.transform.scale <= clusterZoomThreshold && viewportNodes.length >= clusterActivationNodeThreshold

const clusterViewportNodes = viewportNodes => {
  if (!shouldRenderClusters(viewportNodes)) {
    return []
  }

  const worldCellSize = Math.max(clusterCellPixelSize / Math.max(state.transform.scale, 0.0001), 1)
  const buckets = new Map()

  for (let index = 0; index < viewportNodes.length; index += 1) {
    const node = viewportNodes[index]
    const keyX = Math.floor(node.x / worldCellSize)
    const keyY = Math.floor(node.y / worldCellSize)
    const key = keyX + ':' + keyY
    const current = buckets.get(key)
    if (current) {
      current.count += 1
      current.sumX += node.x
      current.sumY += node.y
      if ((state.nodeDegrees.get(node.id) ?? 0) > current.degree) {
        current.representative = node
        current.degree = state.nodeDegrees.get(node.id) ?? 0
      }
      continue
    }

    buckets.set(key, {
      id: key,
      count: 1,
      sumX: node.x,
      sumY: node.y,
      representative: node,
      degree: state.nodeDegrees.get(node.id) ?? 0
    })
  }

  return Array.from(buckets.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, Math.min(renderNodeBudget, 900))
    .map((cluster) => ({
      id: cluster.id,
      x: cluster.sumX / Math.max(cluster.count, 1),
      y: cluster.sumY / Math.max(cluster.count, 1),
      count: cluster.count,
      representative: cluster.representative
    }))
}

const computeRenderVisibility = () => {
  if (!hasValidTransform()) {
    fitView({ useFiltered: true })
  }
  const viewport = worldViewportBounds()
  const viewportKey =
    Math.round(viewport.minX * 10) + ':' +
    Math.round(viewport.maxX * 10) + ':' +
    Math.round(viewport.minY * 10) + ':' +
    Math.round(viewport.maxY * 10) + ':' +
    Math.round(state.transform.scale * 1000)

  if (!state.renderVisibilityDirty && viewportKey === state.lastViewportKey) {
    return
  }
  state.lastViewportKey = viewportKey
  state.renderVisibilityDirty = false

  const shouldRenderMacroGalaxy =
    state.transform.scale <= macroGalaxyZoomThreshold && state.visibleNodes.length > 1

  if (shouldRenderMacroGalaxy) {
    const viewportNodes = viewportNodesFromSpatialIndex(viewport)
    const sourceNodes = viewportNodes.length > 0 ? viewportNodes : state.visibleNodes
    const representative = state.macroRepresentative ?? sourceNodes[0] ?? null
    if (representative) {
      state.renderClusters = [
        {
          id: 'macro-galaxy',
          x: state.macroCenter.x,
          y: state.macroCenter.y,
          count: sourceNodes.length,
          representative
        }
      ]
      state.renderNodes = [representative]
    } else {
      state.renderClusters = []
      state.renderNodes = []
    }
    state.renderEdges = []
    return
  }

  if (state.visibleNodes.length <= 2000) {
    state.renderNodes = state.visibleNodes
    state.renderClusters = []
    const ids = new Set(state.renderNodes.map((node) => node.id))
    state.renderEdges = collectVisibleEdgesForNodes(ids)
    return
  }

  if (state.visibleNodes.length > massiveGraphNodeThreshold) {
    const viewportNodes = viewportNodesFromSpatialIndex(viewport)
    const sourceNodes = viewportNodes.length > 0 ? viewportNodes : state.visibleNodes
    const sampleLimit = nodeBudgetForScale(state.transform.scale)
    const sampled = sourceNodes.length > sampleLimit
      ? sampleVisibleNodes(Math.min(sampleLimit, renderNodeBudget), sourceNodes)
      : sourceNodes.slice(0, Math.min(sourceNodes.length, renderNodeBudget))
    const sampledIds = new Set(sampled.map((node) => node.id))
    let sampledEdges = state.transform.scale >= 0.035 ? collectVisibleEdgesForNodes(sampledIds) : []
    let sampledNodes = ensureHubNodesInRenderedSet(sampled)

    if (state.transform.scale >= 0.035 && sampledEdges.length === 0) {
      const enriched = enrichSampleWithNeighbors(sampledNodes)
      sampledNodes = ensureHubNodesInRenderedSet(enriched.nodes)
      const sampledWithHubsIds = new Set(sampledNodes.map((node) => node.id))
      sampledEdges = collectVisibleEdgesForNodes(sampledWithHubsIds)
    }

    state.renderClusters = []
    state.renderNodes = sampledNodes
    state.renderEdges = sampledEdges
    return
  }

  if (state.transform.scale <= 0.0015) {
    const sampled = sampleVisibleNodes(Math.min(renderNodeBudget, 900))
    const sampledIds = new Set(sampled.map((node) => node.id))
    state.renderClusters = []
    state.renderNodes = sampled
    state.renderEdges = collectVisibleEdgesForNodes(sampledIds)
    return
  }

  const viewportNodes = viewportNodesFromSpatialIndex(viewport)
  const clusters = clusterViewportNodes(viewportNodes)
  if (clusters.length > 0) {
    state.renderClusters = clusters
    state.renderNodes = clusters.map(cluster => cluster.representative)
    state.renderEdges = []
    return
  }
  state.renderClusters = []
  const stride = viewportNodeStride()
  const picked = []

  for (let index = 0; index < viewportNodes.length; index += 1) {
    const node = viewportNodes[index]

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
    const fallbackNodes = fallbackViewportNodes()
    const fallbackIds = new Set(fallbackNodes.map((node) => node.id))
    state.renderNodes = fallbackNodes
    state.renderClusters = []
    state.renderEdges = collectVisibleEdgesForNodes(fallbackIds)
    return
  }

  const normalizedNodes = ensureHubNodesInRenderedSet(nodes)
  const nodeIds = new Set(normalizedNodes.map((node) => node.id))
  const edges = collectVisibleEdgesForNodes(nodeIds)

  state.renderNodes = normalizedNodes
  state.renderEdges = edges

  if (state.renderNodes.length === 0 && state.visibleNodes.length > 0) {
    const fallbackNodes = sampleVisibleNodes(Math.min(renderNodeBudget, 260))
    const fallbackIds = new Set(fallbackNodes.map((node) => node.id))
    state.renderClusters = []
    state.renderNodes = fallbackNodes
    state.renderEdges = collectVisibleEdgesForNodes(fallbackIds)
  }
}

const isNodeVisibleOnScreen = (node, width, height) => {
  const radius = nodeRadius(node) * state.transform.scale
  const screenX = node.x * state.transform.scale + state.transform.x
  const screenY = node.y * state.transform.scale + state.transform.y

  return (
    screenX + radius >= 0 &&
    screenX - radius <= width &&
    screenY + radius >= 0 &&
    screenY - radius <= height
  )
}

const hasValidTransform = () =>
  isFiniteNumber(state.transform.x) &&
  isFiniteNumber(state.transform.y) &&
  isFiniteNumber(state.transform.scale) &&
  Math.abs(state.transform.x) <= transformCoordinateLimit &&
  Math.abs(state.transform.y) <= transformCoordinateLimit &&
  state.transform.scale > 0

const sanitizeNodePosition = node => {
  if (!isReasonableCoordinate(node.x)) node.x = 0
  if (!isReasonableCoordinate(node.y)) node.y = 0
  if (!isFiniteNumber(node.vx) || Math.abs(node.vx) > worldCoordinateLimit) node.vx = 0
  if (!isFiniteNumber(node.vy) || Math.abs(node.vy) > worldCoordinateLimit) node.vy = 0
}

const sanitizeAllNodePositions = () => {
  state.nodes.forEach(sanitizeNodePosition)
  state.visibleNodes.forEach(sanitizeNodePosition)
}

const sanitizeGraphState = () => {
  state.renderNodes.forEach(sanitizeNodePosition)
}

const render = now => {
  const delta = now - state.last
  state.last = now
  const backgroundFrameIntervalMs =
    state.nodes.length > massiveGraphNodeThreshold
      ? (state.transform.scale < 0.035 ? 130 : state.transform.scale < 0.08 ? 110 : 86)
      : state.nodes.length > largeGraphNodeThreshold
        ? 64
        : 16
  const isInteracting =
    state.pointer.down ||
    state.renderVisibilityDirty ||
    state.recoveringViewport
  const minFrameIntervalMs = isInteracting ? 16 : backgroundFrameIntervalMs
  if (delta < minFrameIntervalMs) {
    requestAnimationFrame(render)
    return
  }
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(rect.width, 320)
  const height = Math.max(rect.height, 320)
  sanitizeGraphState()
  if (!hasValidTransform()) {
    resetView()
  }
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
  const hasVisibleNodeOnScreen = state.renderNodes.some((node) => isNodeVisibleOnScreen(node, width, height))
  const manualZoomGuardActive = now - state.lastManualZoomAt < zoomRecoveryGuardMs
  if (!hasVisibleNodeOnScreen && state.renderNodes.length > 0 && !manualZoomGuardActive) {
    state.offscreenFrameCount += 1
    if (state.offscreenFrameCount >= 6 && !state.recoveringViewport) {
      state.recoveringViewport = true
      fitView({ useFiltered: true })
      state.offscreenFrameCount = 0
      requestAnimationFrame(() => {
        state.recoveringViewport = false
      })
    }
  } else {
    state.offscreenFrameCount = 0
  }
  const minimumEdgeScale =
    state.renderNodes.length > 1300
      ? 0.12
      : state.renderNodes.length > 900
        ? 0.085
        : state.renderNodes.length > 500
          ? 0.05
          : 0
  const drawEdges =
    state.renderClusters.length === 0 &&
    state.transform.scale >= minimumEdgeScale
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

  if (state.renderClusters.length > 0) {
    const safeScale = Math.max(state.transform.scale, 0.0001)
    state.renderClusters.forEach(cluster => {
      const isMacro = cluster.id === 'macro-galaxy'
      const radiusPx = isMacro
        ? 10
        : Math.max(8, Math.min(28, 8 + Math.log2(cluster.count + 1) * 3))
      const radius = radiusPx / safeScale
      const haloRadius = (radiusPx + (isMacro ? 8 : 4)) / safeScale
      ctx.beginPath()
      ctx.arc(cluster.x, cluster.y, haloRadius, 0, Math.PI * 2)
      ctx.fillStyle = isMacro ? 'rgba(243, 247, 251, 0.28)' : graphTheme.nodeHalo
      ctx.fill()
      ctx.beginPath()
      ctx.arc(cluster.x, cluster.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = isMacro ? '#f3f7fb' : graphTheme.node
      ctx.fill()
      ctx.lineWidth = 1.4 / safeScale
      ctx.strokeStyle = isMacro ? '#ffffff' : graphTheme.nodeStroke
      ctx.stroke()
      // Keep cluster markers minimal and faster to draw on large graphs.
    })
  } else {
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
  }

  ctx.restore()
  if (state.renderNodes.length === 0 && state.renderClusters.length === 0) {
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
  const outgoing = state.edges
    .filter(edge => edge.source === node.id)
    .map(edge => withEdgeMeta(edge.target ? nodeById.get(edge.target) : { title: (edge.targetTitle || 'Unknown') + ' (unresolved)', path: 'Missing note' }, edge))
    .filter(Boolean)
  const incoming = state.edges
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

  const response = await fetch('/api/graph-node?id=' + encodeURIComponent(node.id) + agentQuery('&'))
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

const wait = async (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))

const openContentDialog = async node => {
  if (!node) return
  elements.contentTitle.textContent = node.title || 'Loading...'
  elements.contentPath.textContent = node.path || 'Loading...'
  elements.contentTags.innerHTML = Array.isArray(node.tags) && node.tags.length
    ? node.tags.map(tag => '<span>#' + escapeHtml(tag) + '</span>').join('')
    : '<span>No tags</span>'
  const initialLinks = linkedNodes(node)
  elements.contentOutgoing.innerHTML = list(initialLinks.outgoing)
  elements.contentIncoming.innerHTML = list(initialLinks.incoming)
  elements.contentBody.textContent = 'Loading note content...'
  if (!elements.contentDialog.open) {
    elements.contentDialog.showModal()
  }

  const applyDetailToDialog = detail => {
    elements.contentTitle.textContent = detail.title
    elements.contentPath.textContent = detail.path
    elements.contentTags.innerHTML = detail.tags.length
      ? detail.tags.map(tag => '<span>#' + escapeHtml(tag) + '</span>').join('')
      : '<span>No tags</span>'
    elements.contentBody.textContent = detail.content
  }

  try {
    const detailedNode = await fetchNodeDetails(node)
    if (state.selected?.id !== node.id) {
      return
    }
    applyDetailToDialog(detailedNode)
  } catch {
    try {
      await wait(120)
      const retriedNode = await fetchNodeDetails(node)
      if (state.selected?.id !== node.id) {
        return
      }
      applyDetailToDialog(retriedNode)
    } catch {
      elements.contentBody.textContent = 'Unable to load note content.'
    }
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

const zoomAtPoint = (screenX, screenY, factor, source = 'generic') => {
  if (source === 'wheel') {
    state.lastManualZoomAt = performance.now()
  }
  const nextScale = clampScale(state.transform.scale * factor)
  if (nextScale === state.transform.scale) {
    return
  }
  const worldX = (screenX - state.transform.x) / state.transform.scale
  const worldY = (screenY - state.transform.y) / state.transform.scale
  state.transform.scale = clampScale(nextScale)
  state.transform.x = clampTransformCoordinate(screenX - worldX * nextScale)
  state.transform.y = clampTransformCoordinate(screenY - worldY * nextScale)
  state.offscreenFrameCount = 0
  markRenderDirty()
}

const wheelZoomFactor = event => {
  const isModifierZoom = event.metaKey || event.ctrlKey
  const deltaModeFactor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1
  const absoluteDelta = Math.min(Math.abs(event.deltaY * deltaModeFactor), 1600)

  if (absoluteDelta <= 0.0001) {
    return 1
  }

  const baseStep = Math.max(0.06, Math.min(0.45, absoluteDelta / 480))
  const adjustedStep = baseStep * (isModifierZoom ? 1.4 : 1)

  return event.deltaY < 0 ? 1 + adjustedStep : 1 / (1 + adjustedStep)
}

const handleWheelZoom = event => {
  if (elements.contentDialog?.open) {
    return
  }

  event.preventDefault()
  const rect = canvas.getBoundingClientRect()
  const rawCursorX = Number.isFinite(event.offsetX) ? event.offsetX : event.clientX - rect.left
  const rawCursorY = Number.isFinite(event.offsetY) ? event.offsetY : event.clientY - rect.top
  const cursorX = Math.max(0, Math.min(Math.max(rect.width, 320), rawCursorX))
  const cursorY = Math.max(0, Math.min(Math.max(rect.height, 320), rawCursorY))
  const factor = wheelZoomFactor(event)

  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) {
    return
  }

  zoomAtPoint(cursorX, cursorY, factor, 'wheel')
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
    zoomAtPoint(Math.max(rect.width, 320) / 2, Math.max(rect.height, 320) / 2, 1.3)
  })
  elements.zoomOut.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect()
    zoomAtPoint(Math.max(rect.width, 320) / 2, Math.max(rect.height, 320) / 2, 0.77)
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
  canvas.addEventListener('wheel', handleWheelZoom, { passive: false })
  canvas.addEventListener('dblclick', event => {
    const rect = canvas.getBoundingClientRect()
    const cursorX = event.clientX - rect.left
    const cursorY = event.clientY - rect.top
    zoomAtPoint(cursorX, cursorY, 1.25)
  })
  canvas.addEventListener('pointerdown', event => {
    const point = worldPoint(event)
    const node = hitNode(point)
    state.pointer = { x: event.clientX, y: event.clientY, down: true, dragNode: node, moved: false }
    if (node) {
      node.x = point.x
      node.y = point.y
      markRenderDirty()
    }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', event => {
    const point = worldPoint(event)
    const now = performance.now()
    const canHoverHitTest =
      !(state.nodes.length > massiveGraphNodeThreshold && state.transform.scale < 0.12)
    const shouldHitTest = canHoverHitTest &&
      (state.pointer.down || now - state.lastHoverHitAt >= hoverHitTestIntervalMs)
    if (shouldHitTest) {
      state.hovered = hitNode(point)
      state.lastHoverHitAt = now
    } else if (!canHoverHitTest) {
      state.hovered = null
    }
    state.cursor = { x: event.clientX, y: event.clientY, inCanvas: true }
    if (!state.pointer.down) return
    const dx = event.clientX - state.pointer.x
    const dy = event.clientY - state.pointer.y
    state.pointer.x = event.clientX
    state.pointer.y = event.clientY
    state.pointer.moved = state.pointer.moved || Math.abs(dx) + Math.abs(dy) > 3
    if (state.pointer.dragNode) {
      state.pointer.dragNode.x = point.x
      state.pointer.dragNode.y = point.y
      markRenderDirty()
      return
    }
    state.transform.x += dx
    state.transform.y += dy
    state.transform.x = clampTransformCoordinate(state.transform.x)
    state.transform.y = clampTransformCoordinate(state.transform.y)
    state.offscreenFrameCount = 0
    markRenderDirty()
  })
  canvas.addEventListener('pointerup', event => {
    if (state.pointer.dragNode && !state.pointer.moved) selectNode(state.pointer.dragNode, { openContent: true })
    if (!state.pointer.dragNode && !state.pointer.moved) selectNode(state.hovered, { openContent: true })
    state.pointer = { x: 0, y: 0, down: false, dragNode: null, moved: false }
    canvas.releasePointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointercancel', () => {
    state.pointer = { x: 0, y: 0, down: false, dragNode: null, moved: false }
  })
  canvas.addEventListener('pointerenter', event => {
    state.cursor = { x: event.clientX, y: event.clientY, inCanvas: true }
  })
  canvas.addEventListener('pointerleave', event => {
    state.cursor = { x: event.clientX, y: event.clientY, inCanvas: false }
  })
  window.addEventListener('keydown', event => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAtPoint(Math.max(rect.width, 320) / 2, Math.max(rect.height, 320) / 2, 1.25)
      return
    }

    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      zoomAtPoint(Math.max(rect.width, 320) / 2, Math.max(rect.height, 320) / 2, 0.8)
      return
    }

    if (event.key === '0') {
      event.preventDefault()
      resetView()
    }
  })
}

const loadAgents = async () => {
  const response = await fetch('/api/agents')
  const payload = await response.json()
  const agents = Array.isArray(payload.agents) ? payload.agents : []
  const preferredAgent = state.agentId || initialAgentFromUrl
  const currentExists = agents.some(agent => agent.id === preferredAgent)
  const selected = currentExists
    ? preferredAgent
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
  state.graphTotals = {
    nodes: Number.isFinite(payload?.totals?.nodes) ? payload.totals.nodes : (Array.isArray(graph.nodes) ? graph.nodes.length : 0),
    edges: Number.isFinite(payload?.totals?.edges) ? payload.totals.edges : (Array.isArray(graph.edges) ? graph.edges.length : 0)
  }
  const signature = payload?.signature ?? graphSignature(graph)
  if (!options.reset && signature === state.graphSignature) return
  const selectedId = state.selected?.id
  const layout = createLayout(graph)
  state.graphSignature = signature
  state.graph = graph
  state.nodes = layout.nodes
  state.nodeById = new Map(state.nodes.map((node) => [node.id, node]))
  state.edges = layout.edges
  state.nodeDegrees = state.edges.reduce((degrees, edge) => {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + edgeWeight(edge))
    if (edge.target) {
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + edgeWeight(edge))
    }
    return degrees
  }, new Map())
  state.nodeDetails = new Map()
  pushNodesToFilterWorker()
  resetContentFilter()
  sanitizeAllNodePositions()
  recomputeVisibility()
  scheduleContentFilterSync()
  const tags = new Set(state.nodes.flatMap(node => node.tags))
  setGraphStatus(state.agentId + ' · ' + state.graphTotals.nodes + ' notes · ' + state.graphTotals.edges + ' links · live')
  elements.nodeCount.textContent = state.graphTotals.nodes
  elements.edgeCount.textContent = state.graphTotals.edges
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
initFilterWorker()
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
