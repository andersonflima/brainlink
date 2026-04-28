import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { addNote } from './add-note.js'
import { getBrokenLinksReport, getOrphansReport, getStats, validateVault } from './analyze-vault.js'
import { buildContextPackage } from './build-context.js'
import { getGraph } from './get-graph.js'
import { indexVault } from './index-vault.js'
import { listAgents } from './list-agents.js'
import { listBacklinks, listLinks } from './list-links.js'
import { searchKnowledge } from './search-knowledge.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'

const toToolText = (value: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(value, null, 2)
    }
  ]
})

const resolveVault = async (vault?: string): Promise<string> => {
  const config = await loadBrainlinkConfig()

  return vault ?? config.vault
}

export const startMcpServer = async (): Promise<void> => {
  const server = new McpServer({
    name: 'brainlink',
    version: '0.1.0'
  })

  server.registerTool(
    'brainlink_index',
    {
      title: 'Index Brainlink Vault',
      description: 'Rebuild the Brainlink index from Markdown notes.',
      inputSchema: {
        vault: z.string().optional()
      }
    },
    async ({ vault }) => toToolText(await indexVault(await resolveVault(vault)))
  )

  server.registerTool(
    'brainlink_add_note',
    {
      title: 'Add Brainlink Note',
      description: 'Create a Markdown note in a Brainlink vault and rebuild the index.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional(),
        title: z.string().min(1),
        content: z.string().min(1)
      }
    },
    async ({ vault, agent, title, content }) => {
      const resolvedVault = await resolveVault(vault)
      const path = await addNote(resolvedVault, title, content, agent)
      const index = await indexVault(resolvedVault)

      return toToolText({ title, agent, path, index })
    }
  )

  server.registerTool(
    'brainlink_agents',
    {
      title: 'List Brainlink Agents',
      description: 'List indexed Brainlink memory namespaces.',
      inputSchema: {
        vault: z.string().optional()
      }
    },
    async ({ vault }) => toToolText({ agents: await listAgents(await resolveVault(vault)) })
  )

  server.registerTool(
    'brainlink_search',
    {
      title: 'Search Brainlink Knowledge',
      description: 'Search indexed Brainlink knowledge chunks.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional(),
        query: z.string().min(1),
        limit: z.number().int().positive().optional()
      }
    },
    async ({ vault, agent, query, limit }) => {
      const resolvedVault = await resolveVault(vault)
      const results = await searchKnowledge(resolvedVault, query, limit ?? 10, agent)

      return toToolText({ query, agent, limit: limit ?? 10, results })
    }
  )

  server.registerTool(
    'brainlink_context',
    {
      title: 'Build Brainlink Context',
      description: 'Build a compact context package for an agent.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional(),
        query: z.string().min(1),
        limit: z.number().int().positive().optional(),
        tokens: z.number().int().positive().optional()
      }
    },
    async ({ vault, agent, query, limit, tokens }) =>
      toToolText(await buildContextPackage(await resolveVault(vault), query, limit ?? 12, tokens ?? 2000, agent))
  )

  server.registerTool(
    'brainlink_graph',
    {
      title: 'Get Brainlink Graph',
      description: 'Return indexed notes and links as graph data.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional()
      }
    },
    async ({ vault, agent }) => toToolText(await getGraph(await resolveVault(vault), agent))
  )

  server.registerTool(
    'brainlink_links',
    {
      title: 'List Brainlink Links',
      description: 'List indexed wiki links.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional()
      }
    },
    async ({ vault, agent }) => toToolText({ links: await listLinks(await resolveVault(vault), agent) })
  )

  server.registerTool(
    'brainlink_backlinks',
    {
      title: 'List Brainlink Backlinks',
      description: 'List notes linking to a target note title.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional(),
        title: z.string().min(1)
      }
    },
    async ({ vault, agent, title }) => toToolText({ title, backlinks: await listBacklinks(await resolveVault(vault), title, agent) })
  )

  server.registerTool(
    'brainlink_stats',
    {
      title: 'Get Brainlink Vault Stats',
      description: 'Return indexed vault statistics.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional()
      }
    },
    async ({ vault, agent }) => toToolText(await getStats(await resolveVault(vault), agent))
  )

  server.registerTool(
    'brainlink_validate',
    {
      title: 'Validate Brainlink Vault',
      description: 'Validate graph health, broken links and orphan notes.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional()
      }
    },
    async ({ vault, agent }) => toToolText(await validateVault(await resolveVault(vault), agent))
  )

  server.registerTool(
    'brainlink_broken_links',
    {
      title: 'List Brainlink Broken Links',
      description: 'Return unresolved wiki links.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional()
      }
    },
    async ({ vault, agent }) => toToolText({ brokenLinks: await getBrokenLinksReport(await resolveVault(vault), agent) })
  )

  server.registerTool(
    'brainlink_orphans',
    {
      title: 'List Brainlink Orphan Notes',
      description: 'Return indexed notes without incoming or outgoing links.',
      inputSchema: {
        vault: z.string().optional(),
        agent: z.string().optional()
      }
    },
    async ({ vault, agent }) => toToolText({ orphans: await getOrphansReport(await resolveVault(vault), agent) })
  )

  await server.connect(new StdioServerTransport())
}
