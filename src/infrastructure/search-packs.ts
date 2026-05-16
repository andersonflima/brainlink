import { gunzipSync } from 'node:zlib'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { middleOutIndices } from '../domain/middle-out.js'
import type { IndexedDocument, SearchResult } from '../domain/types.js'
import { decodePrivatePack, encodePrivatePack, isPrivatePackPayload } from './private-pack-codec.js'

type SearchPackRow = {
  readonly documentId: string
  readonly agentId: string
  readonly title: string
  readonly path: string
  readonly chunkId: string
  readonly chunkOrdinal: number
  readonly content: string
  readonly tags: readonly string[]
}

type SearchPackManifestV2 = {
  readonly version: 2
  readonly createdAt: string
  readonly packCount: number
  readonly recordCount: number
  readonly format: 'private-v2'
}

type SearchPackIndexEntry = {
  readonly fileName: string
  readonly recordCount: number
  readonly agents: readonly string[]
  readonly tokenBloomB64: string
}

type SearchPackManifestV3 = {
  readonly version: 3
  readonly createdAt: string
  readonly packCount: number
  readonly recordCount: number
  readonly format: 'private-v2'
  readonly packIndex: readonly SearchPackIndexEntry[]
}

type SearchPackManifest = SearchPackManifestV2 | SearchPackManifestV3

const packsDirectoryName = 'search-packs'
const manifestFileName = 'manifest.json'
const rowChunkSize = 5_000
const queryTokenPattern = /[\p{L}\p{N}_-]+/gu
const bloomBytes = 256
const bloomBitSize = bloomBytes * 8
const bloomSeeds = [0x9e3779b1, 0x85ebca6b, 0xc2b2ae35] as const

const toPackDirectory = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', packsDirectoryName)

const toManifestPath = (vaultPath: string): string =>
  join(toPackDirectory(vaultPath), manifestFileName)

const parseRowsFromPack = async (vaultPath: string, content: Buffer): Promise<readonly SearchPackRow[]> => {
  const raw = isPrivatePackPayload(content) ? await decodePrivatePack(vaultPath, content) : gunzipSync(content)

  return raw
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Partial<SearchPackRow>)
    .flatMap((row) => {
      if (
        typeof row.documentId !== 'string' ||
        typeof row.agentId !== 'string' ||
        typeof row.title !== 'string' ||
        typeof row.path !== 'string' ||
        typeof row.chunkId !== 'string' ||
        typeof row.content !== 'string'
      ) {
        return []
      }

      return [
        {
          documentId: row.documentId,
          agentId: row.agentId,
          title: row.title,
          path: row.path,
          chunkId: row.chunkId,
          chunkOrdinal: typeof row.chunkOrdinal === 'number' ? row.chunkOrdinal : 0,
          content: row.content,
          tags: Array.isArray(row.tags) ? row.tags.filter((item): item is string => typeof item === 'string') : []
        }
      ]
    })
}

const toRows = (documents: readonly IndexedDocument[]): readonly SearchPackRow[] =>
  documents.flatMap((document) =>
    document.chunks.map((chunk) => ({
      documentId: document.document.id,
      agentId: document.document.agentId,
      title: document.document.title,
      path: document.document.path,
      chunkId: chunk.id,
      chunkOrdinal: chunk.ordinal,
      content: chunk.content,
      tags: document.document.tags
    }))
  )

const writeManifest = async (vaultPath: string, manifest: SearchPackManifest): Promise<void> => {
  await writeFile(toManifestPath(vaultPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

const readManifest = async (vaultPath: string): Promise<SearchPackManifest | null> => {
  try {
    const parsed = JSON.parse(await readFile(toManifestPath(vaultPath), 'utf8')) as Partial<SearchPackManifest>

    if (parsed.version === 2 && parsed.format === 'private-v2') {
      return {
        version: 2,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
        packCount: typeof parsed.packCount === 'number' ? parsed.packCount : 0,
        recordCount: typeof parsed.recordCount === 'number' ? parsed.recordCount : 0,
        format: 'private-v2'
      }
    }

    if (parsed.version === 3 && parsed.format === 'private-v2') {
      const packIndex = Array.isArray(parsed.packIndex)
        ? parsed.packIndex.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') {
              return []
            }
            const candidate = entry as Partial<SearchPackIndexEntry>
            if (typeof candidate.fileName !== 'string' || typeof candidate.tokenBloomB64 !== 'string') {
              return []
            }

            return [
              {
                fileName: candidate.fileName,
                recordCount: typeof candidate.recordCount === 'number' ? candidate.recordCount : 0,
                agents: Array.isArray(candidate.agents) ? candidate.agents.filter((item): item is string => typeof item === 'string') : [],
                tokenBloomB64: candidate.tokenBloomB64
              }
            ]
          })
        : []

      return {
        version: 3,
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
        packCount: typeof parsed.packCount === 'number' ? parsed.packCount : packIndex.length,
        recordCount: typeof parsed.recordCount === 'number' ? parsed.recordCount : 0,
        format: 'private-v2',
        packIndex
      }
    }

    return null
  } catch {
    return null
  }
}

