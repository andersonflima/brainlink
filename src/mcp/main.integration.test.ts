import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
        expect.arrayContaining([
          'brainlink_bootstrap',
          'brainlink_policy',
          'brainlink_recommendations',
          'brainlink_context',
          'brainlink_dedupe',
          'brainlink_resolve_duplicate',
          'brainlink_add_note',
          'brainlink_index',
          'brainlink_validate'
        ])
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
        agent: 'coding-agent',
        writeConnectivity: {
          guaranteedEdge: true
        }
      })

      await client.callTool({
        name: 'brainlink_add_note',
        arguments: {
          vault,
          agent: 'coding-agent',
          title: 'Architecture Copy',
          content: 'Brainlink MCP stores durable Markdown memory with [[Related Concept]] priority: high. #architecture #mcp'
        }
      })

      const dedupeResult = await client.callTool({
        name: 'brainlink_dedupe',
        arguments: {
          vault,
          agent: 'coding-agent',
          semantic: false
        }
      })

      expect(dedupeResult.structuredContent).toMatchObject({
        vault,
        agent: 'coding-agent',
        duplicates: [expect.objectContaining({ kind: 'exact', possibleDuplicate: true, score: 1 })]
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
        mode: 'hybrid',
        bootstrap: expect.objectContaining({
          autoBootstrapped: true
        })
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
        },
        nextActions: [
          expect.objectContaining({
            tool: 'brainlink_add_note'
          })
        ]
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
        bootstrap: expect.objectContaining({
          autoBootstrapped: false
        }),
        edges: expect.arrayContaining([
          expect.objectContaining({
            targetTitle: 'Related Concept',
            weight: 4,
            priority: 'high'
          })
        ])
      })

      const duplicatePair = (
        dedupeResult.structuredContent as { duplicates?: readonly { left: { path: string }; right: { path: string } }[] }
      ).duplicates?.[0]
      expect(duplicatePair).toBeDefined()

      const dedupeResolveResult = await client.callTool({
        name: 'brainlink_resolve_duplicate',
        arguments: {
          vault,
          leftPath: duplicatePair?.left.path,
          rightPath: duplicatePair?.right.path,
          action: 'ignore'
        }
      })

      expect(dedupeResolveResult.structuredContent).toMatchObject({
        vault,
        action: 'ignore'
      })

      const recommendationsResult = await client.callTool({
        name: 'brainlink_recommendations',
        arguments: {
          vault,
          agent: 'coding-agent',
          query: 'How to evolve architecture?'
        }
      })

      expect(recommendationsResult.structuredContent).toMatchObject({
        vault,
        agent: 'coding-agent',
        defaults: {
          mode: 'hybrid'
        },
        recommendations: expect.arrayContaining([
          expect.objectContaining({
            tool: 'brainlink_context'
          }),
          expect.objectContaining({
            tool: 'brainlink_add_note'
          })
        ])
      })
    } finally {
      await client.close()
    }
  }, 20000)

  it('returns preflight when auto-bootstrap-on-read is disabled', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-mcp-policy-vault-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-mcp-policy-home-'))
    tempPaths.push(vault, brainlinkHome)

    const client = new Client({ name: 'brainlink-test-policy', version: '1.0.0' })
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
      await client.callTool({
        name: 'brainlink_policy',
        arguments: {
          vault,
          agent: 'coding-agent',
          preset: 'strict'
        }
      })

      const contextResult = await client.callTool({
        name: 'brainlink_context',
        arguments: {
          vault,
          agent: 'coding-agent',
          query: 'preflight check'
        }
      })

      expect(contextResult.structuredContent).toMatchObject({
        preflightRequired: true,
        blockedTool: 'brainlink_context',
        nextActions: [
          expect.objectContaining({
            tool: 'brainlink_bootstrap'
          })
        ]
      })
    } finally {
      await client.close()
    }
  }, 20000)

  it('enforces context-first before non-context read tools', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-mcp-context-first-vault-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-mcp-context-first-home-'))
    tempPaths.push(vault, brainlinkHome)

    const client = new Client({ name: 'brainlink-test-context-first', version: '1.0.0' })
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
      await client.callTool({
        name: 'brainlink_add_note',
        arguments: {
          vault,
          agent: 'coding-agent',
          title: 'Context First',
          content: 'Brainlink context-first check with [[Root Topic]]. #memory'
        }
      })

      const graphPreflight = await client.callTool({
        name: 'brainlink_graph',
        arguments: {
          vault,
          agent: 'coding-agent'
        }
      })

      expect(graphPreflight.structuredContent).toMatchObject({
        preflightRequired: true,
        blockedTool: 'brainlink_graph',
        nextActions: [expect.objectContaining({ tool: 'brainlink_context' })]
      })

      await client.callTool({
        name: 'brainlink_context',
        arguments: {
          vault,
          agent: 'coding-agent',
          query: 'context first check'
        }
      })

      const graph = await client.callTool({
        name: 'brainlink_graph',
        arguments: {
          vault,
          agent: 'coding-agent'
        }
      })

      expect(graph.structuredContent).toMatchObject({
        vault,
        agent: 'coding-agent',
        nodes: expect.any(Array),
        edges: expect.any(Array)
      })
    } finally {
      await client.close()
    }
  }, 20000)

  it('uses agent profile defaults for MCP mode and limits', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-mcp-profile-vault-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-mcp-profile-home-'))
    tempPaths.push(vault, brainlinkHome)

    await writeFile(
      join(brainlinkHome, 'brainlink.config.json'),
      `${JSON.stringify(
        {
          defaultSearchMode: 'fts',
          defaultSearchLimit: 7,
          agentProfiles: {
            'coding-agent': {
              defaultSearchMode: 'semantic',
              defaultSearchLimit: 2,
              defaultContextTokens: 900
            }
          }
        },
        null,
        2
      )}\n`
    )

    const client = new Client({ name: 'brainlink-test-profile', version: '1.0.0' })
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
      await client.callTool({
        name: 'brainlink_add_note',
        arguments: {
          vault,
          agent: 'coding-agent',
          title: 'Semantic Memory',
          content: 'Semantic default mode should apply when mode is omitted. #semantic'
        }
      })

      await client.callTool({
        name: 'brainlink_bootstrap',
        arguments: {
          vault,
          agent: 'coding-agent'
        }
      })

      const contextResult = await client.callTool({
        name: 'brainlink_context',
        arguments: {
          vault,
          agent: 'coding-agent',
          query: 'semantic memory'
        }
      })

      expect(contextResult.structuredContent).toMatchObject({
        mode: 'semantic',
        limit: 2,
        tokens: 900
      })

      const searchResult = await client.callTool({
        name: 'brainlink_search',
        arguments: {
          vault,
          agent: 'coding-agent',
          query: 'semantic memory'
        }
      })

      expect(searchResult.structuredContent).toMatchObject({
        mode: 'semantic',
        limit: 2
      })
    } finally {
      await client.close()
    }
  }, 20000)

  it('bootstraps default vault and agent during MCP startup', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-mcp-startup-vault-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-mcp-startup-home-'))
    tempPaths.push(vault, brainlinkHome)

    await writeFile(
      join(brainlinkHome, 'brainlink.config.json'),
      `${JSON.stringify(
        {
          vault,
          defaultAgent: 'coding-agent'
        },
        null,
        2
      )}\n`
    )

    const client = new Client({ name: 'brainlink-test-startup', version: '1.0.0' })
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
      const policyResult = await client.callTool({
        name: 'brainlink_policy',
        arguments: {
          vault,
          agent: 'coding-agent'
        }
      })

      expect(policyResult.structuredContent).toMatchObject({
        vault,
        agent: 'coding-agent',
        policy: expect.objectContaining({
          autoBootstrapOnStartup: true
        }),
        bootstrapStatus: expect.objectContaining({
          ready: true,
          stale: false
        })
      })
    } finally {
      await client.close()
    }
  }, 20000)

  it('applies policy presets through MCP tool', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-mcp-policy-preset-vault-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-mcp-policy-preset-home-'))
    tempPaths.push(vault, brainlinkHome)

    const client = new Client({ name: 'brainlink-test-policy-preset', version: '1.0.0' })
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
      const strictResult = await client.callTool({
        name: 'brainlink_policy',
        arguments: {
          vault,
          preset: 'strict'
        }
      })
      expect(strictResult.structuredContent).toMatchObject({
        presetApplied: 'strict',
        policy: {
          enforceBootstrap: true,
          enforceContextFirst: true,
          autoBootstrapOnRead: false,
          autoBootstrapOnStartup: false
        }
      })

      const autoResult = await client.callTool({
        name: 'brainlink_policy',
        arguments: {
          vault,
          preset: 'fully-auto'
        }
      })
      expect(autoResult.structuredContent).toMatchObject({
        presetApplied: 'fully-auto',
        policy: {
          enforceBootstrap: true,
          enforceContextFirst: true,
          autoBootstrapOnRead: true,
          autoBootstrapOnStartup: true
        }
      })
    } finally {
      await client.close()
    }
  }, 20000)
})
