import type { Command } from 'commander'
import { getBrokenLinksReport, getOrphansReport, getStats, validateVault } from '../../application/analyze-vault.js'
import { buildContextPackage } from '../../application/build-context.js'
import { getGraph } from '../../application/get-graph.js'
import { listAgents } from '../../application/list-agents.js'
import { listBacklinks, listLinks } from '../../application/list-links.js'
import { searchKnowledge } from '../../application/search-knowledge.js'
import { sanitizeSearchMode } from '../../infrastructure/config.js'
import { parsePositiveInteger, print, resolveOptions } from '../runtime.js'
import type { ContextOptions, SearchOptions, VaultOptions } from '../types.js'

export const registerReadCommands = (program: Command): void => {
  program
    .command('search')
  .argument('<query>', 'search query')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('-l, --limit <limit>', 'maximum results', '10')
  .option('-m, --mode <mode>', 'search mode: fts, semantic or hybrid')
  .option('--json', 'print machine-readable JSON')
  .description('search indexed knowledge')
  .action(async (query: string, options: SearchOptions) => {
    const resolved = await resolveOptions(options)
    const limit = parsePositiveInteger(options.limit ?? String(resolved.config.defaultSearchLimit), resolved.config.defaultSearchLimit)
    const mode = sanitizeSearchMode(options.mode, resolved.config.defaultSearchMode)
    const results = await searchKnowledge(resolved.vault, query, limit, options.agent, mode)

    print(options.json, { query, agent: options.agent, limit, mode, results }, () =>
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
    const links = await listLinks(resolved.vault, options.agent)

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
    const backlinks = await listBacklinks(resolved.vault, title, options.agent)

    print(options.json, { title, backlinks }, () =>
      backlinks.map((link) => `${link.fromTitle} (${link.fromPath}) -> ${link.toTitle}`).join('\n')
    )
  })

  program
    .command('context')
  .argument('<query>', 'context query')
  .option('-v, --vault <vault>', 'vault directory')
  .option('-a, --agent <agent>', 'filter by agent memory namespace')
  .option('-l, --limit <limit>', 'maximum search results before context selection', '12')
  .option('-t, --tokens <tokens>', 'maximum estimated context tokens', '2000')
  .option('-m, --mode <mode>', 'search mode: fts, semantic or hybrid')
  .option('--json', 'print machine-readable JSON')
  .description('build a compact context package for an agent')
  .action(async (query: string, options: ContextOptions) => {
    const resolved = await resolveOptions(options)
    const mode = sanitizeSearchMode(options.mode, resolved.config.defaultSearchMode)
    const contextPackage = await buildContextPackage(
      resolved.vault,
      query,
      parsePositiveInteger(options.limit ?? '12', 12),
      parsePositiveInteger(options.tokens ?? String(resolved.config.defaultContextTokens), resolved.config.defaultContextTokens),
      options.agent,
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
    const graph = await getGraph(resolved.vault, options.agent)

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
  .option('--json', 'print machine-readable JSON')
  .description('print indexed vault statistics')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const stats = await getStats(resolved.vault, options.agent)

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
    const brokenLinks = await getBrokenLinksReport(resolved.vault, options.agent)

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
    const orphans = await getOrphansReport(resolved.vault, options.agent)

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
    const validation = await validateVault(resolved.vault, options.agent)

    print(options.json, validation, () =>
      validation.ok
        ? 'Vault validation passed'
        : `Vault validation failed: ${validation.brokenLinks.length} broken links, ${validation.orphans.length} orphan notes`
    )
    process.exitCode = validation.ok ? 0 : 1
  })

}
