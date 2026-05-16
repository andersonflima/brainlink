import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'

export const searchGraphNodeIds = async (
  vaultPath: string,
  query: string,
  limit: number,
  agentId?: string
): Promise<readonly string[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    return index.searchGraphNodeIds(query, limit, agentId)
  } finally {
    index.close()
  }
}

