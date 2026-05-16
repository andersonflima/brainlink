import Database from 'better-sqlite3'
import { gunzipSync } from 'node:zlib'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { IndexedDocument, SearchResult } from '../domain/types.js'
import { decodePrivatePack, encodePrivatePack, isPrivatePackPayload } from './private-pack-codec.js'

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
  readonly version: 2
  readonly createdAt: string
  readonly packCount: number
  readonly recordCount: number
  readonly format: 'private-v2'
}

const packsDirectoryName = 'search-packs'
const manifestFileName = 'manifest.json'
const rowChunkSize = 5_000
const queryTokenPattern = /[\p{L}\p{N}_-]+/gu

const toPackDirectory = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', packsDirectoryName)

const toManifestPath = (vaultPath: string): string =>
  join(toPackDirectory(vaultPath), manifestFileName)

const toDatabasePath = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', 'brainlink.db')

const parseRowsFromPack = async (vaultPath: string, content: Buffer): Promise<readonly SearchPackRow[]> => {
  const raw = isPrivatePackPayload(content) ? await decodePrivatePack(vaultPath, content) : gunzipSync(content)

  return raw
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SearchPackRow)
}

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

const parseTags = (value: string): readonly string[] => {
  try {
    const parsed = JSON.parse(value) as unknown

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
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
  await Promise.all(
    chunks.map(async (chunk, index) => {
      const fileName = `pack-${String(index + 1).padStart(4, '0')}.blpk`
      const serialized = `${chunk.map((row) => JSON.stringify(row)).join('\n')}\n`
      const compressed = await encodePrivatePack(vaultPath, Buffer.from(serialized, 'utf8'))

      await writeFile(join(directory, fileName), compressed)
    })
  )

  await writeManifest(vaultPath, {
    version: 2,
    createdAt: new Date().toISOString(),
    packCount: chunks.length,
    recordCount: rows.length,
    format: 'private-v2'
  })

  return {
    packCount: chunks.length,
    recordCount: rows.length
  }
}

const tableExists = (database: Database.Database, table: string): boolean => {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as
    | { readonly name: string }
    | undefined

  return row?.name === table
}

const tableColumns = (database: Database.Database, table: string): ReadonlySet<string> => {
  const rows = database.prepare(`SELECT name FROM pragma_table_info('${table.replaceAll("'", "''")}')`).all() as readonly {
    readonly name: string
  }[]

  return new Set(rows.map((row) => row.name))
}

const loadRowsFromLegacySqlite = (vaultPath: string): readonly SearchPackRow[] => {
  const databasePath = toDatabasePath(vaultPath)
  if (!existsSync(databasePath)) {
    return []
  }

  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    if (!tableExists(database, 'documents') || !tableExists(database, 'chunks')) {
      return []
    }

    const documentColumns = tableColumns(database, 'documents')
    const chunkColumns = tableColumns(database, 'chunks')

    if (!documentColumns.has('id') || !documentColumns.has('title') || !chunkColumns.has('document_id')) {
      return []
    }

    const agentExpr = documentColumns.has('agent_id') ? 'documents.agent_id' : "'shared'"
    const pathExpr = documentColumns.has('path') ? 'documents.path' : "documents.title"
    const tagsExpr = documentColumns.has('tags_json') ? 'documents.tags_json' : "'[]'"
    const chunkIdExpr = chunkColumns.has('id') ? 'chunks.id' : "documents.id || ':' || chunks.rowid"
    const chunkContentExpr = chunkColumns.has('content')
      ? 'chunks.content'
      : documentColumns.has('content')
        ? 'documents.content'
        : "''"
    const chunkOrderExpr = chunkColumns.has('ordinal') ? 'chunks.ordinal' : 'chunks.rowid'

    const statement = database.prepare(`
      SELECT
        documents.id AS document_id,
        ${agentExpr} AS agent_id,
        documents.title AS title,
        ${pathExpr} AS path,
        ${chunkIdExpr} AS chunk_id,
        ${chunkContentExpr} AS content,
        ${tagsExpr} AS tags_json
      FROM chunks
      JOIN documents ON documents.id = chunks.document_id
      ORDER BY documents.title, ${chunkOrderExpr}
    `)
    const rows = statement.all() as readonly {
      readonly document_id: string
      readonly agent_id: string
      readonly title: string
      readonly path: string
      readonly chunk_id: string
      readonly content: string
      readonly tags_json: string
    }[]

    return rows.map((row) => ({
      documentId: row.document_id,
      agentId: typeof row.agent_id === 'string' && row.agent_id.length > 0 ? row.agent_id : 'shared',
      title: row.title,
      path: row.path,
      chunkId: row.chunk_id,
      content: row.content ?? '',
      tags: parseTags(row.tags_json)
    }))
  } finally {
    database.close()
  }
}

export const buildSearchPacks = async (
  vaultPath: string,
  documents: readonly IndexedDocument[]
): Promise<{ readonly packCount: number; readonly recordCount: number }> => {
  return writeRowsAsPrivatePacks(vaultPath, toRows(documents), true)
}

export const ensurePrivatePacksFromLegacyIndex = async (
  vaultPath: string
): Promise<{ readonly imported: boolean; readonly source?: 'legacy-packs' | 'legacy-sqlite'; readonly packCount?: number; readonly recordCount?: number }> => {
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

  const legacyRows = loadRowsFromLegacySqlite(vaultPath)
  if (legacyRows.length === 0) {
    return { imported: false }
  }
  const report = await writeRowsAsPrivatePacks(vaultPath, legacyRows, true)

  return {
    imported: true,
    source: 'legacy-sqlite',
    ...report
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
    const rows = await parseRowsFromPack(vaultPath, await readFile(join(toPackDirectory(vaultPath), file)))

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
