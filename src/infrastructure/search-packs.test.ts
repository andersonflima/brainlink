import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { IndexedDocument } from '../domain/types.js'
import { buildSearchPacks, ensurePrivatePacksFromLegacyIndex, searchInPacks } from './search-packs.js'

const createIndexedDocument = (
  id: string,
  agentId: string,
  title: string,
  content: string,
  tags: readonly string[]
): IndexedDocument => ({
  document: {
    id,
    agentId,
    title,
    path: `agents/${agentId}/${title}.md`,
    content,
    tags,
    links: [],
    frontmatter: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  chunks: [
    {
      id: `${id}:1`,
      documentId: id,
      ordinal: 1,
      content,
      tokenCount: Math.max(1, Math.ceil(content.length / 4)),
      embeddingProvider: 'none',
      embedding: []
    }
  ],
  links: []
})

describe('search packs', () => {
  const tempPaths: string[] = []
  const originalBrainlinkHome = process.env.BRAINLINK_HOME

  afterEach(async () => {
    if (originalBrainlinkHome === undefined) {
      delete process.env.BRAINLINK_HOME
    } else {
      process.env.BRAINLINK_HOME = originalBrainlinkHome
    }
    await Promise.all(tempPaths.map((path) => rm(path, { recursive: true, force: true })))
    tempPaths.length = 0
  })

  it('creates compressed packs and searches rows by relevance', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-search-packs-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-search-packs-home-'))
    process.env.BRAINLINK_HOME = brainlinkHome
    tempPaths.push(vault, brainlinkHome)
    const documents: readonly IndexedDocument[] = [
      createIndexedDocument('doc-1', 'shared', 'Architecture', 'JWT auth token policy for services', ['architecture', 'security']),
      createIndexedDocument('doc-2', 'shared', 'Operations', 'Runbook for backups and monitoring', ['ops'])
    ]

    const report = await buildSearchPacks(vault, documents)
    const manifest = JSON.parse(await readFile(join(vault, '.brainlink', 'search-packs', 'manifest.json'), 'utf8')) as {
      readonly packCount: number
      readonly recordCount: number
      readonly version: number
      readonly format: string
    }
    const firstPack = await readFile(join(vault, '.brainlink', 'search-packs', 'pack-0001.blpk'))
    const results = await searchInPacks(vault, 'jwt token auth', 5)

    expect(report.recordCount).toBe(2)
    expect(report.packCount).toBeGreaterThan(0)
    expect(manifest.version).toBe(2)
    expect(manifest.format).toBe('private-v2')
    expect(manifest.recordCount).toBe(2)
    expect(() => gunzipSync(firstPack)).toThrow()
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toMatchObject({
      title: 'Architecture',
      searchMode: 'fts'
    })
  })

  it('filters by agent namespace when provided', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-search-packs-agent-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-search-packs-agent-home-'))
    process.env.BRAINLINK_HOME = brainlinkHome
    tempPaths.push(vault, brainlinkHome)
    const documents: readonly IndexedDocument[] = [
      createIndexedDocument('doc-1', 'shared', 'Architecture', 'JWT auth token policy', ['architecture']),
      createIndexedDocument('doc-2', 'research-agent', 'Research', 'JWT token experiments', ['research'])
    ]

    await buildSearchPacks(vault, documents)
    const sharedOnly = await searchInPacks(vault, 'jwt token', 10, 'shared')
    const researchOnly = await searchInPacks(vault, 'jwt token', 10, 'research-agent')

    expect(sharedOnly.every((row) => row.agentId === 'shared')).toBe(true)
    expect(researchOnly.every((row) => row.agentId === 'research-agent')).toBe(true)
  })

  it('imports legacy sqlite index rows into private packs automatically', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-search-packs-legacy-sqlite-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-search-packs-legacy-sqlite-home-'))
    process.env.BRAINLINK_HOME = brainlinkHome
    tempPaths.push(vault, brainlinkHome)

    await mkdir(join(vault, '.brainlink'), { recursive: true })
    const dbPath = join(vault, '.brainlink', 'brainlink.db')
    const db = new Database(dbPath)
    try {
      db.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          title TEXT NOT NULL,
          path TEXT NOT NULL,
          content TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          frontmatter_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE chunks (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          content TEXT NOT NULL,
          token_count INTEGER NOT NULL,
          embedding_provider TEXT NOT NULL,
          embedding_json TEXT NOT NULL
        );
      `)
      db.prepare(
        `
          INSERT INTO documents (id, agent_id, title, path, content, tags_json, frontmatter_json, created_at, updated_at)
          VALUES ('doc-1', 'shared', 'Architecture', 'agents/shared/architecture.md', 'JWT auth strategy', '["architecture"]', '{}', '2026-01-01', '2026-01-01')
        `
      ).run()
      db.prepare(
        `
          INSERT INTO chunks (id, document_id, ordinal, content, token_count, embedding_provider, embedding_json)
          VALUES ('chunk-1', 'doc-1', 1, 'JWT auth strategy', 4, 'none', '[]')
        `
      ).run()
    } finally {
      db.close()
    }

    const importReport = await ensurePrivatePacksFromLegacyIndex(vault)
    const results = await searchInPacks(vault, 'jwt auth', 5)

    expect(importReport).toMatchObject({
      imported: true,
      source: 'legacy-sqlite'
    })
    expect(results[0]).toMatchObject({
      title: 'Architecture'
    })
  })
})
