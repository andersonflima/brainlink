import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { searchInPacks } from '../infrastructure/search-packs.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'
import { createEmbeddingProvider } from '../domain/embeddings.js'
import { loadBrainlinkConfig, sanitizeSearchMode } from '../infrastructure/config.js'
import type { SearchMode, SearchResult } from '../domain/types.js'

type HybridCacheEntry = {
  readonly key: string
  readonly createdAt: number
  readonly indexMtimeMs: number
  readonly results: readonly SearchResult[]
}

const hybridCacheTtlMs = 30_000
const hybridCacheMaxEntries = 200
const hybridSearchCache = new Map<string, HybridCacheEntry>()

const readIndexMtimeMs = async (vaultPath: string): Promise<number> => {
  try {
    return (await stat(join(vaultPath, '.brainlink', 'brainlink.db'))).mtimeMs
  } catch {
    return 0
  }
}

const toCacheKey = (vaultPath: string, query: string, limit: number, agentId: string | undefined): string =>
  JSON.stringify({
    vaultPath,
    query: query.trim().toLowerCase(),
    limit,
    agentId: agentId?.trim().toLowerCase() ?? '*'
  })

const cacheGet = (key: string, indexMtimeMs: number): readonly SearchResult[] | undefined => {
  const entry = hybridSearchCache.get(key)

  if (!entry) {
    return undefined
  }

  const fresh = Date.now() - entry.createdAt <= hybridCacheTtlMs && entry.indexMtimeMs === indexMtimeMs

  if (!fresh) {
    hybridSearchCache.delete(key)
    return undefined
  }

  return entry.results
}

const cacheSet = (entry: HybridCacheEntry): void => {
  hybridSearchCache.set(entry.key, entry)

  if (hybridSearchCache.size <= hybridCacheMaxEntries) {
    return
  }

  const overflow = hybridSearchCache.size - hybridCacheMaxEntries
  const keys = Array.from(hybridSearchCache.keys()).slice(0, overflow)

  keys.forEach((key) => hybridSearchCache.delete(key))
}

export const searchKnowledge = async (
  vaultPath: string,
  query: string,
  limit: number,
  agentId?: string,
  mode?: SearchMode
): Promise<readonly SearchResult[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const config = await loadBrainlinkConfig()
  const searchMode = sanitizeSearchMode(mode, config.defaultSearchMode)
  const cacheKey = searchMode === 'hybrid' ? toCacheKey(absoluteVaultPath, query, limit, agentId) : undefined
  const indexMtimeMs = cacheKey ? await readIndexMtimeMs(absoluteVaultPath) : 0
  const cached = cacheKey ? cacheGet(cacheKey, indexMtimeMs) : undefined

  if (cached) {
    return cached
  }

  const provider = createEmbeddingProvider(config.embeddingProvider)
  const shouldEmbedQuery = searchMode !== 'fts' && provider.name !== 'none'
  const queryEmbedding = shouldEmbedQuery ? (await provider.embed([query]))[0] ?? [] : []
  try {
    const index = openSqliteIndex(absoluteVaultPath)

    try {
      const results = index.search(query, limit, agentId, searchMode, queryEmbedding)

      if (cacheKey) {
        cacheSet({
          key: cacheKey,
          createdAt: Date.now(),
          indexMtimeMs,
          results
        })
      }

      return results
    } finally {
      index.close()
    }
  } catch {
    const fallbackResults = await searchInPacks(absoluteVaultPath, query, limit, agentId)

    if (cacheKey) {
      cacheSet({
        key: cacheKey,
        createdAt: Date.now(),
        indexMtimeMs,
        results: fallbackResults
      })
    }

    return fallbackResults
  }
}
