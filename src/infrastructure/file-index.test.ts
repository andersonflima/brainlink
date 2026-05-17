import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openFileIndex } from './file-index.js'

type StoredIndexFixture = {
  readonly version: 1
  readonly updatedAt: string
  readonly documents: readonly {
    readonly id: string
    readonly agentId: string
    readonly title: string
    readonly path: string
    readonly tags: readonly string[]
  }[]
  readonly chunks: readonly {
    readonly id: string
    readonly documentId: string
    readonly ordinal: number
    readonly content: string
    readonly embedding: readonly number[]
  }[]
  readonly links: readonly []
}

const createIndexFixture = (content: string): StoredIndexFixture => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  documents: [
    {
      id: 'doc-1',
      agentId: 'shared',
      title: 'Architecture',
      path: 'agents/shared/architecture.md',
      tags: ['architecture']
    }
  ],
  chunks: [
    {
      id: 'chunk-1',
      documentId: 'doc-1',
      ordinal: 0,
      content,
      embedding: []
    }
  ],
  links: []
})

describe('file index cache', () => {
  const tempPaths: string[] = []

  afterEach(async () => {
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('refreshes cached reads after index.json changes in filesystem', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-file-index-cache-'))
    tempPaths.push(vault)
    const indexDirectory = join(vault, '.brainlink')
    const indexPath = join(indexDirectory, 'index.json')
    await mkdir(indexDirectory, { recursive: true })

    await writeFile(indexPath, `${JSON.stringify(createIndexFixture('first signal context'))}\n`, 'utf8')

    const index = openFileIndex(vault)
    const firstResults = await index.search('first', 5, undefined, 'fts', [])

    expect(firstResults).toHaveLength(1)
    expect(firstResults[0]?.content).toContain('first signal context')

    await writeFile(indexPath, `${JSON.stringify(createIndexFixture('second signal context'))}\n`, 'utf8')
    const now = new Date(Date.now() + 1500)
    await utimes(indexPath, now, now)

    const secondResults = await index.search('second', 5, undefined, 'fts', [])

    expect(secondResults).toHaveLength(1)
    expect(secondResults[0]?.content).toContain('second signal context')
  })
})
