import type { IncomingMessage } from 'node:http'
import { getBrokenLinksReport, getOrphansReport, getStats, validateVault } from '../analyze-vault.js'
import { buildContextPackage } from '../build-context.js'
import { getGraph } from '../get-graph.js'
import { getGraphLayout } from '../get-graph-layout.js'
import { listAgents } from '../list-agents.js'
import { listBacklinks, listLinks } from '../list-links.js'
import { searchKnowledge } from '../search-knowledge.js'
import { loadBrainlinkConfig, sanitizeSearchMode } from '../../infrastructure/config.js'
import { createClientCss } from './client-css.js'
import { createClientHtml } from './client-html.js'
import { createClientJs } from './client-js.js'
import { contentTypes, createJsonResponse, isReadMethod, parsePositiveInteger } from './http.js'
import type { HttpResponse } from './types.js'

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

const readAgentQuery = (url: URL): string | undefined =>
  url.searchParams.get('agent') ?? undefined

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

  return createResponse('Not found', 404)
}
