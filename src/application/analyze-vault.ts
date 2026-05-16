import { stat } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { validateGraph, getBrokenLinks, getOrphanNodes, getVaultStats } from '../domain/graph-analysis.js'
import type { BrokenLink, DoctorReport, LinkPriority, OrphanNode, VaultExtendedStats, VaultStats, VaultValidation } from '../domain/types.js'
import { ensureVault, listVaultFiles, readMarkdownFiles } from '../infrastructure/file-system-vault.js'
import { resolveAgentRuntimeDefaults } from '../infrastructure/config.js'
import { getGraphSummary } from './get-graph-summary.js'
import { buildContextPackage } from './build-context.js'
import { indexVault } from './index-vault.js'
import { searchKnowledge } from './search-knowledge.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'

export const getStats = async (vaultPath: string, agentId?: string): Promise<VaultStats> =>
  getVaultStats(await getGraphSummary(vaultPath, agentId))

export const getBrokenLinksReport = async (vaultPath: string, agentId?: string): Promise<readonly BrokenLink[]> =>
  getBrokenLinks(await getGraphSummary(vaultPath, agentId))

export const getOrphansReport = async (vaultPath: string, agentId?: string): Promise<readonly OrphanNode[]> =>
  getOrphanNodes(await getGraphSummary(vaultPath, agentId))

export const validateVault = async (vaultPath: string, agentId?: string): Promise<VaultValidation> =>
  validateGraph(await getGraphSummary(vaultPath, agentId))

const toRatio = (part: number, total: number): number =>
  total === 0 ? 0 : Number((part / total).toFixed(4))

export const getExtendedStats = async (vaultPath: string, agentId?: string): Promise<VaultExtendedStats> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const graph = await getGraphSummary(absoluteVaultPath, agentId)
  const stats = getVaultStats(graph)
  const markdownFiles = await readMarkdownFiles(absoluteVaultPath)
  const allFiles = await listVaultFiles(absoluteVaultPath)
  const totalBytes = (
    await Promise.all(
      allFiles.map(async (filePath) => {
        try {
          return (await stat(filePath)).size
        } catch {
          return 0
        }
      })
    )
  ).reduce((sum, value) => sum + value, 0)
  const updatedAt = markdownFiles
    .map((file) => file.updatedAt.getTime())
    .filter((time) => Number.isFinite(time))
    .sort((left, right) => left - right)
  const priorities = graph.edges.reduce<Record<LinkPriority, number>>(
    (state, edge) => ({
      ...state,
      [edge.priority]: state[edge.priority] + 1
    }),
    {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0
    }
  )
  const config = await loadBrainlinkConfig()
  const defaults = resolveAgentRuntimeDefaults(config, agentId)
  const probeQuery = graph.nodes[0]?.title ?? 'architecture'
  const indexStart = performance.now()
  await indexVault(absoluteVaultPath)
  const indexLatency = performance.now() - indexStart
  const searchStart = performance.now()
  await searchKnowledge(absoluteVaultPath, probeQuery, Math.min(defaults.defaultSearchLimit, 8), agentId, 'hybrid')
  const searchLatency = performance.now() - searchStart
  const contextStart = performance.now()
  await buildContextPackage(
    absoluteVaultPath,
    probeQuery,
    Math.min(defaults.defaultSearchLimit, 8),
    defaults.defaultContextTokens,
    agentId,
    'hybrid'
  )
  const contextLatency = performance.now() - contextStart

  return {
    stats,
    storage: {
      markdownFileCount: markdownFiles.length,
      totalFileCount: allFiles.length,
      totalBytes,
      averageMarkdownBytes:
        markdownFiles.length === 0
          ? 0
          : Math.round(markdownFiles.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0) / markdownFiles.length),
      ...(updatedAt.length > 0
        ? {
            oldestNoteUpdatedAt: new Date(updatedAt[0]).toISOString(),
            newestNoteUpdatedAt: new Date(updatedAt[updatedAt.length - 1]).toISOString()
          }
        : {})
    },
    quality: {
      resolvedLinkRatio: toRatio(stats.resolvedLinkCount, stats.linkCount),
      brokenLinkRatio: toRatio(stats.brokenLinkCount, stats.linkCount),
      orphanRatio: toRatio(stats.orphanCount, Math.max(stats.documentCount, 1)),
      priorityDistribution: priorities
    },
    observability: {
      probeQuery,
      latenciesMs: {
        index: Number(indexLatency.toFixed(2)),
        search: Number(searchLatency.toFixed(2)),
        context: Number(contextLatency.toFixed(2))
      }
    }
  }
}

const createCheck = (name: string, ok: boolean, message: string) => ({
  name,
  ok,
  message
})

export const doctorVault = async (vaultPath: string): Promise<DoctorReport> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const files = await readMarkdownFiles(absoluteVaultPath)
  const graph = await getGraphSummary(absoluteVaultPath)
  const validation = validateGraph(graph)
  const backupPath = join(absoluteVaultPath, '.brainlink', 'brainlink.db.backup')
  const snapshotDirectory = join(absoluteVaultPath, '.brainlink', 'brainlink.db.backup.snapshots')
  const hasBackup = existsSync(backupPath)
  const snapshotCount = existsSync(snapshotDirectory)
    ? readdirSync(snapshotDirectory).filter((name) => name.endsWith('.db')).length
    : 0
  const backupReady = graph.nodes.length === 0 || hasBackup
  const checks = [
    createCheck('vault', true, `Vault ready at ${absoluteVaultPath}`),
    createCheck('markdown-files', files.length > 0, `${files.length} markdown files found`),
    createCheck('index', graph.nodes.length > 0, `${graph.nodes.length} indexed documents found`),
    createCheck('broken-links', validation.brokenLinks.length === 0, `${validation.brokenLinks.length} broken links found`),
    createCheck(
      'index-backup',
      backupReady,
      backupReady
        ? (hasBackup
          ? `SQLite recovery snapshot is available (${snapshotCount} rotating snapshots)`
          : 'No index yet. Snapshot will be created after first indexing run')
        : 'Recovery snapshot missing. Run blink index to create a rollback snapshot'
    )
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
