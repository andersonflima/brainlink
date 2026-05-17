import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { cosineSimilarity } from '../domain/embeddings.js'
import type {
  AgentSummary,
  GraphLink,
  IndexedDocument,
  KnowledgeGraph,
  KnowledgeLink,
  SearchMode,
  SearchResult
} from '../domain/types.js'

type StoredIndex = {
  readonly version: 1
  readonly updatedAt: string
  readonly documents: readonly IndexedDocument['document'][]
  readonly chunks: readonly IndexedDocument['chunks'][number][]
  readonly links: readonly KnowledgeLink[]
}

type IndexCacheEntry = {
  readonly mtimeMs: number
  readonly size: number
  readonly index: StoredIndex
}

type IndexSearchRow = {
  readonly documentId: string
  readonly agentId: string
  readonly title: string
  readonly path: string
  readonly chunkId: string
  readonly chunkOrdinal: number
  readonly content: string
  readonly tags: readonly string[]
  readonly embedding: readonly number[]
}

const queryTokenPattern = /[\p{L}\p{N}_-]+/gu
const indexCacheMaxEntries = 16
const indexCache = new Map<string, IndexCacheEntry>()

const emptyIndex = (): StoredIndex => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  documents: [],
  chunks: [],
  links: []
})

export const indexStoragePath = (vaultPath: string): string =>
  join(vaultPath, '.brainlink', 'index.json')

const readIndex = async (vaultPath: string): Promise<StoredIndex> => {
  const path = indexStoragePath(vaultPath)
  let stats: { readonly mtimeMs: number; readonly size: number } | null = null

  try {
    const fileStats = await stat(path)
    stats = { mtimeMs: fileStats.mtimeMs, size: fileStats.size }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      indexCache.delete(path)
      return emptyIndex()
    }

    return emptyIndex()
  }

  const cached = indexCache.get(path)
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.index
  }

  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<StoredIndex>
    const loaded: StoredIndex = {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      links: Array.isArray(parsed.links) ? parsed.links : []
    }
    indexCache.set(path, { ...stats, index: loaded })

    if (indexCache.size > indexCacheMaxEntries) {
      const oldest = indexCache.keys().next().value
      if (typeof oldest === 'string') {
        indexCache.delete(oldest)
      }
    }

    return loaded
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      indexCache.delete(path)
      return emptyIndex()
    }

    return emptyIndex()
  }
}

