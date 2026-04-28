#!/usr/bin/env node
import { Command } from 'commander'
import { basename } from 'node:path'
import { addNote } from '../application/add-note.js'
import { doctorVault, getBrokenLinksReport, getOrphansReport, getStats, validateVault } from '../application/analyze-vault.js'
import { buildContextPackage } from '../application/build-context.js'
import { getGraph } from '../application/get-graph.js'
import { indexVault } from '../application/index-vault.js'
import { listAgents } from '../application/list-agents.js'
import { listBacklinks, listLinks } from '../application/list-links.js'
import { searchKnowledge } from '../application/search-knowledge.js'
import { startMcpServer } from '../application/start-mcp-server.js'
import { startServer } from '../application/start-server.js'
import { startVaultWatcher } from '../application/watch-vault.js'
import { loadBrainlinkConfig, sanitizeSearchMode } from '../infrastructure/config.js'
import { ensureVault } from '../infrastructure/file-system-vault.js'

type VaultOptions = {
  readonly vault?: string
  readonly agent?: string
  readonly json?: boolean
}

type SearchOptions = VaultOptions & {
  readonly limit?: string
  readonly mode?: string
}

type ContextOptions = SearchOptions & {
  readonly tokens?: string
}

type ServerOptions = VaultOptions & {
  readonly host?: string
  readonly port?: string
  readonly index: boolean
  readonly watch?: boolean
}

const parsePositiveInteger = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const resolveOptions = async (options: VaultOptions) => {
  const config = await loadBrainlinkConfig()

  return {
    config,
    vault: options.vault ?? config.vault
  }
}

const print = (json: boolean | undefined, value: unknown, human: () => string): void => {
  console.log(json ? JSON.stringify(value, null, 2) : human())
}

const program = new Command()
const cliName = basename(process.argv[1] ?? 'brainlink')
const displayName = cliName === 'blink' ? 'blink' : 'brainlink'
const aliasName = displayName === 'blink' ? 'brainlink' : 'blink'

program
  .name(displayName)
  .alias(aliasName)
  .description('Local-first knowledge memory for agents')
  .version('0.1.0')

program
  .command('init')
  .argument('[vault]', 'vault directory', '.')
  .option('--json', 'print machine-readable JSON')
  .description('initialize a Brainlink vault')
  .action(async (vault: string, options: { readonly json?: boolean }) => {
    const path = await ensureVault(vault)

    print(options.json, { path }, () => `Initialized Brainlink vault at ${path}`)
  })

program
  .command('add')
  .argument('<title>', 'note title')
  .requiredOption('-c, --content <content>', 'markdown content')
  .option('-v, --vault <vault>', 'vault directory', '.')
  .option('-a, --agent <agent>', 'agent memory namespace', 'shared')
  .option('--json', 'print machine-readable JSON')
  .description('add a markdown note to the vault')
  .action(async (title: string, options: VaultOptions & { readonly content: string }) => {
    const resolved = await resolveOptions(options)
    const path = await addNote(resolved.vault, title, options.content, options.agent)

    print(options.json, { title, agent: options.agent ?? 'shared', path }, () => `Created note at ${path}`)
  })

program
  .command('index')
  .option('-v, --vault <vault>', 'vault directory', '.')
  .option('--json', 'print machine-readable JSON')
  .description('index markdown notes, links, tags and chunks')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const result = await indexVault(resolved.vault)

    print(
      options.json,
      result,
      () => `Indexed ${result.documentCount} documents, ${result.chunkCount} chunks and ${result.linkCount} links`
    )
  })

program
  .command('search')
  .argument('<query>', 'search query')
  .option('-v, --vault <vault>', 'vault directory', '.')
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
  .option('-v, --vault <vault>', 'vault directory', '.')
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
  .option('-v, --vault <vault>', 'vault directory', '.')
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
  .option('-v, --vault <vault>', 'vault directory', '.')
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
  .option('-v, --vault <vault>', 'vault directory', '.')
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
  .option('-v, --vault <vault>', 'vault directory', '.')
  .option('--json', 'print machine-readable JSON')
  .description('list indexed agent memory namespaces')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const agents = await listAgents(resolved.vault)

    print(options.json, { agents }, () => agents.map((agent) => `${agent.id}: ${agent.documentCount} documents`).join('\n'))
  })

program
  .command('stats')
  .option('-v, --vault <vault>', 'vault directory', '.')
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
  .option('-v, --vault <vault>', 'vault directory', '.')
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
  .option('-v, --vault <vault>', 'vault directory', '.')
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
  .option('-v, --vault <vault>', 'vault directory', '.')
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

program
  .command('doctor')
  .option('-v, --vault <vault>', 'vault directory', '.')
  .option('--json', 'print machine-readable JSON')
  .description('run Brainlink environment and vault checks')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const report = await doctorVault(resolved.vault)

    print(options.json, report, () =>
      report.checks.map((check) => `${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.message}`).join('\n')
    )
    process.exitCode = report.ok ? 0 : 1
  })

program
  .command('watch')
  .option('-v, --vault <vault>', 'vault directory', '.')
  .option('--json', 'print machine-readable JSON events')
  .description('watch markdown files and reindex on changes')
  .action(async (options: VaultOptions) => {
    const resolved = await resolveOptions(options)
    const initial = await indexVault(resolved.vault)
    const watcher = startVaultWatcher({
      vaultPath: resolved.vault,
      onIndex: (result) => {
        print(options.json, { event: 'indexed', result }, () =>
          `Indexed ${result.documentCount} documents, ${result.chunkCount} chunks and ${result.linkCount} links`
        )
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error)
        print(options.json, { event: 'error', message }, () => message)
      }
    })

    print(options.json, { event: 'watching', vault: resolved.vault, initial }, () => `Watching ${resolved.vault}`)

    process.once('SIGINT', () => {
      watcher.close()
      process.exit(0)
    })
    process.once('SIGTERM', () => {
      watcher.close()
      process.exit(0)
    })
  })

program
  .command('mcp')
  .description('start the Brainlink MCP server over stdio')
  .action(async () => {
    await startMcpServer()
  })

program
  .command('server')
  .option('-v, --vault <vault>', 'vault directory', '.')
  .option('-h, --host <host>', 'server host', '127.0.0.1')
  .option('-p, --port <port>', 'server port', '4321')
  .option('--no-index', 'skip indexing before starting the server')
  .option('-w, --watch', 'watch markdown files and reindex on changes')
  .option('--json', 'print machine-readable JSON')
  .description('start a local web UI for the knowledge graph')
  .action(async (options: ServerOptions) => {
    const resolved = await resolveOptions(options)
    const server = await startServer({
      vaultPath: resolved.vault,
      host: options.host ?? resolved.config.host,
      port: parsePositiveInteger(options.port ?? String(resolved.config.port), resolved.config.port),
      shouldIndex: options.index,
      shouldWatch: Boolean(options.watch)
    })

    print(options.json, { url: server.url, watch: Boolean(options.watch) }, () => `Brainlink graph server running at ${server.url}`)
  })

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  console.error(message)
  process.exitCode = 1
})
