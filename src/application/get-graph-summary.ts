import type { KnowledgeGraph } from '../domain/types.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'

export const getGraphSummary = async (vaultPath: string, agentId?: string): Promise<KnowledgeGraph> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    return index.getGraphSummary(agentId)
  } finally {
    index.close()
  }
}

