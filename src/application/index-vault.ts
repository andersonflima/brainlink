import { createIndexedDocument, parseMarkdownDocument } from '../domain/markdown.js'
import type { IndexedDocument } from '../domain/types.js'
import { sharedAgentId } from '../domain/agents.js'
import { createEmbeddingProvider } from '../domain/embeddings.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'
import { ensureVault, readMarkdownFiles } from '../infrastructure/file-system-vault.js'
import { buildSearchPacks } from '../infrastructure/search-packs.js'
import { openFileIndex } from '../infrastructure/file-index.js'

export type IndexVaultResult = {
  readonly documentCount: number
  readonly chunkCount: number
  readonly linkCount: number
}

type ParsedDocument = ReturnType<typeof parseMarkdownDocument>

type IndexedTitle = {
  readonly id: string
  readonly path: string
}

type TitleMaps = {
  readonly shared: ReadonlyMap<string, IndexedTitle>
  readonly byAgent: ReadonlyMap<string, ReadonlyMap<string, IndexedTitle>>
}

type MutableTitleMaps = {
  readonly shared: Map<string, IndexedTitle>
  readonly byAgent: Map<string, Map<string, IndexedTitle>>
}

const toTitleKey = (title: string): string =>
  title.toLowerCase()

const appendTitleEntry = (map: Map<string, IndexedTitle>, document: ParsedDocument): Map<string, IndexedTitle> => {
  const key = toTitleKey(document.title)

  if (!map.has(key)) {
    map.set(key, {
      id: document.id,
      path: document.path
    })
  }

  return map
}

const createTitleMaps = (documents: readonly ParsedDocument[]): TitleMaps =>
  [...documents]
    .sort((left, right) => left.path.localeCompare(right.path))
    .reduce<MutableTitleMaps>(
      (state, document) => {
        const agentMap = state.byAgent.get(document.agentId) ?? new Map<string, IndexedTitle>()
        appendTitleEntry(agentMap, document)
        state.byAgent.set(document.agentId, agentMap)

        if (document.agentId === sharedAgentId) {
          appendTitleEntry(state.shared, document)
        }

        return state
      },
      {
        shared: new Map(),
        byAgent: new Map()
      }
    )
const createScopedTitleResolver = (document: ParsedDocument, titleMaps: TitleMaps) => ({
  get: (title: string): string | undefined =>
    titleMaps.byAgent.get(document.agentId)?.get(title)?.id ?? titleMaps.shared.get(title)?.id
})

const embedIndexedDocuments = async (
  documents: readonly IndexedDocument[],
  providerName: ReturnType<typeof createEmbeddingProvider>['name']
): Promise<readonly IndexedDocument[]> => {
  const provider = createEmbeddingProvider(providerName)
  const chunks = documents.flatMap((document) => document.chunks)
  const embeddings = await provider.embed(chunks.map((chunk) => chunk.content))
  const embeddingByChunkId = new Map(chunks.map((chunk, index) => [chunk.id, embeddings[index] ?? []]))

  return documents.map((indexedDocument) => ({
    ...indexedDocument,
    chunks: indexedDocument.chunks.map((chunk) => ({
      ...chunk,
      embeddingProvider: provider.name,
      embedding: embeddingByChunkId.get(chunk.id) ?? []
    }))
  }))
}

export const indexVault = async (vaultPath: string): Promise<IndexVaultResult> => {
  const absoluteVaultPath = await ensureVault(vaultPath)
  const config = await loadBrainlinkConfig()
  const files = await readMarkdownFiles(absoluteVaultPath)
  const documents = files.map((file) =>
    parseMarkdownDocument({
      absolutePath: file.absolutePath,
      vaultPath: absoluteVaultPath,
      content: file.content,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt
    })
  )
  const titleMaps = createTitleMaps(documents)
  const indexedDocuments: readonly IndexedDocument[] = await embedIndexedDocuments(
    documents.map((document) => createIndexedDocument(document, createScopedTitleResolver(document, titleMaps), config.chunkSize)),
    config.embeddingProvider
  )
  const index = openFileIndex(absoluteVaultPath)

  try {
    await index.reset()
    await index.saveDocuments(indexedDocuments)
    try {
      await buildSearchPacks(absoluteVaultPath, indexedDocuments)
    } catch {
      // Pack generation is best-effort. The JSON index remains the primary path.
    }

    return {
      documentCount: indexedDocuments.length,
      chunkCount: indexedDocuments.reduce((total, document) => total + document.chunks.length, 0),
      linkCount: indexedDocuments.reduce((total, document) => total + document.links.length, 0)
    }
  } finally {
    index.close()
  }
}