const chunkRows = <T>(rows: readonly T[], size: number): readonly (readonly T[])[] => {
  const chunks: T[][] = []

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size))
  }

  return chunks
}

const normalizeToken = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

const tokenize = (query: string): readonly string[] =>
  query
    .match(queryTokenPattern)
    ?.map(normalizeToken)
    .filter((token) => token.length > 1) ?? []

const countOccurrences = (text: string, token: string): number => {
  let hits = 0
  let start = 0

  while (start < text.length) {
    const index = text.indexOf(token, start)

    if (index < 0) {
      break
    }

    hits += 1
    start = index + token.length
  }

  return hits
}

const hashToken = (token: string, seed: number): number => {
  let hash = seed >>> 0

  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }

  return hash >>> 0
}

const createBloom = (): Uint8Array => new Uint8Array(bloomBytes)

const bloomAdd = (bloom: Uint8Array, token: string): void => {
  bloomSeeds.forEach((seed) => {
    const bit = hashToken(token, seed) % bloomBitSize
    bloom[Math.floor(bit / 8)] |= 1 << (bit % 8)
  })
}

const bloomMayContain = (bloom: Uint8Array, token: string): boolean =>
  bloomSeeds.every((seed) => {
    const bit = hashToken(token, seed) % bloomBitSize
    return (bloom[Math.floor(bit / 8)] & (1 << (bit % 8))) !== 0
  })

const bloomFromRows = (rows: readonly SearchPackRow[]): Uint8Array => {
  const bloom = createBloom()

  rows.forEach((row) => {
    tokenize([row.title, row.path, row.tags.join(' '), row.content].join(' ')).forEach((token) => bloomAdd(bloom, token))
  })

  return bloom
}

const bloomToBase64 = (bloom: Uint8Array): string => Buffer.from(bloom).toString('base64url')

const bloomFromBase64 = (value: string): { readonly bloom: Uint8Array; readonly valid: boolean } => {
  try {
    const decoded = Buffer.from(value, 'base64url')

    if (decoded.byteLength === bloomBytes) {
      return {
        bloom: new Uint8Array(decoded),
        valid: true
      }
    }
  } catch {
    // fallback below
  }

  return {
    bloom: createBloom(),
    valid: false
  }
}

const computeTextScore = (row: SearchPackRow, tokens: readonly string[]): number => {
  if (tokens.length === 0) {
    return 0
  }

  const title = normalizeToken(row.title)
  const path = normalizeToken(row.path)
  const content = normalizeToken(row.content)
  const tags = normalizeToken(row.tags.join(' '))

  return tokens.reduce((score, token) => {
    const titleHits = countOccurrences(title, token)
    const tagHits = countOccurrences(tags, token)
    const pathHits = countOccurrences(path, token)
    const contentHits = countOccurrences(content, token)

    return score + titleHits * 5 + tagHits * 4 + pathHits * 2 + Math.min(contentHits, 5)
  }, 0)
}

const toSearchResult = (row: SearchPackRow, score: number): SearchResult => ({
  documentId: row.documentId,
  agentId: row.agentId,
  title: row.title,
  path: row.path,
  chunkId: row.chunkId,
  chunkOrdinal: row.chunkOrdinal,
  content: row.content,
  score,
  textScore: score,
  semanticScore: 0,
  searchMode: 'fts',
  tags: row.tags
})

