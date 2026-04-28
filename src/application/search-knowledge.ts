import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'
import { createEmbeddingProvider } from '../domain/embeddings.js'
import { loadBrainlinkConfig, sanitizeSearchMode } from '../infrastructure/config.js'
import type { SearchMode, SearchResult } from '../domain/types.js'

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
  const provider = createEmbeddingProvider(config.embeddingProvider)
  const shouldEmbedQuery = searchMode !== 'fts' && provider.name !== 'none'
  const queryEmbedding = shouldEmbedQuery ? (await provider.embed([query]))[0] ?? [] : []
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    return index.search(query, limit, agentId, searchMode, queryEmbedding)
  } finally {
    index.close()
  }
}
