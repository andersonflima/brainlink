import Database from 'better-sqlite3'
import { join } from 'node:path'
import { sanitizeAgentId } from '../domain/agents.js'
import { cosineSimilarity } from '../domain/embeddings.js'
import type { AgentSummary, GraphEdge, GraphLink, GraphNode, IndexedDocument, KnowledgeGraph, SearchMode, SearchResult } from '../domain/types.js'

const schemaVersion = 3

type SqliteIndex = {
  readonly reset: () => void
  readonly saveDocuments: (documents: readonly IndexedDocument[]) => void
  readonly search: (query: string, limit: number, agentId?: string, mode?: SearchMode, queryEmbedding?: readonly number[]) => readonly SearchResult[]
  readonly listLinks: (agentId?: string) => readonly GraphLink[]
  readonly listBacklinks: (title: string, agentId?: string) => readonly GraphLink[]
  readonly getGraph: (agentId?: string) => KnowledgeGraph
  readonly listAgents: () => readonly AgentSummary[]
  readonly close: () => void
}

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

type GraphLinkRow = {
  readonly agent_id: string
  readonly from_title: string
  readonly from_path: string
  readonly to_title: string
  readonly to_path: string | null
}

type GraphNodeRow = {
  readonly id: string
  readonly agent_id: string
  readonly title: string
  readonly path: string
  readonly content: string
  readonly tags_json: string
}

type GraphEdgeRow = {
  readonly source: string
  readonly target: string | null
  readonly target_title: string
}

const toGraphLink = (row: GraphLinkRow): GraphLink => ({
  agentId: row.agent_id,
  fromTitle: row.from_title,
  fromPath: row.from_path,
  toTitle: row.to_title,
  toPath: row.to_path
})

type AgentSummaryRow = {
  readonly id: string
  readonly document_count: number
}

const getStoredSchemaVersion = (database: Database.Database): number => {
  const hasMetadata = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata'")
    .get() as { readonly name: string } | undefined

  if (!hasMetadata) {
    return 0
  }

  const row = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as
    | { readonly value: string }
    | undefined

  return Number.parseInt(row?.value ?? '0', 10)
}

const dropDerivedSchema = (database: Database.Database): void => {
  database.exec(`
    DROP TABLE IF EXISTS chunks_fts;
    DROP TABLE IF EXISTS links;
    DROP TABLE IF EXISTS chunks;
    DROP TABLE IF EXISTS documents;
  `)
}