const sortedPackFiles = async (vaultPath: string): Promise<readonly string[]> => {
  try {
    const files = await readdir(toPackDirectory(vaultPath))

    return files
      .filter((file) => file.endsWith('.blpk') || file.endsWith('.jsonl.gz'))
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

const writeRowsAsPrivatePacks = async (
  vaultPath: string,
  rows: readonly SearchPackRow[],
  clearExisting: boolean
): Promise<{ readonly packCount: number; readonly recordCount: number }> => {
  const directory = toPackDirectory(vaultPath)
  await mkdir(directory, { recursive: true })

  if (clearExisting) {
    const current = await readdir(directory)
    await Promise.all(
      current
        .filter((name) => name.endsWith('.blpk') || name.endsWith('.jsonl.gz') || name === manifestFileName)
        .map((name) => rm(join(directory, name), { force: true }))
    )
  }

  const chunks = chunkRows(rows, rowChunkSize)
  const packIndex: SearchPackIndexEntry[] = []

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const fileName = `pack-${String(index + 1).padStart(4, '0')}.blpk`
    const serialized = `${chunk.map((row) => JSON.stringify(row)).join('\n')}\n`
    const compressed = await encodePrivatePack(vaultPath, Buffer.from(serialized, 'utf8'))
    const tokenBloomB64 = bloomToBase64(bloomFromRows(chunk))

    await writeFile(join(directory, fileName), compressed)
    packIndex.push({
      fileName,
      recordCount: chunk.length,
      agents: Array.from(new Set(chunk.map((row) => row.agentId))).sort((left, right) => left.localeCompare(right)),
      tokenBloomB64
    })
  }

  await writeManifest(vaultPath, {
    version: 3,
    createdAt: new Date().toISOString(),
    packCount: chunks.length,
    recordCount: rows.length,
    format: 'private-v2',
    packIndex
  })

  return {
    packCount: chunks.length,
    recordCount: rows.length
  }
}

const selectCandidatePackFiles = async (
  vaultPath: string,
  tokens: readonly string[],
  agentId?: string
): Promise<readonly string[]> => {
  const allFiles = await sortedPackFiles(vaultPath)
  if (allFiles.length === 0) {
    return []
  }

  const manifest = await readManifest(vaultPath)
  if (!manifest || manifest.version !== 3 || !Array.isArray(manifest.packIndex)) {
    return allFiles
  }

  const normalizedAgent = agentId?.trim()
  const byAgent = manifest.packIndex.filter((entry) =>
    normalizedAgent ? entry.agents.includes(normalizedAgent) : true
  )

  if (tokens.length === 0) {
    return byAgent.map((entry) => entry.fileName)
  }

  let hasInvalidBloomIndex = false
  const byToken = byAgent.filter((entry) => {
    const decoded = bloomFromBase64(entry.tokenBloomB64)
    if (!decoded.valid) {
      hasInvalidBloomIndex = true
      return true
    }

    return tokens.some((token) => bloomMayContain(decoded.bloom, token))
  })

  // Lossless guarantee: if compressed metadata is partially invalid, do not prune packs.
  if (hasInvalidBloomIndex) {
    return byAgent.map((entry) => entry.fileName)
  }

  if (byToken.length > 0) {
    return byToken.map((entry) => entry.fileName)
  }

  return byAgent.length > 0 ? byAgent.map((entry) => entry.fileName) : allFiles
}

export const buildSearchPacks = async (
  vaultPath: string,
  documents: readonly IndexedDocument[]
): Promise<{ readonly packCount: number; readonly recordCount: number }> => {
  return writeRowsAsPrivatePacks(vaultPath, toRows(documents), true)
}

export const ensurePrivatePacksFromLegacyIndex = async (
  vaultPath: string
): Promise<{ readonly imported: boolean; readonly source?: 'legacy-packs'; readonly packCount?: number; readonly recordCount?: number }> => {
  const files = await sortedPackFiles(vaultPath)
  if (files.some((file) => file.endsWith('.blpk'))) {
    return { imported: false }
  }

  const legacyPackFiles = files.filter((file) => file.endsWith('.jsonl.gz'))
  if (legacyPackFiles.length > 0) {
    const rows: SearchPackRow[] = []

    for (const file of legacyPackFiles) {
      const parsed = await parseRowsFromPack(vaultPath, await readFile(join(toPackDirectory(vaultPath), file)))
      rows.push(...parsed)
    }

    const report = await writeRowsAsPrivatePacks(vaultPath, rows, true)

    return {
      imported: true,
      source: 'legacy-packs',
      ...report
    }
  }

  return { imported: false }
}

export const searchInPacks = async (
  vaultPath: string,
  query: string,
  limit: number,
  agentId?: string
): Promise<readonly SearchResult[]> => {
  const normalizedAgent = agentId?.trim()
  const tokens = tokenize(query)

  if (limit <= 0 || tokens.length === 0) {
    return []
  }

  const files = await selectCandidatePackFiles(vaultPath, tokens, normalizedAgent)
  if (files.length === 0) {
    return []
  }

  const scored: SearchResult[] = []

  for (const file of files) {
    const rows = await parseRowsFromPack(vaultPath, await readFile(join(toPackDirectory(vaultPath), file)))
    const traversal = middleOutIndices(rows.length, Math.floor(rows.length / 2))

    traversal.forEach((rowIndex) => {
      const row = rows[rowIndex]
      if (!row) {
        return
      }
      if (normalizedAgent && row.agentId !== normalizedAgent) {
        return
      }

      const score = computeTextScore(row, tokens)

      if (score > 0) {
        scored.push(toSearchResult(row, score))
      }
    })
  }

  return scored
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit)
}