const writeIndex = async (vaultPath: string, index: StoredIndex): Promise<void> => {
  const target = indexStoragePath(vaultPath)
  const temp = `${target}.tmp`

  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(temp, `${JSON.stringify(index)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temp, target)
  const fileStats = await stat(target)
  indexCache.set(target, {
    mtimeMs: fileStats.mtimeMs,
    size: fileStats.size,
    index
  })
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
  let cursor = 0

  while (cursor < text.length) {
    const index = text.indexOf(token, cursor)
    if (index < 0) {
      break
    }
    hits += 1
    cursor = index + token.length
  }

  return hits
}

const textScore = (row: IndexSearchRow, tokens: readonly string[]): number => {
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

    return score + titleHits * 5 + tagHits * 4 + pathHits * 2 + Math.min(contentHits, 6)
  }, 0)
}

const semanticScore = (row: IndexSearchRow, queryEmbedding: readonly number[]): number =>
  queryEmbedding.length > 0 && row.embedding.length > 0 ? cosineSimilarity(queryEmbedding, row.embedding) : 0

const toResult = (row: IndexSearchRow, mode: SearchMode, text: number, semantic: number): SearchResult => {
  const score = mode === 'fts' ? text : mode === 'semantic' ? semantic : text + semantic * 8

  return {
    documentId: row.documentId,
    agentId: row.agentId,
    title: row.title,
    path: row.path,
    chunkId: row.chunkId,
    chunkOrdinal: row.chunkOrdinal,
    content: row.content,
    score,
    textScore: text,
    semanticScore: semantic,
    searchMode: mode,
    tags: row.tags
  }
}

const toGraphLink = (
  link: KnowledgeLink,
  documentsById: ReadonlyMap<string, IndexedDocument['document']>
): GraphLink => {
  const source = documentsById.get(link.fromDocumentId)
  const target = link.toDocumentId ? documentsById.get(link.toDocumentId) : undefined

  return {
    agentId: source?.agentId ?? 'shared',
    fromTitle: source?.title ?? 'Unknown',
    fromPath: source?.path ?? 'Unknown',
    toTitle: target?.title ?? link.toTitle,
    toPath: target?.path ?? null,
    weight: link.weight,
    priority: link.priority
  }
}

export const openFileIndex = (vaultPath: string) => {
  const load = async (): Promise<StoredIndex> => readIndex(vaultPath)
  const persist = async (index: StoredIndex): Promise<void> => writeIndex(vaultPath, index)

  return {
    reset: async (): Promise<void> => {
      await persist(emptyIndex())
    },
    saveDocuments: async (documents: readonly IndexedDocument[]): Promise<void> => {
      const chunks = documents.flatMap((document) => document.chunks)
      const links = documents.flatMap((document) => document.links)

      await persist({
        version: 1,
        updatedAt: new Date().toISOString(),
        documents: documents.map((document) => document.document),
        chunks,
        links
      })
    },
    search: async (
      query: string,
      limit: number,
      agentId?: string,
      mode: SearchMode = 'hybrid',
      queryEmbedding: readonly number[] = []
    ): Promise<readonly SearchResult[]> => {
      const index = await load()
      const documentsById = new Map(index.documents.map((document) => [document.id, document]))
      const rows: readonly IndexSearchRow[] = index.chunks.flatMap((chunk) => {
        const document = documentsById.get(chunk.documentId)
        if (!document) {
          return []
        }
        if (agentId && document.agentId !== agentId) {
          return []
        }

        return [
          {
            documentId: document.id,
            agentId: document.agentId,
            title: document.title,
            path: document.path,
            chunkId: chunk.id,
            chunkOrdinal: chunk.ordinal,
            content: chunk.content,
            tags: document.tags,
            embedding: chunk.embedding
          }
        ]
      })
      const tokens = tokenize(query)
      const results = rows
        .map((row) => {
          const text = textScore(row, tokens)
          const semantic = semanticScore(row, queryEmbedding)
          return toResult(row, mode, text, semantic)
        })
        .filter((row) => row.score > 0 || tokens.length === 0)
        .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
        .slice(0, Math.max(0, limit))

      return results
    },
    listLinks: async (agentId?: string): Promise<readonly GraphLink[]> => {
      const index = await load()
      const documentsById = new Map(index.documents.map((document) => [document.id, document]))

      return index.links
        .filter((link) => {
          const source = documentsById.get(link.fromDocumentId)
          return agentId ? source?.agentId === agentId : true
        })
        .map((link) => toGraphLink(link, documentsById))
        .sort((left, right) => left.fromTitle.localeCompare(right.fromTitle))
    },
    listBacklinks: async (title: string, agentId?: string): Promise<readonly GraphLink[]> => {
      const index = await load()
      const titleKey = title.toLowerCase()
      const documentsById = new Map(index.documents.map((document) => [document.id, document]))

      return index.links
        .filter((link) => link.toTitle.toLowerCase() === titleKey)
        .filter((link) => {
          const source = documentsById.get(link.fromDocumentId)
          return agentId ? source?.agentId === agentId : true
        })
        .map((link) => toGraphLink(link, documentsById))
        .sort((left, right) => right.weight - left.weight || left.fromTitle.localeCompare(right.fromTitle))
    },
    getGraph: async (agentId?: string): Promise<KnowledgeGraph> => {
      const index = await load()
      const documents = agentId ? index.documents.filter((document) => document.agentId === agentId) : index.documents
      const documentIds = new Set(documents.map((document) => document.id))
      const edges = index.links
        .filter((link) => documentIds.has(link.fromDocumentId))
        .map((link) => ({
          source: link.fromDocumentId,
          target: link.toDocumentId,
          targetTitle: link.toTitle,
          weight: link.weight,
          priority: link.priority
        }))

      return {
        nodes: documents.map((document) => ({
          id: document.id,
          agentId: document.agentId,
          title: document.title,
          path: document.path,
          content: document.content,
          tags: document.tags
        })),
        edges
      }
    },
    getGraphSummary: async (agentId?: string): Promise<KnowledgeGraph> => {
      const graph = await (async () => {
        const index = await load()
        const documents = agentId ? index.documents.filter((document) => document.agentId === agentId) : index.documents
        const documentIds = new Set(documents.map((document) => document.id))
        const edges = index.links
          .filter((link) => documentIds.has(link.fromDocumentId))
          .map((link) => ({
            source: link.fromDocumentId,
            target: link.toDocumentId,
            targetTitle: link.toTitle,
            weight: link.weight,
            priority: link.priority
          }))

        return {
          nodes: documents.map((document) => ({
            id: document.id,
            agentId: document.agentId,
            title: document.title,
            path: document.path,
            content: '',
            tags: document.tags
          })),
          edges
        }
      })()

      return graph
    },
    getGraphNode: async (id: string, agentId?: string): Promise<KnowledgeGraph['nodes'][number] | undefined> => {
      const index = await load()
      const document = index.documents.find((row) => row.id === id && (!agentId || row.agentId === agentId))

      return document
        ? {
            id: document.id,
            agentId: document.agentId,
            title: document.title,
            path: document.path,
            content: document.content,
            tags: document.tags
          }
        : undefined
    },
    searchGraphNodeIds: async (query: string, limit: number, agentId?: string): Promise<readonly string[]> => {
      const index = await load()
      const normalized = normalizeToken(query)
      if (normalized.length === 0 || limit <= 0) {
        return []
      }
      const tokens = tokenize(query)
      const scored = index.documents
        .filter((document) => (!agentId || document.agentId === agentId))
        .map((document) => {
          const score = textScore(
            {
              documentId: document.id,
              agentId: document.agentId,
              title: document.title,
              path: document.path,
              chunkId: document.id,
              chunkOrdinal: 0,
              content: document.content,
              tags: document.tags,
              embedding: []
            },
            tokens
          )
          return { id: document.id, score }
        })
        .filter((row) => row.score > 0)
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, limit)

      return scored.map((row) => row.id)
    },
    listAgents: async (): Promise<readonly AgentSummary[]> => {
      const index = await load()
      const counts = index.documents.reduce<Map<string, number>>((state, document) => {
        state.set(document.agentId, (state.get(document.agentId) ?? 0) + 1)
        return state
      }, new Map())

      return Array.from(counts.entries())
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([id, documentCount]) => ({ id, documentCount }))
    },
    close: (): void => {
      // File-based index has no persistent connection.
    }
  }
}
