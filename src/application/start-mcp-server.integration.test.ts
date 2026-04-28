import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type ToolTextResult = {
  readonly content: readonly {
    readonly type: string
    readonly text?: string
  }[]
}

const parseToolText = <T>(result: ToolTextResult): T => {
  const text = result.content.find((item) => item.type === 'text')?.text

  if (!text) {
    throw new Error('Expected MCP tool text content.')
  }

  return JSON.parse(text) as T
}

describe('brainlink mcp server integration', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('exposes agent-aware memory tools over stdio', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-mcp-'))
    tempPaths.push(vault)

    const client = new Client({
      name: 'brainlink-test-client',
      version: '0.1.0'
    })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli/main.ts', 'mcp'],
      cwd: process.cwd(),
      stderr: 'pipe'
    })

    try {
      await client.connect(transport)

      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'brainlink_add_note',
          'brainlink_agents',
          'brainlink_search',
          'brainlink_context',
          'brainlink_graph',
          'brainlink_stats',
          'brainlink_validate',
          'brainlink_broken_links',
          'brainlink_orphans'
        ])
      )

      const added = parseToolText<{
        readonly path: string
        readonly index: {
          readonly documentCount: number
        }
      }>(
        (await client.callTool({
          name: 'brainlink_add_note',
          arguments: {
            vault,
            agent: 'coding-agent',
            title: 'MCP Runtime Policy',
            content: 'Use Brainlink MCP tools before answering memory-dependent tasks. #mcp #memory'
          }
        })) as ToolTextResult
      )
      expect(added.path).toContain('agents/coding-agent/mcp-runtime-policy.md')
      expect(added.index.documentCount).toBe(1)

      const agents = parseToolText<{
        readonly agents: readonly { readonly id: string; readonly documentCount: number }[]
      }>(
        (await client.callTool({
          name: 'brainlink_agents',
          arguments: { vault }
        })) as ToolTextResult
      )
      expect(agents.agents).toEqual([{ id: 'coding-agent', documentCount: 1 }])

      const search = parseToolText<{
        readonly results: readonly { readonly title: string; readonly searchMode: string; readonly semanticScore: number }[]
      }>(
        (await client.callTool({
          name: 'brainlink_search',
          arguments: {
            vault,
            agent: 'coding-agent',
            query: 'MCP memory tools',
            limit: 5,
            mode: 'semantic'
          }
        })) as ToolTextResult
      )
      expect(search.results[0]).toMatchObject({
        title: 'MCP Runtime Policy',
        searchMode: 'semantic'
      })
      expect(search.results[0]?.semanticScore).toBeGreaterThan(0)

      const context = parseToolText<{
        readonly content: string
        readonly sections: readonly { readonly title: string }[]
      }>(
        (await client.callTool({
          name: 'brainlink_context',
          arguments: {
            vault,
            agent: 'coding-agent',
            query: 'memory dependent MCP tasks',
            limit: 5,
            tokens: 500
          }
        })) as ToolTextResult
      )
      expect(context.sections[0]?.title).toBe('MCP Runtime Policy')
      expect(context.content).toContain('Brainlink Context')

      const graph = parseToolText<{
        readonly nodes: readonly { readonly agentId: string; readonly title: string }[]
      }>(
        (await client.callTool({
          name: 'brainlink_graph',
          arguments: {
            vault,
            agent: 'coding-agent'
          }
        })) as ToolTextResult
      )
      expect(graph.nodes).toEqual([
        expect.objectContaining({
          agentId: 'coding-agent',
          title: 'MCP Runtime Policy'
        })
      ])

      const stats = parseToolText<{ readonly documentCount: number; readonly brokenLinkCount: number }>(
        (await client.callTool({
          name: 'brainlink_stats',
          arguments: { vault, agent: 'coding-agent' }
        })) as ToolTextResult
      )
      expect(stats).toMatchObject({ documentCount: 1, brokenLinkCount: 0 })

      const validation = parseToolText<{ readonly ok: boolean }>(
        (await client.callTool({
          name: 'brainlink_validate',
          arguments: { vault, agent: 'coding-agent' }
        })) as ToolTextResult
      )
      expect(validation.ok).toBe(true)

      const brokenLinks = parseToolText<{ readonly brokenLinks: readonly unknown[] }>(
        (await client.callTool({
          name: 'brainlink_broken_links',
          arguments: { vault, agent: 'coding-agent' }
        })) as ToolTextResult
      )
      expect(brokenLinks.brokenLinks).toHaveLength(0)

      const orphans = parseToolText<{ readonly orphans: readonly { readonly title: string }[] }>(
        (await client.callTool({
          name: 'brainlink_orphans',
          arguments: { vault, agent: 'coding-agent' }
        })) as ToolTextResult
      )
      expect(orphans.orphans).toEqual([{ title: 'MCP Runtime Policy', path: 'agents/coding-agent/mcp-runtime-policy.md', tags: ['mcp', 'memory'] }])
    } finally {
      await client.close()
    }
  })
})
