import type { AgentSummary } from '../domain/types.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'

export const listAgents = async (vaultPath: string): Promise<readonly AgentSummary[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    return index.listAgents()
  } finally {
    index.close()
  }
}
