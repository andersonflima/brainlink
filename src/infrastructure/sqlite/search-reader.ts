import Database from 'better-sqlite3'
import { sanitizeAgentId } from '../../domain/agents.js'
import { cosineSimilarity, createEmbeddingBuckets } from '../../domain/embeddings.js'
import type { SearchMode, SearchResult } from '../../domain/types.js'
import type { SqliteSearchReader } from './types.js'

type SearchRow = {
  readonly document_id: string
  readonly agent_id: string
  readonly title: string
  readonly path: string
  readonly chunk_id: string
  readonly content: string
  readonly score?: number
  readonly tags_json: string
  readonly embedding_json?: string
}

const toFtsQuery = (query: string): string =>
  query
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu)
    ?.map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(' OR ') ?? ''

const normalizeAgentFilter = (agentId?: string): string | undefined =>
  agentId ? sanitizeAgentId(agentId) : undefined

const parseJsonArray = (value: string | undefined): readonly unknown[] => {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown

    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const toTextScore = (index: number, total: number): number =>
  total === 0 ? 0 : 1 - index / (total + 1)

const toSearchResult = (
  row: SearchRow,
  score: number,
  textScore: number,
  semanticScore: number,
  searchMode: SearchMode
): SearchResult => ({
  documentId: row.document_id,
  agentId: row.agent_id,
  title: row.title,
  path: row.path,
  chunkId: row.chunk_id,
  content: row.content,
  score,
  textScore,
  semanticScore,
  searchMode,
  tags: parseJsonArray(row.tags_json).filter((value): value is string => typeof value === 'string')
})

const sortByScore = (results: readonly SearchResult[]): readonly SearchResult[] =>
  [...results].sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))

const mergeHybridResults = (
  ftsResults: readonly SearchResult[],
  semanticResults: readonly SearchResult[],
  limit: number
): readonly SearchResult[] => {
  const rows = new Map<string, SearchResult>()

  ;[...semanticResults, ...ftsResults].forEach((result) => {
    const current = rows.get(result.chunkId)
    const textScore = Math.max(current?.textScore ?? 0, result.textScore)
    const semanticScore = Math.max(current?.semanticScore ?? 0, result.semanticScore)
    const score = textScore * 0.62 + semanticScore * 0.38

    rows.set(result.chunkId, {
      ...result,
      score,
      textScore,
      semanticScore,
      searchMode: 'hybrid'
    })
  })

  return sortByScore(Array.from(rows.values())).slice(0, limit)
}

const placeholders = (count: number): string =>
  Array.from({ length: count }, () => '?').join(', ')

const readAllSemanticRows = (database: Database.Database, normalizedAgentId: string | undefined): readonly SearchRow[] => {
  const semanticAgentFilter = normalizedAgentId ? 'WHERE documents.agent_id = ?' : ''

  return database
    .prepare(
      `
      SELECT
        documents.id AS document_id,
        documents.agent_id AS agent_id,
        documents.title AS title,
        documents.path AS path,
        chunks.id AS chunk_id,
        chunks.content AS content,
        documents.tags_json AS tags_json,
        chunks.embedding_json AS embedding_json
      FROM chunks
      JOIN documents ON documents.id = chunks.document_id
      ${semanticAgentFilter}
    `
    )
    .all(...(normalizedAgentId ? [normalizedAgentId] : [])) as unknown as readonly SearchRow[]
}

