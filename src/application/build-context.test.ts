import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '../domain/types.js'

const searchKnowledge = vi.fn<() => Promise<readonly SearchResult[]>>()

vi.mock('./search-knowledge.js', () => ({
  searchKnowledge
}))

const createSearchResult = (content: string): SearchResult => ({
  documentId: 'doc-1',
  agentId: 'shared',
  title: 'Architecture',
  path: 'agents/shared/architecture.md',
  chunkId: 'chunk-1',
  chunkOrdinal: 0,
  content,
  score: 10,
  textScore: 10,
  semanticScore: 0,
  searchMode: 'fts',
  tags: ['architecture']
})

describe('build context package cache', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    searchKnowledge.mockReset()
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('reuses context for repeated calls and invalidates after index update', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-context-cache-'))
    tempPaths.push(vault)
    const indexDirectory = join(vault, '.brainlink')
    const indexPath = join(indexDirectory, 'index.json')

    await mkdir(indexDirectory, { recursive: true })
    await writeFile(indexPath, '{"version":1,"updatedAt":"2026-01-01T00:00:00.000Z","documents":[],"chunks":[],"links":[]}\n', 'utf8')

    searchKnowledge.mockResolvedValue([createSearchResult('Initial content #architecture')])

    const { buildContextPackage } = await import('./build-context.js')

    const first = await buildContextPackage(vault, 'architecture', 8, 1200, 'shared', 'hybrid')
    const second = await buildContextPackage(vault, 'architecture', 8, 1200, 'shared', 'hybrid')

    expect(first.content).toContain('Initial content')
    expect(second.content).toContain('Initial content')
    expect(searchKnowledge).toHaveBeenCalledTimes(1)

    await writeFile(indexPath, '{"version":1,"updatedAt":"2026-01-01T00:00:01.000Z","documents":[],"chunks":[],"links":[]}\n', 'utf8')
    const now = new Date(Date.now() + 1500)
    await utimes(indexPath, now, now)

    searchKnowledge.mockResolvedValue([createSearchResult('Updated content #architecture')])
    const third = await buildContextPackage(vault, 'architecture', 8, 1200, 'shared', 'hybrid')

    expect(third.content).toContain('Updated content')
    expect(searchKnowledge).toHaveBeenCalledTimes(2)
  })
})
