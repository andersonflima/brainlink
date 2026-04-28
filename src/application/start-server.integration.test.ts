import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addNote } from './add-note.js'
import { startServer } from './start-server.js'

describe('brainlink http server integration', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('serves graph, search, context and note creation APIs', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-http-'))
    tempPaths.push(vault)
    await addNote(vault, 'Architecture', 'Markdown is the source of truth. #architecture')
    await addNote(vault, 'Auth Decision', 'We chose JWT. [[Architecture]] #auth #jwt')
    await addNote(vault, 'Research Memory', 'Research agent source review. #research', 'research-agent')

    const server = await startServer({
      vaultPath: vault,
      host: '127.0.0.1',
      port: 0,
      shouldIndex: true,
      shouldWatch: false,
      writeToken: 'test-write-token'
    })

    try {
      const graph = (await fetch(`${server.url}/api/graph?agent=shared`).then((response) => response.json())) as {
        readonly nodes: readonly unknown[]
        readonly edges: readonly unknown[]
      }
      expect(graph.nodes).toHaveLength(2)
      expect(graph.edges).toHaveLength(1)

      const agents = (await fetch(`${server.url}/api/agents`).then((response) => response.json())) as {
        readonly agents: readonly { readonly id: string; readonly documentCount: number }[]
      }
      expect(agents.agents).toEqual(
        expect.arrayContaining([
          { id: 'shared', documentCount: 2 },
          { id: 'research-agent', documentCount: 1 }
        ])
      )

      const researchGraph = (await fetch(`${server.url}/api/graph?agent=research-agent`).then((response) => response.json())) as {
        readonly nodes: readonly unknown[]
      }
      expect(researchGraph.nodes).toHaveLength(1)

      const layout = (await fetch(`${server.url}/api/graph-layout?agent=shared`).then((response) => response.json())) as {
        readonly nodes: readonly { readonly segment: string; readonly group: string }[]
        readonly edges: readonly unknown[]
      }
      expect(layout.nodes).toHaveLength(2)
      expect(layout.edges).toHaveLength(1)
      expect(layout.nodes.every((node) => typeof node.segment === 'string' && node.segment.length > 0)).toBe(true)
      expect(layout.nodes.every((node) => typeof node.group === 'string' && node.group.length > 0)).toBe(true)

      const page = await fetch(`${server.url}/`).then((response) => response.text())
      expect(page).toContain('<canvas id="graph"')
      expect(page).toContain('<select id="agent"')

      const search = (await fetch(`${server.url}/api/search?q=jwt&limit=5&mode=hybrid`).then((response) => response.json())) as {
        readonly mode: string
        readonly results: readonly { readonly title: string; readonly searchMode: string }[]
      }
      expect(search.mode).toBe('hybrid')
      expect(search.results[0]?.title).toBe('Auth Decision')
      expect(search.results[0]?.searchMode).toBe('hybrid')

      const semanticSearch = (await fetch(`${server.url}/api/search?q=authentication%20token&limit=5&mode=semantic`).then((response) =>
        response.json()
      )) as {
        readonly results: readonly { readonly title: string; readonly searchMode: string; readonly semanticScore: number }[]
      }
      expect(semanticSearch.results[0]).toMatchObject({
        title: 'Auth Decision',
        searchMode: 'semantic'
      })
      expect(semanticSearch.results[0]?.semanticScore).toBeGreaterThan(0)

      const invalidMode = await fetch(`${server.url}/api/search?q=jwt&mode=vector`)
      expect(invalidMode.status).toBe(400)

      const context = (await fetch(`${server.url}/api/context?q=auth&limit=5&tokens=500`).then((response) =>
        response.json()
      )) as { readonly content: string }
      expect(context.content).toContain('Brainlink Context')
      expect(context.content).toContain('Mode:')

      const stats = (await fetch(`${server.url}/api/stats`).then((response) => response.json())) as {
        readonly documentCount: number
        readonly brokenLinkCount: number
      }
      expect(stats).toMatchObject({
        documentCount: 3,
        brokenLinkCount: 0
      })

      const unauthorized = await fetch(`${server.url}/api/notes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Unauthorized',
          content: 'This write has no token. #security'
        })
      })
      expect(unauthorized.status).toBe(401)

      const created = (await fetch(`${server.url}/api/notes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-brainlink-token': server.writeToken
        },
        body: JSON.stringify({
          title: 'Runtime',
          content: 'Node.js runtime note. [[Architecture]] #runtime',
          agent: 'coding-agent'
        })
      }).then((response) => response.json())) as { readonly index: { readonly documentCount: number } }
      expect(created.index.documentCount).toBe(4)

      const invalidNote = await fetch(`${server.url}/api/notes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-brainlink-token': server.writeToken
        },
        body: JSON.stringify({
          title: '',
          content: ''
        })
      })
      expect(invalidNote.status).toBe(400)

      const sensitiveNote = await fetch(`${server.url}/api/notes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-brainlink-token': server.writeToken
        },
        body: JSON.stringify({
          title: 'Credentials',
          content: 'OPENAI_API_KEY=sk-test12345678901234567890'
        })
      })
      expect(sensitiveNote.status).toBe(400)
    } finally {
      await server.close()
    }
  })

  it('refuses non-loopback hosts without explicit public opt-in', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-public-host-'))
    tempPaths.push(vault)

    await expect(
      startServer({
        vaultPath: vault,
        host: '0.0.0.0',
        port: 0,
        shouldIndex: false,
        shouldWatch: false
      })
    ).rejects.toThrow('Refusing to bind Brainlink server')
  })
})