const readBucketedSemanticRows = (
  database: Database.Database,
  normalizedAgentId: string | undefined,
  queryEmbedding: readonly number[],
  limit: number
): readonly SearchRow[] => {
  const buckets = createEmbeddingBuckets(queryEmbedding)

  if (buckets.length === 0) {
    return []
  }

  const agentFilter = normalizedAgentId ? 'AND documents.agent_id = ?' : ''
  const params = normalizedAgentId ? [...buckets, normalizedAgentId, limit] : [...buckets, limit]

  return database
    .prepare(
      `
      SELECT
        documents.id AS document_id,
        documents.agent_id AS agent_id,
        documents.title AS title,
        documents.path AS path,
        chunks.id AS chunk_id,
        chunks.content AS content,
        documents.tags_json AS tags_json,
        chunks.embedding_json AS embedding_json,
        count(*) AS score
      FROM embedding_buckets
      JOIN chunks ON chunks.id = embedding_buckets.chunk_id
      JOIN documents ON documents.id = chunks.document_id
      WHERE embedding_buckets.bucket IN (${placeholders(buckets.length)})
      ${agentFilter}
      GROUP BY chunks.id
      ORDER BY score DESC, chunks.token_count ASC, documents.title ASC
      LIMIT ?
    `
    )
    .all(...params) as unknown as readonly SearchRow[]
}

const readSemanticRows = (
  database: Database.Database,
  normalizedAgentId: string | undefined,
  queryEmbedding: readonly number[],
  limit: number
): readonly SearchRow[] => {
  const candidateLimit = Math.max(limit * 96, 768)
  const bucketedRows = readBucketedSemanticRows(database, normalizedAgentId, queryEmbedding, candidateLimit)

  return bucketedRows.length > 0 ? bucketedRows : readAllSemanticRows(database, normalizedAgentId)
}

export const createSearchReader = (database: Database.Database): SqliteSearchReader => ({
  search: (query, limit, agentId, mode = 'hybrid', queryEmbedding = []) => {
    const normalizedQuery = query.trim()

    if (!normalizedQuery || limit <= 0) {
      return []
    }

    const normalizedAgentId = normalizeAgentFilter(agentId)
    const ftsQuery = toFtsQuery(query)
    const expandedLimit = Math.max(limit * 4, 24)
    const ftsAgentFilter = normalizedAgentId ? 'AND documents.agent_id = ?' : ''
    const ftsParams = normalizedAgentId ? [ftsQuery, normalizedAgentId, expandedLimit] : [ftsQuery, expandedLimit]
    const ftsRows =
      mode === 'semantic' || !ftsQuery
        ? []
        : (database
            .prepare(
              `
                SELECT
                  documents.id AS document_id,
                  documents.agent_id AS agent_id,
                  documents.title AS title,
                  documents.path AS path,
                  chunks_fts.chunk_id AS chunk_id,
                  chunks_fts.content AS content,
                  bm25(chunks_fts) * -1 AS score,
                  documents.tags_json AS tags_json
                FROM chunks_fts
                JOIN documents ON documents.id = chunks_fts.document_id
                WHERE chunks_fts MATCH ?
                ${ftsAgentFilter}
                ORDER BY bm25(chunks_fts)
                LIMIT ?
              `
            )
            .all(...ftsParams) as unknown as readonly SearchRow[])
    const ftsResults = ftsRows.map((row, index) =>
      toSearchResult(row, toTextScore(index, ftsRows.length), toTextScore(index, ftsRows.length), 0, 'fts')
    )
    const semanticRows =
      mode === 'fts' || queryEmbedding.length === 0 ? [] : readSemanticRows(database, normalizedAgentId, queryEmbedding, expandedLimit)
    const semanticResults = sortByScore(
      semanticRows
        .map((row) => {
          const semanticScore = Math.max(
            0,
            cosineSimilarity(
              queryEmbedding,
              parseJsonArray(row.embedding_json).filter((value): value is number => typeof value === 'number')
            )
          )

          return toSearchResult(row, semanticScore, 0, semanticScore, 'semantic')
        })
        .filter((result) => result.semanticScore > 0)
    ).slice(0, expandedLimit)

    if (mode === 'fts') {
      return ftsResults.slice(0, limit)
    }

    if (mode === 'semantic') {
      return semanticResults.slice(0, limit)
    }

    return mergeHybridResults(ftsResults, semanticResults, limit)
  }
})
