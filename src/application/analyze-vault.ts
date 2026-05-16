import { validateGraph, getBrokenLinks, getOrphanNodes, getVaultStats } from '../domain/graph-analysis.js'
import type { BrokenLink, DoctorReport, OrphanNode, VaultStats, VaultValidation } from '../domain/types.js'
import { ensureVault, readMarkdownFiles } from '../infrastructure/file-system-vault.js'
import { getGraph } from './get-graph.js'

export const getStats = async (vaultPath: string, agentId?: string): Promise<VaultStats> =>
  getVaultStats(await getGraph(vaultPath, agentId))

export const getBrokenLinksReport = async (vaultPath: string, agentId?: string): Promise<readonly BrokenLink[]> =>
  getBrokenLinks(await getGraph(vaultPath, agentId))

export const getOrphansReport = async (vaultPath: string, agentId?: string): Promise<readonly OrphanNode[]> =>
  getOrphanNodes(await getGraph(vaultPath, agentId))

export const validateVault = async (vaultPath: string, agentId?: string): Promise<VaultValidation> =>
  validateGraph(await getGraph(vaultPath, agentId))

const createCheck = (name: string, ok: boolean, message: string) => ({
  name,
  ok,
  message
})

export const doctorVault = async (vaultPath: string): Promise<DoctorReport> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const files = await readMarkdownFiles(absoluteVaultPath)
  const graph = await getGraph(absoluteVaultPath)
  const validation = validateGraph(graph)
  const checks = [
    createCheck('vault', true, `Vault ready at ${absoluteVaultPath}`),
    createCheck('markdown-files', files.length > 0, `${files.length} markdown files found`),
    createCheck('index', graph.nodes.length > 0, `${graph.nodes.length} indexed documents found`),
    createCheck('broken-links', validation.brokenLinks.length === 0, `${validation.brokenLinks.length} broken links found`)
  ]
  const recommendations =
    files.length === 0 && graph.nodes.length === 0
      ? [
          `Vault is empty. Add your first note: blink add "Architecture" --vault "${absoluteVaultPath}" --content "Markdown source of truth. #architecture"`,
          `If this path is not the expected vault, inspect active config: blink config where`,
          `If you changed vault recently, migrate existing memory: blink migrate-vault --from ~/.brainlink/vault --to "${absoluteVaultPath}"`
        ]
      : []

  return {
    ok: checks.every((check) => check.ok),
    checks,
    ...(recommendations.length > 0 ? { recommendations } : {})
  }
}
