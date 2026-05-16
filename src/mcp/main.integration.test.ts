import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const projectPath = process.cwd()
const mcpEntryPoint = join(projectPath, 'src/mcp/main.ts')
const tsxLoader = join(projectPath, 'node_modules/tsx/dist/loader.mjs')

describe('brainlink mcp integration', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('lists tools, writes linked memory and returns context', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-mcp-vault-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-mcp-home-'))
    tempPaths.push(vault, brainlinkHome)

    const client = new Client({ name: 'brainlink-test', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', tsxLoader, mcpEntryPoint],
      cwd: projectPath,
      env: {
        ...process.env,
        BRAINLINK_HOME: brainlinkHome
      },
      stderr: 'pipe'
    })

    await client.connect(transport)

    try {
      const tools = await client.listTools()
      const toolNames = tools.tools.map((tool) => tool.name)

      expect(toolNames).toEqual(
        expect.arrayContaining(['brainlink_bootstrap', 'brainlink_policy', 'brainlink_context', 'brainlink_add_note', 'brainlink_index', 'brainlink_validate'])
      )

      const addResult = await client.callTool({
        name: 'brainlink_add_note',
        arguments: {
          vault,
          agent: 'coding-agent',
          title: 'Architecture',
          content: 'Brainlink MCP stores durable Markdown memory with [[Related Concept]] priority: high. #architecture #mcp'
        }
      })

      expect(addResult.structuredContent).toMatchObject({
        vault,
        title: 'Architecture',
        agent: 'coding-agent'
      })

      const contextResult = await client.callTool({
        name: 'brainlink_context',
        arguments: {
          vault,
          agent: 'coding-agent',
          query: 'How does MCP store memory?',
          mode: 'hybrid'
        }
      })

      expect(contextResult.structuredContent).toMatchObject({
        vault,
        agent: 'coding-agent',
        blockedTool: 'brainlink_context',
        preflightRequired: true
      })
      expect(contextResult.content[0]).toMatchObject({
        type: 'text'
      })

      const bootstrapResult = await client.callTool({
        name: 'brainlink_bootstrap',
        arguments: {
          vault,
          agent: 'coding-agent',
          query: 'What should I know before changing architecture?',
          mode: 'hybrid'
        }
      })

      expect(bootstrapResult.structuredContent).toMatchObject({
        vault,
        agent: 'coding-agent',
        mode: 'hybrid',
        session: {
          vault,
          agent: 'coding-agent'
        },
        context: {
          query: 'What should I know before changing architecture?'
        }
      })

      const graphResult = await client.callTool({
        name: 'brainlink_graph',
        arguments: {
          vault,
          agent: 'coding-agent'
        }
      })

      expect(graphResult.structuredContent).toMatchObject({
        vault,
        agent: 'coding-agent',
        edges: [
          expect.objectContaining({
            targetTitle: 'Related Concept',
            weight: 4,
            priority: 'high'
          })
        ]
      })
    } finally {
      await client.close()
    }
  }, 20000)
})
