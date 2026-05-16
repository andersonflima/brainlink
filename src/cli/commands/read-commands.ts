import type { Command } from 'commander'
import { getBrokenLinksReport, getExtendedStats, getOrphansReport, getStats, validateVault } from '../../application/analyze-vault.js'
import { buildContextPackage } from '../../application/build-context.js'
import { getGraph } from '../../application/get-graph.js'
import { listAgents } from '../../application/list-agents.js'
import { listBacklinks, listLinks } from '../../application/list-links.js'
import { searchKnowledge } from '../../application/search-knowledge.js'
import { sanitizeSearchMode } from '../../infrastructure/config.js'
import { parsePositiveInteger, print, resolveOptions } from '../runtime.js'
import type { ContextOptions, SearchOptions, StatsOptions, VaultOptions } from '../types.js'

export const registerReadCommands = (program: Command): void => {
  program
    .command('search')
  .argument('<query>', 'search query')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('-l, --limit <limit>', 'maximum results')
  .option('-m, --mode <mode>', 'search mode: fts, semantic or hybrid')
  .option('--json', 'print machine-readable JSON')
  .description('search indexed knowledge')
  .action(async (query: string, options: SearchOptions) => {
    const resolved = await resolveOptions(options)
    const limit = parsePositiveInteger(options.limit ?? String(resolved.defaults.defaultSearchLimit), resolved.defaults.defaultSearchLimit)
    const mode = sanitizeSearchMode(options.mode, resolved.defaults.defaultSearchMode)
    const results = await searchKnowledge(resolved.vault, query, limit, resolved.agent, mode)

    print(options.json, { query, agent: resolved.agent, limit, mode, results }, () =>
      results
        .map((result, index) =>
          [`${index + 1}. ${result.title} (${result.path}) score=${result.score.toFixed(3)} mode=${result.searchMode}`, result.content].join('\n')
        )
        .join('\n\n')
    )
  })

  program
    .command('links')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('--json', 'print machine-readable JSON')
  .description('list indexed wiki links')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const links = await listLinks(resolved.vault, resolved.agent)

    print(options.json, { links }, () =>
      links
        .map((link) => {
          const target = link.toPath ? `${link.toTitle} (${link.toPath})` : `${link.toTitle} (unresolved)`

          return `${link.fromTitle} (${link.fromPath}) -> ${target}`
        })
        .join('\n')
    )
  })

  program
    .command('backlinks')
  .argument('<title>', 'target note title')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('--json', 'print machine-readable JSON')
  .description('list notes linking to a target note')
  .action(async (title: string, options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const backlinks = await listBacklinks(resolved.vault, title, resolved.agent)

    print(options.json, { title, backlinks }, () =>
      backlinks.map((link) => `${link.fromTitle} (${link.fromPath}) -> ${link.toTitle}`).join('\n')
    )
  })

  program
    .command('context')
  .argument('<query>', 'context query')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('-l, --limit <limit>', 'maximum search results before context selection')
  .option('-t, --tokens <tokens>', 'maximum estimated context tokens')
  .option('-m, --mode <mode>', 'search mode: fts, semantic or hybrid')
  .option('--json', 'print machine-readable JSON')
  .description('build a compact context package for an agent')
  .action(async (query: string, options: ContextOptions) => {
    const resolved = await resolveOptions(options)
    const mode = sanitizeSearchMode(options.mode, resolved.defaults.defaultSearchMode)
    const contextPackage = await buildContextPackage(
      resolved.vault,
      query,
      parsePositiveInteger(options.limit ?? String(resolved.defaults.defaultSearchLimit), resolved.defaults.defaultSearchLimit),
      parsePositiveInteger(options.tokens ?? String(resolved.defaults.defaultContextTokens), resolved.defaults.defaultContextTokens),
      resolved.agent,
      mode
    )

    print(options.json, contextPackage, () => contextPackage.content)
  })

  program
    .command('graph')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('--json', 'print machine-readable JSON')
  .description('print indexed graph data')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const graph = await getGraph(resolved.vault, resolved.agent)

    print(options.json, graph, () => JSON.stringify(graph, null, 2))
  })

  program
    .command('agents')
  .option('-v, --vault <vault>', 'vault directory')
  .option('--json', 'print machine-readable JSON')
  .description('list indexed agent memory namespaces')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const agents = await listAgents(resolved.vault)

    print(options.json, { agents }, () => agents.map((agent) => `${agent.id}: ${agent.documentCount} documents`).join('\n'))
  })

  program
    .command('stats')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('--extended', 'include storage, quality and latency observability probes')
  .option('--json', 'print machine-readable JSON')
  .description('print indexed vault statistics')
  .action(async (options: StatsOptions) => {
    const resolved = await resolveOptions(options)

    if (options.extended) {
      const stats = await getExtendedStats(resolved.vault, resolved.agent)

      print(options.json, stats, () =>
        [
          `Documents: ${stats.stats.documentCount}`,
          `Links: ${stats.stats.linkCount}`,
          `Resolved links: ${stats.stats.resolvedLinkCount}`,
          `Broken links: ${stats.stats.brokenLinkCount}`,
          `Orphans: ${stats.stats.orphanCount}`,
          `Tags: ${stats.stats.tagCount}`,
          `Total files: ${stats.storage.totalFileCount}`,
          `Markdown files: ${stats.storage.markdownFileCount}`,
          `Vault bytes: ${stats.storage.totalBytes}`,
          `Latency index/search/context (ms): ${stats.observability.latenciesMs.index}/${stats.observability.latenciesMs.search}/${stats.observability.latenciesMs.context}`
        ].join('\n')
      )
      return
    }

    const stats = await getStats(resolved.vault, resolved.agent)

    print(options.json, stats, () =>
      [
        `Documents: ${stats.documentCount}`,
        `Links: ${stats.linkCount}`,
        `Resolved links: ${stats.resolvedLinkCount}`,
        `Broken links: ${stats.brokenLinkCount}`,
        `Orphans: ${stats.orphanCount}`,
        `Tags: ${stats.tagCount}`
      ].join('\n')
    )
  })

  program
    .command('broken-links')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('--json', 'print machine-readable JSON')
  .description('list unresolved wiki links')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const brokenLinks = await getBrokenLinksReport(resolved.vault, resolved.agent)

    print(options.json, { brokenLinks }, () =>
      brokenLinks.length === 0
        ? 'No broken links found'
        : brokenLinks.map((link) => `${link.fromTitle} (${link.fromPath}) -> ${link.toTitle}`).join('\n')
    )
  })

  program
    .command('orphans')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('--json', 'print machine-readable JSON')
  .description('list indexed notes without incoming or outgoing links')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const orphans = await getOrphansReport(resolved.vault, resolved.agent)

    print(options.json, { orphans }, () =>
      orphans.length === 0 ? 'No orphan notes found' : orphans.map((node) => `${node.title} (${node.path})`).join('\n')
    )
  })

  program
    .command('validate')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('--json', 'print machine-readable JSON')
  .description('validate indexed vault graph health')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const validation = await validateVault(resolved.vault, resolved.agent)

    print(options.json, validation, () =>
      validation.ok
        ? 'Vault validation passed'
        : `Vault validation failed: ${validation.brokenLinks.length} broken links, ${validation.orphans.length} orphan notes`
    )
    process.exitCode = validation.ok ? 0 : 1
  })

}
