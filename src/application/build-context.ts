import { stat } from 'node:fs/promises'
import { formatContextPackage, selectContextSections } from '../domain/context.js'
import type { ContextPackage, SearchMode } from '../domain/types.js'
import { indexStoragePath } from '../infrastructure/file-index.js'
import { searchKnowledge } from './search-knowledge.js'

type ContextCacheEntry = {
  readonly key: string
  readonly createdAt: number
  readonly indexMtimeMs: number
  readonly context: ContextPackage
}

const contextCacheTtlMs = 45_000
const contextCacheMaxEntries = 200
const contextCache = new Map<string, ContextCacheEntry>()

const readIndexMtimeMs = async (vaultPath: string): Promise<number> => {
  try {
    return (await stat(indexStoragePath(vaultPath))).mtimeMs
  } catch {
    return 0
  }
}

const toCacheKey = (
  vaultPath: string,
  query: string,
  limit: number,
  maxTokens: number,
  agentId: string | undefined,
  mode: SearchMode | undefined
): string =>
  JSON.stringify({
    vaultPath,
    query: query.trim().toLowerCase(),
    limit,
    maxTokens,
    agentId: agentId?.trim().toLowerCase() ?? '*',
    mode: mode ?? 'default'
  })

const contextCacheGet = (key: string, indexMtimeMs: number): ContextPackage | undefined => {
  const entry = contextCache.get(key)
  if (!entry) {
    return undefined
  }

  const fresh = Date.now() - entry.createdAt <= contextCacheTtlMs && entry.indexMtimeMs === indexMtimeMs
  if (!fresh) {
    contextCache.delete(key)
    return undefined
  }

  return entry.context
}

const contextCacheSet = (entry: ContextCacheEntry): void => {
  contextCache.set(entry.key, entry)
  if (contextCache.size <= contextCacheMaxEntries) {
    return
  }

  const overflow = contextCache.size - contextCacheMaxEntries
  const keys = Array.from(contextCache.keys()).slice(0, overflow)
  keys.forEach((key) => contextCache.delete(key))
}

export const buildContextPackage = async (
  vaultPath: string,
  query: string,
  limit: number,
  maxTokens: number,
  agentId?: string,
  mode?: SearchMode
): Promise<ContextPackage> => {
  const cacheKey = toCacheKey(vaultPath, query, limit, maxTokens, agentId, mode)
  const indexMtimeMs = await readIndexMtimeMs(vaultPath)
  const cached = contextCacheGet(cacheKey, indexMtimeMs)
  if (cached) {
    return cached
  }

  const results = await searchKnowledge(vaultPath, query, limit, agentId, mode)
  const sections = selectContextSections(results, maxTokens)
  const context = {
    query,
    sections,
    content: formatContextPackage(query, sections)
  }
  contextCacheSet({
    key: cacheKey,
    createdAt: Date.now(),
    indexMtimeMs,
    context
  })

  return context
}

export const buildContext = async (
  vaultPath: string,
  query: string,
  limit: number,
  maxTokens: number,
  agentId?: string,
  mode?: SearchMode
): Promise<string> => {
  const contextPackage = await buildContextPackage(vaultPath, query, limit, maxTokens, agentId, mode)

  return contextPackage.content
}
