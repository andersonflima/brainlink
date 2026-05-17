import type { IncomingMessage } from 'node:http'
import { getBrokenLinksReport, getOrphansReport, getStats, validateVault } from '../analyze-vault.js'
import { buildContextPackage } from '../build-context.js'
import { getGraph } from '../get-graph.js'
import { getGraphNode } from '../get-graph-node.js'
import { getGraphLayout } from '../get-graph-layout.js'
import { listAgents } from '../list-agents.js'
import { listBacklinks, listLinks } from '../list-links.js'
import { searchGraphNodeIds } from '../search-graph-node-ids.js'
import { searchKnowledge } from '../search-knowledge.js'
import { loadBrainlinkConfig, sanitizeSearchMode } from '../../infrastructure/config.js'
import { createClientCss } from '../frontend/client-css.js'
import { createClientHtml } from '../frontend/client-html.js'
import { createClientJs } from '../frontend/client-js.js'
import { createClientWorkerJs } from '../frontend/client-worker-js.js'
import { contentTypes, createJsonResponse, isReadMethod, parsePositiveInteger } from './http.js'
import type { HttpResponse } from './types.js'
import type { KnowledgeGraphLayout } from '../../domain/types.js'

const readSearchMode = async (url: URL): Promise<ReturnType<typeof sanitizeSearchMode>> => {
  const config = await loadBrainlinkConfig()

  return sanitizeSearchMode(url.searchParams.get('mode'), config.defaultSearchMode)
}

const hasInvalidSearchMode = (url: URL): boolean => {
  const mode = url.searchParams.get('mode')

  return mode !== null && !['fts', 'semantic', 'hybrid'].includes(mode)
}

const createResponse = (body: string, statusCode = 200, contentType = 'text/plain; charset=utf-8'): HttpResponse => ({
  body,
  statusCode,
  headers: {
    'content-type': contentType,
    'cache-control': 'no-store'
  }
})

const normalizeHeaderToken = (value: string | undefined): string =>
  value?.trim().replace(/^"|"$/g, '') ?? ''

const decodeEntityTag = (candidate: string): string => {
  const token = normalizeHeaderToken(candidate)
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return token

  try {
    return Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return token
  }
}

const encodeEntityTag = (signature: string): string =>
  JSON.stringify(Buffer.from(signature, 'utf8').toString('base64url'))

const sameEntityTag = (candidate: string | string[] | undefined, signature: string): boolean => {
  if (Array.isArray(candidate)) {
    return candidate.some((value) => sameEntityTag(value, signature))
  }
  if (candidate === undefined) {
    return false
  }

  return decodeEntityTag(candidate) === signature
}

const readAgentQuery = (url: URL): string | undefined =>
  url.searchParams.get('agent') ?? undefined

const compactGraphLayoutThreshold = 12_000
const compactGraphLayoutEdgeLimit = 60_000

const compactGraphLayoutEdgeLimitFor = (nodeCount: number): number => {
  if (nodeCount > 100_000) return 15_000
  if (nodeCount > 50_000) return 22_000
  if (nodeCount > 25_000) return 30_000
  return compactGraphLayoutEdgeLimit
}

const edgeWeight = (weight: number | undefined): number =>
  Number.isFinite(weight) ? Number(weight) : 1

const edgeKey = (source: string, target: string, priority: string): string =>
  `${source}|${target}|${priority}`

const selectCompactEdges = (layout: KnowledgeGraphLayout, limit: number): readonly KnowledgeGraphLayout['edges'][number][] => {
  const resolvedEdges = layout.edges.filter(
    (edge): edge is KnowledgeGraphLayout['edges'][number] & { readonly target: string } =>
      typeof edge.target === 'string' && edge.target.length > 0
  )

  if (resolvedEdges.length <= limit) {
    return resolvedEdges
  }

  const bestEdgeByEndpoint = new Map<string, KnowledgeGraphLayout['edges'][number] & { readonly target: string }>()
  for (let index = 0; index < resolvedEdges.length; index += 1) {
    const edge = resolvedEdges[index]
    const endpoints = [edge.source, edge.target]

    for (let endpointIndex = 0; endpointIndex < endpoints.length; endpointIndex += 1) {
      const endpoint = endpoints[endpointIndex]
      const previous = bestEdgeByEndpoint.get(endpoint)
      if (!previous || edgeWeight(edge.weight) > edgeWeight(previous.weight)) {
        bestEdgeByEndpoint.set(endpoint, edge)
      }
    }
  }

  const selected = new Map<string, KnowledgeGraphLayout['edges'][number] & { readonly target: string }>()
  for (const edge of bestEdgeByEndpoint.values()) {
    selected.set(edgeKey(edge.source, edge.target, edge.priority), edge)
  }

  if (selected.size > limit) {
    return Array.from(selected.values())
      .sort((left, right) => edgeWeight(right.weight) - edgeWeight(left.weight))
      .slice(0, limit)
  }

  const byWeight = [...resolvedEdges].sort((left, right) => edgeWeight(right.weight) - edgeWeight(left.weight))
  for (let index = 0; index < byWeight.length; index += 1) {
    if (selected.size >= limit) {
      break
    }
    const edge = byWeight[index]
    const key = edgeKey(edge.source, edge.target, edge.priority)
    if (!selected.has(key)) {
      selected.set(key, edge)
    }
  }

  return Array.from(selected.values())
}

