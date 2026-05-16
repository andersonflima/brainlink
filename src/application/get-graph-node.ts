import type { GraphNode } from '../domain/types.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openFileIndex } from '../infrastructure/file-index.js'

export const getGraphNode = async (vaultPath: string, id: string, agentId?: string): Promise<GraphNode | undefined> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openFileIndex(absoluteVaultPath)

  try {
    return await index.getGraphNode(id, agentId)
  } finally {
    index.close()
  }
}
