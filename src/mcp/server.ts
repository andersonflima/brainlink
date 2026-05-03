import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addNoteInputSchema,
  addNoteTool,
  brokenLinksInputSchema,
  brokenLinksTool,
  contextInputSchema,
  contextTool,
  graphInputSchema,
  graphTool,
  indexInputSchema,
  indexTool,
  orphansInputSchema,
  orphansTool,
  searchInputSchema,
  searchTool,
  statsInputSchema,
  statsTool,
  syncInputSchema,
  syncTool,
  validateInputSchema,
  validateTool
} from './tools.js'

type PackageMetadata = {
  readonly version?: string
}

const readPackageVersion = (): string => {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), '../../package.json')
  const metadata = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageMetadata

  return metadata.version ?? '0.0.0'
}

export const createBrainlinkMcpServer = (): McpServer => {
  const server = new McpServer({
    name: 'brainlink',
    title: 'Brainlink',
    version: readPackageVersion(),
    description: 'Local-first Markdown memory tools for AI agents.'
  })

  server.registerTool(
    'brainlink_context',
    {
      title: 'Build Brainlink Context',
      description: 'Read indexed Brainlink memory for a task or question. This is read-only and does not create graph links.',
      inputSchema: contextInputSchema
    },
    contextTool
  )

  server.registerTool(
    'brainlink_search',
    {
      title: 'Search Brainlink Memory',
      description: 'Search indexed Brainlink notes with FTS, semantic or hybrid retrieval.',
      inputSchema: searchInputSchema
    },
    searchTool
  )

  server.registerTool(
    'brainlink_add_note',
    {
      title: 'Add Brainlink Note',
      description: 'Write durable Markdown memory, then reindex the vault. Include explicit [[wiki links]] for connected graph memory. Add priority markers near links, such as priority: high, #important or #critical, when a relationship should be weighted higher.',
      inputSchema: addNoteInputSchema
    },
    addNoteTool
  )

  server.registerTool(
    'brainlink_index',
    {
      title: 'Index Brainlink Vault',
      description: 'Rebuild the local Brainlink index from Markdown notes.',
      inputSchema: indexInputSchema
    },
    indexTool
  )

  server.registerTool(
    'brainlink_stats',
    {
      title: 'Get Brainlink Vault Stats',
      description: 'Read indexed vault statistics, including node, edge and tag totals.',
      inputSchema: statsInputSchema
    },
    statsTool
  )

  server.registerTool(
    'brainlink_validate',
    {
      title: 'Validate Brainlink Vault',
      description: 'Validate indexed graph health, including broken links and orphan notes.',
      inputSchema: validateInputSchema
    },
    validateTool
  )

  server.registerTool(
    'brainlink_sync',
    {
      title: 'Run Brainlink Sync Flow',
      description: 'Run index, stats, validate, broken-links and orphans checks in one call. Optionally run context probe.',
      inputSchema: syncInputSchema
    },
    syncTool
  )

  server.registerTool(
    'brainlink_graph',
    {
      title: 'Read Brainlink Graph',
      description: 'Read indexed graph nodes and wiki-link edges. Edges include weight and priority fields so agents can rank importance and priority.',
      inputSchema: graphInputSchema
    },
    graphTool
  )

  server.registerTool(
    'brainlink_broken_links',
    {
      title: 'List Brainlink Broken Links',
      description: 'List unresolved indexed wiki links.',
      inputSchema: brokenLinksInputSchema
    },
    brokenLinksTool
  )

  server.registerTool(
    'brainlink_orphans',
    {
      title: 'List Brainlink Orphans',
      description: 'List indexed notes without incoming or outgoing graph links.',
      inputSchema: orphansInputSchema
    },
    orphansTool
  )

  return server
}
