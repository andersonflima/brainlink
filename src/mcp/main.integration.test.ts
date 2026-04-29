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
    tempPaths.push(vault)

    const client = new Client({ name: 'brainlink-test', version: '1.0.0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', tsxLoader, mcpEntryPoint],
      cwd: projectPath,
      stderr: 'pipe'
    })

    await client.connect(transport)

    try {
      const tools = await client.listTools()
      const toolNames = tools.tools.map((tool) => tool.name)

      expect(toolNames).toEqual(
        expect.arrayContaining(['brainlink_context', 'brainlink_add_note', 'brainlink_index', 'brainlink_validate'])
      )

      const addResult = await client.callTool({
        name: 'brainlink_add_note',
        arguments: {
          vault,
          agent: 'coding-agent',
          title: 'Architecture',
          content: 'Brainlink MCP stores durable Markdown memory with [[Related Concept]] links. #architecture #mcp'
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
        query: 'How does MCP store memory?'
      })
      expect(contextResult.content[0]).toMatchObject({
        type: 'text'
      })
    } finally {
      await client.close()
    }
  }, 20000)
})