const stripLayoutContent = (layout: Awaited<ReturnType<typeof getGraphLayout>>['layout']) => ({
  ...layout,
  nodes: layout.nodes.map(({ content, ...node }) => node)
})

const compactLayoutPayload = (layout: KnowledgeGraphLayout) => {
  const edgeLimit = compactGraphLayoutEdgeLimitFor(layout.nodes.length)
  const compactEdges = selectCompactEdges(layout, edgeLimit)
  const compactNodes = layout.nodes.map((node) => [node.id, node.title, node.x, node.y, node.group, node.segment] as const)
  const compactEdgeRows = compactEdges
    .map((edge) => [edge.source, edge.target, edge.weight, edge.priority] as const)

  return {
    compact: true as const,
    layout: {
      nodes: compactNodes,
      edges: compactEdgeRows
    },
    totals: {
      nodes: layout.nodes.length,
      edges: layout.edges.length
    }
  }
}

const encodeLayoutPayload = (layout: Awaited<ReturnType<typeof getGraphLayout>>['layout']) =>
  layout.nodes.length > compactGraphLayoutThreshold ? compactLayoutPayload(layout) : { compact: false as const, layout: stripLayoutContent(layout) }

export const route = async (request: IncomingMessage, url: URL, vaultPath: string) => {
  if (isReadMethod(request) && (url.pathname === '/' || url.pathname === '/index.html')) {
    return createResponse(createClientHtml(), 200, contentTypes['.html'])
  }

  if (isReadMethod(request) && url.pathname === '/styles.css') {
    return createResponse(createClientCss(), 200, contentTypes['.css'])
  }

  if (isReadMethod(request) && url.pathname === '/app.js') {
    return createResponse(createClientJs(), 200, contentTypes['.js'])
  }

  if (isReadMethod(request) && url.pathname === '/app-worker.js') {
    return createResponse(createClientWorkerJs(), 200, contentTypes['.js'])
  }

  if (isReadMethod(request) && url.pathname === '/api/graph') {
    return createResponse(createJsonResponse(await getGraph(vaultPath, readAgentQuery(url))), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/graph-layout') {
    const { signature, layout } = await getGraphLayout(vaultPath, readAgentQuery(url))
    const requestEtags = request.headers['if-none-match']
    const notModified = sameEntityTag(requestEtags, signature)
    const etag = encodeEntityTag(signature)
    const body = createJsonResponse({ signature, ...encodeLayoutPayload(layout) })
    const jsonResponse = createResponse(body, 200, contentTypes['.json'])
    const notModifiedResponse = createResponse('', 304, contentTypes['.json'])

    if (notModified) {
      return {
        ...notModifiedResponse,
        headers: {
          ...notModifiedResponse.headers,
          etag
        }
      }
    }

    return {
      ...jsonResponse,
      headers: {
        ...jsonResponse.headers,
        etag
      }
    }
  }

  if (isReadMethod(request) && url.pathname === '/api/graph-node') {
    const id = url.searchParams.get('id')?.trim() ?? ''

    if (!id) {
      return createResponse(createJsonResponse({ error: 'Missing id query parameter' }), 400, contentTypes['.json'])
    }

    const node = await getGraphNode(vaultPath, id, readAgentQuery(url))

    if (!node) {
      return createResponse(createJsonResponse({ error: 'Node not found' }), 404, contentTypes['.json'])
    }

    return createResponse(createJsonResponse({ node }), 200, contentTypes['.json'])
  }

  if (isReadMethod(request) && url.pathname === '/api/graph-filter') {
    const query = url.searchParams.get('q')?.trim() ?? ''
    const limit = parsePositiveInteger(url.searchParams.get('limit'), 1200)

    if (!query) {
      return createResponse(createJsonResponse({ query, nodeIds: [] }), 200, contentTypes['.json'])
    }

    const nodeIds = await searchGraphNodeIds(vaultPath, query, limit, readAgentQuery(url))

    return createResponse(createJsonResponse({ query, nodeIds }), 200, contentTypes['.json'])
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

  return createResponse('Not found', 404)
}
