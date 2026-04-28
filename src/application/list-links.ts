import type { GraphLink } from '../domain/types.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'

export const listLinks = async (vaultPath: string, agentId?: string): Promise<readonly GraphLink[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    return index.listLinks(agentId)
  } finally {
    index.close()
  }
}

export const listBacklinks = async (vaultPath: string, title: string, agentId?: string): Promise<readonly GraphLink[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    return index.listBacklinks(title, agentId)
  } finally {
    index.close()
  }
}