const createSchema = (database: Database.Database): void => {
  const storedSchemaVersion = getStoredSchemaVersion(database)

  if (storedSchemaVersion > 0 && storedSchemaVersion < schemaVersion) {
    dropDerivedSchema(database)
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      frontmatter_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding_provider TEXT NOT NULL,
      embedding_json TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS links (
      from_document_id TEXT NOT NULL,
      to_title TEXT NOT NULL,
      to_document_id TEXT,
      FOREIGN KEY (from_document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (to_document_id) REFERENCES documents(id) ON DELETE SET NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id UNINDEXED,
      document_id UNINDEXED,
      agent_id UNINDEXED,
      title,
      content
    );
  `)

  database
    .prepare(
      `
      INSERT INTO metadata (key, value)
      VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
    )
    .run(String(schemaVersion))
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

export const openSqliteIndex = (vaultPath: string): SqliteIndex => {
  const database = new Database(join(vaultPath, '.brainlink', 'brainlink.db'))

  database.exec('PRAGMA foreign_keys = ON;')
  createSchema(database)

  return {
    reset: () => {
      database.exec(`
        DELETE FROM chunks_fts;
        DELETE FROM links;
        DELETE FROM chunks;
        DELETE FROM documents;
      `)
    },
    saveDocuments: (documents) => {
      const insertDocument = database.prepare(`
        INSERT INTO documents (id, agent_id, title, path, content, tags_json, frontmatter_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const insertChunk = database.prepare(`
        INSERT INTO chunks (id, document_id, ordinal, content, token_count, embedding_provider, embedding_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      const insertChunkFts = database.prepare(`
        INSERT INTO chunks_fts (chunk_id, document_id, agent_id, title, content)
        VALUES (?, ?, ?, ?, ?)
      `)
      const insertLink = database.prepare(`
        INSERT INTO links (from_document_id, to_title, to_document_id)
        VALUES (?, ?, ?)
      `)

      const transaction = database.transaction(() => {
        documents.forEach(({ document, chunks, links }) => {
          insertDocument.run(
            document.id,
            document.agentId,
            document.title,
            document.path,
            document.content,
            JSON.stringify(document.tags),
            JSON.stringify(document.frontmatter),
            document.createdAt,
            document.updatedAt
          )

          chunks.forEach((chunk) => {
            insertChunk.run(
              chunk.id,
              chunk.documentId,
              chunk.ordinal,
              chunk.content,
              chunk.tokenCount,
              chunk.embeddingProvider,
              JSON.stringify(chunk.embedding)
            )
            insertChunkFts.run(chunk.id, chunk.documentId, document.agentId, document.title, chunk.content)
          })
        })

        documents.forEach(({ links }) => {
          links.forEach((link) => {
            insertLink.run(link.fromDocumentId, link.toTitle, link.toDocumentId)
          })
        })
      })

      transaction()
    },
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
      const semanticAgentFilter = normalizedAgentId ? 'WHERE documents.agent_id = ?' : ''
      const semanticRows =
        mode === 'fts' || queryEmbedding.length === 0
          ? []
          : (database
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
              .all(...(normalizedAgentId ? [normalizedAgentId] : [])) as unknown as readonly SearchRow[])
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
    },
    listLinks: (agentId) => {
      const normalizedAgentId = normalizeAgentFilter(agentId)
      const agentFilter = normalizedAgentId ? 'WHERE source.agent_id = ?' : ''
      const rows = database
        .prepare(
          `
          SELECT
            source.agent_id AS agent_id,
            source.title AS from_title,
            source.path AS from_path,
            COALESCE(target.title, links.to_title) AS to_title,
            target.path AS to_path
          FROM links
          JOIN documents source ON source.id = links.from_document_id
          LEFT JOIN documents target ON target.id = links.to_document_id
          ${agentFilter}
          ORDER BY source.title, to_title
        `
        )
        .all(...(normalizedAgentId ? [normalizedAgentId] : [])) as unknown as readonly GraphLinkRow[]

      return rows.map(toGraphLink)
    },
    listBacklinks: (title, agentId) => {
      const normalizedAgentId = normalizeAgentFilter(agentId)
      const agentFilter = normalizedAgentId ? 'AND source.agent_id = ?' : ''
      const rows = database
        .prepare(
          `
          SELECT
            source.agent_id AS agent_id,
            source.title AS from_title,
            source.path AS from_path,
            COALESCE(target.title, links.to_title) AS to_title,
            target.path AS to_path
          FROM links
          JOIN documents source ON source.id = links.from_document_id
          LEFT JOIN documents target ON target.id = links.to_document_id
          WHERE (lower(links.to_title) = lower(?) OR lower(target.title) = lower(?))
          ${agentFilter}
          ORDER BY source.title
        `
        )
        .all(...(normalizedAgentId ? [title, title, normalizedAgentId] : [title, title])) as unknown as readonly GraphLinkRow[]

      return rows.map(toGraphLink)
    },
    getGraph: (agentId) => {
      const normalizedAgentId = normalizeAgentFilter(agentId)
      const documentAgentFilter = normalizedAgentId ? 'WHERE agent_id = ?' : ''
      const edgeAgentFilter = normalizedAgentId ? 'WHERE source.agent_id = ?' : ''
      const nodeRows = database
        .prepare(
          `
          SELECT id, agent_id, title, path, content, tags_json
          FROM documents
          ${documentAgentFilter}
          ORDER BY title
        `
        )
        .all(...(normalizedAgentId ? [normalizedAgentId] : [])) as unknown as readonly GraphNodeRow[]
      const edgeRows = database
        .prepare(
          `
          SELECT
            links.from_document_id AS source,
            links.to_document_id AS target,
            links.to_title AS target_title
          FROM links
          JOIN documents source ON source.id = links.from_document_id
          ${edgeAgentFilter}
          ORDER BY links.from_document_id, links.to_title
        `
        )
        .all(...(normalizedAgentId ? [normalizedAgentId] : [])) as unknown as readonly GraphEdgeRow[]
      const nodes: readonly GraphNode[] = nodeRows.map((row) => ({
        id: row.id,
        agentId: row.agent_id,
        title: row.title,
        path: row.path,
        content: row.content,
        tags: JSON.parse(row.tags_json) as readonly string[]
      }))
      const edges: readonly GraphEdge[] = edgeRows.map((row) => ({
        source: row.source,
        target: row.target,
        targetTitle: row.target_title
      }))

      return {
        nodes,
        edges
      }
    },
    listAgents: () => {
      const rows = database
        .prepare(
          `
          SELECT agent_id AS id, count(*) AS document_count
          FROM documents
          GROUP BY agent_id
          ORDER BY agent_id
        `
        )
        .all() as unknown as readonly AgentSummaryRow[]

      return rows.map((row) => ({
        id: row.id,
        documentCount: row.document_count
      }))
    },
    close: () => database.close()
  }
}
