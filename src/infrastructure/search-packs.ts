import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexedDocument, SearchResult } from '../domain/types.js'

type SearchPackRow = {
  readonly documentId: string
  readonly agentId: string
  readonly title: string
  readonly path: string
  readonly chunkId: string
  readonly content: string
  readonly tags: readonly string[]
}

type SearchPackManifest = {
  readonly version: 1
  readonly createdAt: string
  readonly packCount: number
  readonly recordCount: number
}

const packsDirectoryName = 'search-packs'
const manifestFileName = 'manifest.json'
const rowChunkSize = 5_000
const queryTokenPattern = /[\p{L}\p{N}_-]+/gu

const toPackDirectory = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', packsDirectoryName)

const toManifestPath = (vaultPath: string): string =>
  join(toPackDirectory(vaultPath), manifestFileName)

const parseRowsFromPack = (content: Buffer): readonly SearchPackRow[] =>
  gunzipSync(content)
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SearchPackRow)

const toRows = (documents: readonly IndexedDocument[]): readonly SearchPackRow[] =>
  documents.flatMap((document) =>
    document.chunks.map((chunk) => ({
      documentId: document.document.id,
      agentId: document.document.agentId,
      title: document.document.title,
      path: document.document.path,
      chunkId: chunk.id,
      content: chunk.content,
      tags: document.document.tags
    }))
  )

const writeManifest = async (vaultPath: string, manifest: SearchPackManifest): Promise<void> => {
  await writeFile(toManifestPath(vaultPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
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
      .filter((file) => file.endsWith('.jsonl.gz'))
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

export const buildSearchPacks = async (
  vaultPath: string,
  documents: readonly IndexedDocument[]
): Promise<{ readonly packCount: number; readonly recordCount: number }> => {
  const directory = toPackDirectory(vaultPath)
  const rows = toRows(documents)

  await mkdir(directory, { recursive: true })
  const current = await readdir(directory)
  await Promise.all(
    current
      .filter((name) => name.endsWith('.jsonl.gz') || name === manifestFileName)
      .map((name) => rm(join(directory, name), { force: true }))
  )

  const chunks = chunkRows(rows, rowChunkSize)
  await Promise.all(
    chunks.map(async (chunk, index) => {
      const fileName = `pack-${String(index + 1).padStart(4, '0')}.jsonl.gz`
      const serialized = `${chunk.map((row) => JSON.stringify(row)).join('\n')}\n`
      const compressed = gzipSync(Buffer.from(serialized, 'utf8'), { level: 6 })

      await writeFile(join(directory, fileName), compressed)
    })
  )

  await writeManifest(vaultPath, {
    version: 1,
    createdAt: new Date().toISOString(),
    packCount: chunks.length,
    recordCount: rows.length
  })

  return {
    packCount: chunks.length,
    recordCount: rows.length
  }
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

  const files = await sortedPackFiles(vaultPath)
  if (files.length === 0) {
    return []
  }

  const scored: SearchResult[] = []

  for (const file of files) {
    const rows = parseRowsFromPack(await readFile(join(toPackDirectory(vaultPath), file)))

    rows.forEach((row) => {
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

