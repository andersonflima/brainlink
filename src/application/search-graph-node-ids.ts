import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openFileIndex } from '../infrastructure/file-index.js'

export const searchGraphNodeIds = async (
  vaultPath: string,
  query: string,
  limit: number,
  agentId?: string
): Promise<readonly string[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openFileIndex(absoluteVaultPath)

  try {
    return await index.searchGraphNodeIds(query, limit, agentId)
  } finally {
    index.close()
  }
}
