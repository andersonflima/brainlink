import type { AgentSummary } from '../domain/types.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openFileIndex } from '../infrastructure/file-index.js'

export const listAgents = async (vaultPath: string): Promise<readonly AgentSummary[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openFileIndex(absoluteVaultPath)

  try {
    return await index.listAgents()
  } finally {
    index.close()
  }
}
