import type { GraphNode } from '../domain/types.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'

export const getGraphNode = async (vaultPath: string, id: string, agentId?: string): Promise<GraphNode | undefined> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    return index.getGraphNode(id, agentId)
  } finally {
    index.close()
  }
}

