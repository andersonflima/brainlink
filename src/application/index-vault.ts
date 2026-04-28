import { createIndexedDocument, parseMarkdownDocument } from '../domain/markdown.js'
import type { IndexedDocument } from '../domain/types.js'
import { sharedAgentId } from '../domain/agents.js'
import { createEmbeddingProvider } from '../domain/embeddings.js'
import { loadBrainlinkConfig } from '../infrastructure/config.js'
import { ensureVault, readMarkdownFiles } from '../infrastructure/file-system-vault.js'
import { openSqliteIndex } from '../infrastructure/sqlite-index.js'

export type IndexVaultResult = {
  readonly documentCount: number
  readonly chunkCount: number
  readonly linkCount: number
}

type ParsedDocument = ReturnType<typeof parseMarkdownDocument>

const toTitleEntry = (document: ParsedDocument): readonly [string, string] => [document.title.toLowerCase(), document.id]

const createScopedTitleMap = (
  document: ParsedDocument,
  documents: readonly ParsedDocument[]
): ReadonlyMap<string, string> =>
  new Map([
    ...documents.filter((candidate) => candidate.agentId === sharedAgentId).map(toTitleEntry),
    ...documents.filter((candidate) => candidate.agentId === document.agentId).map(toTitleEntry)
  ])

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
  const indexedDocuments: readonly IndexedDocument[] = await embedIndexedDocuments(
    documents.map((document) => createIndexedDocument(document, createScopedTitleMap(document, documents), config.chunkSize)),
    config.embeddingProvider
  )
  const index = openSqliteIndex(absoluteVaultPath)

  try {
    index.reset()
    index.saveDocuments(indexedDocuments)

    return {
      documentCount: indexedDocuments.length,
      chunkCount: indexedDocuments.reduce((total, document) => total + document.chunks.length, 0),
      linkCount: indexedDocuments.reduce((total, document) => total + document.links.length, 0)
    }
  } finally {
    index.close()
  }
}
