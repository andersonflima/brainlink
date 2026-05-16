import type { KnowledgeGraph } from '../domain/types.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openFileIndex } from '../infrastructure/file-index.js'

export const getGraphSummary = async (vaultPath: string, agentId?: string): Promise<KnowledgeGraph> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openFileIndex(absoluteVaultPath)

  try {
    return await index.getGraphSummary(agentId)
  } finally {
    index.close()
  }
}
