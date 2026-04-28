import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'
import type { SearchResult } from '../domain/types.js'

export const searchKnowledge = async (
  vaultPath: string,
  query: string,
  limit: number,
  agentId?: string
): Promise<readonly SearchResult[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    return index.search(query, limit, agentId)
  } finally {
    index.close()
  }
}
