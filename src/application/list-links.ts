import type { GraphLink } from '../domain/types.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'
import { openFileIndex } from '../infrastructure/file-index.js'

export const listLinks = async (vaultPath: string, agentId?: string): Promise<readonly GraphLink[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openFileIndex(absoluteVaultPath)

  try {
    return await index.listLinks(agentId)
  } finally {
    index.close()
  }
}

export const listBacklinks = async (vaultPath: string, title: string, agentId?: string): Promise<readonly GraphLink[]> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const index = openFileIndex(absoluteVaultPath)

  try {
    return await index.listBacklinks(title, agentId)
  } finally {
    index.close()
  }
}
