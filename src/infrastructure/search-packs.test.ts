import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
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
      readonly packIndex?: readonly {
        readonly fileName: string
        readonly recordCount: number
        readonly agents: readonly string[]
        readonly tokenBloomB64: string
      }[]
    }
    const firstPack = await readFile(join(vault, '.brainlink', 'search-packs', 'pack-0001.blpk'))
    const results = await searchInPacks(vault, 'jwt token auth', 5)

    expect(report.recordCount).toBe(2)
    expect(report.packCount).toBeGreaterThan(0)
    expect(manifest.version).toBe(3)
    expect(manifest.format).toBe('private-v2')
    expect(manifest.recordCount).toBe(2)
    expect(Array.isArray(manifest.packIndex)).toBe(true)
    expect(manifest.packIndex?.[0]).toMatchObject({
      fileName: 'pack-0001.blpk',
      recordCount: 2,
      agents: ['shared']
    })
    expect(typeof manifest.packIndex?.[0]?.tokenBloomB64).toBe('string')
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

  it('keeps search lossless when compressed index metadata is partially invalid', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'brainlink-search-packs-lossless-'))
    const brainlinkHome = await mkdtemp(join(tmpdir(), 'brainlink-search-packs-lossless-home-'))
    process.env.BRAINLINK_HOME = brainlinkHome
    tempPaths.push(vault, brainlinkHome)

    const alphaDocuments = Array.from({ length: 5_000 }, (_, index) =>
      createIndexedDocument(`alpha-${index}`, 'shared', `Alpha ${index}`, 'alpha payload', ['alpha'])
    )
    const betaDocuments = Array.from({ length: 8 }, (_, index) =>
      createIndexedDocument(`beta-${index}`, 'shared', `Beta ${index}`, 'beta payload', ['beta'])
    )

    await buildSearchPacks(vault, [...alphaDocuments, ...betaDocuments])

    const manifestPath = join(vault, '.brainlink', 'search-packs', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      readonly version: number
      readonly createdAt: string
      readonly packCount: number
      readonly recordCount: number
      readonly format: string
      readonly packIndex: readonly {
        readonly fileName: string
        readonly recordCount: number
        readonly agents: readonly string[]
        readonly tokenBloomB64: string
      }[]
    }

    expect(manifest.packIndex.length).toBeGreaterThan(1)
    const allOnesBloom = Buffer.alloc(256, 0xff).toString('base64url')
    const corruptedManifest = {
      ...manifest,
      packIndex: manifest.packIndex.map((entry, index) =>
        index === 0
          ? { ...entry, tokenBloomB64: 'invalid-bloom-data' }
          : { ...entry, tokenBloomB64: allOnesBloom }
      )
    }
    await writeFile(manifestPath, `${JSON.stringify(corruptedManifest, null, 2)}\n`, 'utf8')

    const results = await searchInPacks(vault, 'alpha', 5)

    expect(results.length).toBeGreaterThan(0)
    expect(results.some((row) => row.title.startsWith('Alpha '))).toBe(true)
  }, 20000)
})
